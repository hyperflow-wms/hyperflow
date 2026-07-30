/**
 * K8s Admission Controller - Rate limiter and concurrency gate for Pod creation
 *
 * Prevents overwhelming the Kubernetes scheduler by:
 * 1. Maintaining real-time count of pending Pods via Watch API (no polling)
 * 2. Using token bucket rate limiter to pace submissions
 * 3. Capping concurrent pending Pods (concurrency window)
 * 4. Self-adapting to observed cluster scheduling throughput
 *
 * Usage:
 *   const controller = new K8sAdmissionController(kubeconfig, namespace);
 *   await controller.initialize();
 *   await controller.maybeSubmit(async () => {
 *     await k8sApi.createNamespacedJob(namespace, jobYaml);
 *   });
 */

const clog = require('../../common/consoleLogger');
const k8s = require('@kubernetes/client-node');

class K8sAdmissionController {
  constructor(kubeconfig, namespace, options = {}) {
    this.kubeconfig = kubeconfig;
    this.namespace = namespace;

    // Label selector to identify HyperFlow pods
    this.selector = options.selector || 'app=hyperflow';

    // Configuration (can be overridden via options or env vars)
    this.config = {
      // Concurrency window: max pending Pods allowed
      pendingMax: options.pendingMax ||
                  parseInt(process.env.HF_VAR_ADMISSION_PENDING_MAX) ||
                  200,

      // Token bucket: initial fill rate (tokens/sec)
      initialFillRate: options.initialFillRate ||
                       parseFloat(process.env.HF_VAR_ADMISSION_FILL_RATE) ||
                       1,

      // Token bucket: max burst capacity
      burst: options.burst ||
             parseInt(process.env.HF_VAR_ADMISSION_BURST) ||
             20,

      // Enable adaptive tuning of pendingMax and fillRate
      adaptive: options.adaptive !== undefined ? options.adaptive :
                process.env.HF_VAR_ADMISSION_ADAPTIVE !== '0',

      // Minimum and maximum bounds for adaptive pendingMax
      minPendingMax: options.minPendingMax || 50,
      maxPendingMax: options.maxPendingMax || 2000,

      // EWMA alpha values (higher = more reactive to recent changes)
      runningRateAlpha: options.runningRateAlpha || 0.2,
      errorRateAlpha: options.errorRateAlpha || 0.3,

      // Backoff parameters for API errors
      backoffInitialMs: options.backoffInitialMs || 250,
      backoffMaxMs: options.backoffMaxMs || 4000,

      // Adaptive tuning interval (ms)
      adaptIntervalMs: options.adaptIntervalMs || 1000,

      // Enable debug logging
      debug: options.debug || process.env.HF_VAR_ADMISSION_DEBUG === '1'
    };

    // State tracking (updated from watch events)
    this.state = {
      pendingCount: 0,           // Current number of pending Pods
      runningRateEWMA: 1,        // EWMA of scheduling throughput (Pods/sec)
      createErrorEWMA: 0,        // EWMA of API error rate
      podPhases: new Map(),      // Pod name -> current phase (for transition detection)

      // For time-aware EWMA calculation
      runningTransitions: 0,     // Count of Pending->Running transitions since last adapt
      lastAdaptTime: Date.now(), // Timestamp of last adapt() call

      // Hysteresis for pendingMax (prevent rapid decreases during temporary slowdowns)
      lastPendingMaxDecrease: Date.now() // Timestamp of last pendingMax decrease
    };

    // Throttle gate-blocked messages (log at most once per N seconds)
    this.lastGate1LogTime = 0;
    this.lastGate2LogTime = 0;
    this.gateLogThrottleMs = 5000; // Log gate blocks at most once per 5 seconds

    // Token bucket state (start full to allow immediate burst on startup)
    this.tokens = this.config.burst;
    this.lastRefill = Date.now() / 1000;
    this.fillRate = this.config.initialFillRate;

    // Per-submitter backoff state
    this.backoffMs = this.config.backoffInitialMs;

    // Cleanup counter for periodic podPhases garbage collection
    this._cleanupCounter = 0;

    // Watch-related state
    this.watch = null;
    this.watchAbortController = null;
    this.resourceVersion = null;       // Track LIST/WATCH resourceVersion for continuity
    this.reconnectBackoffMs = 1000;    // Reconnect backoff (grows on repeated failures)
    this.initialized = false;
    this.adaptInterval = null;
  }

  /**
   * Initialize the admission controller:
   * - Do initial LIST to seed pendingCount
   * - Start WATCH to track Pod state changes
   * - Start adaptive tuning loop
   */
  async initialize() {
    if (this.initialized) {
      clog.debug('[AdmissionController] Already initialized');
      return;
    }

    this.log('Initializing admission controller...');
    this.log(`Config: pendingMax=${this.config.pendingMax}, fillRate=${this.fillRate}, burst=${this.config.burst}, adaptive=${this.config.adaptive}`);

    const coreApi = this.kubeconfig.makeApiClient(k8s.CoreV1Api);

    try {
      // Initial LIST to seed state
      const listResponse = await coreApi.listNamespacedPod(
        this.namespace,
        undefined, // pretty
        undefined, // allowWatchBookmarks
        undefined, // continue
        undefined, // fieldSelector
        this.selector // labelSelector
      );

      // Capture resourceVersion for watch continuity
      this.resourceVersion = listResponse.body.metadata.resourceVersion;

      // Count initial pending Pods
      for (const pod of listResponse.body.items) {
        const phase = pod.status?.phase;
        const podName = pod.metadata.name;

        this.state.podPhases.set(podName, phase);
        if (phase === 'Pending') {
          this.state.pendingCount++;
        }
      }

      this.log(`Initial state: ${this.state.pendingCount} pending Pods (${listResponse.body.items.length} total, resourceVersion=${this.resourceVersion})`);

      // Start watch
      await this._startWatch();

      // Start adaptive tuning loop
      this.adaptInterval = setInterval(() => {
        this._refillTokens();
        if (this.config.adaptive) {
          this._adapt();
        }
      }, this.config.adaptIntervalMs);

      this.initialized = true;
      this.log('Admission controller initialized successfully');
    } catch (err) {
      clog.error('[AdmissionController] Initialization failed:', err.message);
      throw err;
    }
  }

  /**
   * Start watching Pod events
   */
  async _startWatch() {
    this.watchAbortController = new AbortController();
    this.watch = new k8s.Watch(this.kubeconfig);

    const path = `/api/v1/namespaces/${this.namespace}/pods`;
    const queryParams = { labelSelector: this.selector };
    if (this.resourceVersion) {
      queryParams.resourceVersion = this.resourceVersion;
    }

    this.log(`Starting watch on ${path}?labelSelector=${this.selector}&resourceVersion=${this.resourceVersion || 'none'}`);

    try {
      await this.watch.watch(
        path,
        queryParams,
        this._handleWatchEvent.bind(this),
        this._handleWatchError.bind(this),
        this.watchAbortController.signal
      );
    } catch (err) {
      clog.error('[AdmissionController] Watch failed to start:', err.message);
      throw err;
    }
  }

  /**
   * Handle individual watch events (ADDED, MODIFIED, DELETED)
   */
  _handleWatchEvent(phase, obj) {
    const podName = obj?.metadata?.name;
    const currentPhase = obj?.status?.phase;

    if (!podName) {
      return; // Invalid event
    }

    const previousPhase = this.state.podPhases.get(podName);

    switch (phase) {
      case 'ADDED':
        this.state.podPhases.set(podName, currentPhase);
        if (currentPhase === 'Pending') {
          this.state.pendingCount++;
          this.log(`Pod ${podName} added (Pending), total pending: ${this.state.pendingCount}`);
        }
        break;

      case 'MODIFIED':
        // Detect phase transitions
        if (previousPhase !== currentPhase) {
          this.log(`Pod ${podName} transition: ${previousPhase} -> ${currentPhase}`);

          if (previousPhase === 'Pending' && currentPhase === 'Running') {
            // Track Pending -> Running transitions for throughput measurement
            this.state.pendingCount = Math.max(0, this.state.pendingCount - 1);
            this.state.runningTransitions++;
            this.log(`Pod ${podName} started running, pending: ${this.state.pendingCount}, transitions: ${this.state.runningTransitions}`);
          } else if (previousPhase === 'Pending' && currentPhase !== 'Pending') {
            // Other transitions away from Pending (e.g., Failed, Unknown)
            this.state.pendingCount = Math.max(0, this.state.pendingCount - 1);
          } else if (previousPhase !== 'Pending' && currentPhase === 'Pending') {
            // Transitions into Pending (rare but possible)
            this.state.pendingCount++;
          }

          this.state.podPhases.set(podName, currentPhase);
        }
        break;

      case 'DELETED':
        // Remove from tracking
        if (previousPhase === 'Pending') {
          this.state.pendingCount = Math.max(0, this.state.pendingCount - 1);
          this.log(`Pending pod ${podName} deleted, pending: ${this.state.pendingCount}`);
        }
        this.state.podPhases.delete(podName);
        break;

      case 'BOOKMARK':
        // Bookmark events are for watch reliability, no action needed
        break;

      default:
        this.log(`Unknown watch event type: ${phase}`);
    }
  }

  /**
   * Handle watch errors: re-LIST to re-seed state, then restart watch
   */
  _handleWatchError(err) {
    if (err) {
      clog.warn('[AdmissionController] Watch error:', err.message);
    } else {
      this.log('Watch stream ended normally');
    }

    const delay = this.reconnectBackoffMs;
    this.log(`Reconnecting in ${delay}ms (re-LIST + watch)...`);

    setTimeout(async () => {
      try {
        await this._reconnect();
        // Reset backoff on successful reconnect
        this.reconnectBackoffMs = 1000;
      } catch (reconnectErr) {
        clog.error('[AdmissionController] Reconnection failed:', reconnectErr.message);
        // Exponential backoff up to 30 seconds
        this.reconnectBackoffMs = Math.min(this.reconnectBackoffMs * 2, 30000);
        this._handleWatchError(reconnectErr);
      }
    }, delay);
  }

  /**
   * Re-LIST to rebuild accurate state, then start a new watch
   */
  async _reconnect() {
    const coreApi = this.kubeconfig.makeApiClient(k8s.CoreV1Api);

    const listResponse = await coreApi.listNamespacedPod(
      this.namespace,
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // continue
      undefined, // fieldSelector
      this.selector // labelSelector
    );

    // Reset state from fresh LIST
    this.state.podPhases.clear();
    this.state.pendingCount = 0;
    this.resourceVersion = listResponse.body.metadata.resourceVersion;

    for (const pod of listResponse.body.items) {
      const phase = pod.status?.phase;
      const podName = pod.metadata.name;
      this.state.podPhases.set(podName, phase);
      if (phase === 'Pending') {
        this.state.pendingCount++;
      }
    }

    this.log(`Reconnect re-LIST: ${this.state.pendingCount} pending Pods (${listResponse.body.items.length} total, resourceVersion=${this.resourceVersion})`);

    await this._startWatch();
  }

  /**
   * Refill token bucket based on elapsed time
   */
  _refillTokens() {
    const now = Date.now() / 1000;
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.fillRate;

    this.tokens = Math.min(this.config.burst, this.tokens + newTokens);
    this.lastRefill = now;
  }

  /**
   * Adaptive tuning: adjust fillRate and pendingMax based on observed metrics
   */
  _adapt() {
    const now = Date.now();
    const elapsedSec = (now - this.state.lastAdaptTime) / 1000;

    // Calculate current scheduling throughput (Pods/sec)
    const currentRate = elapsedSec > 0 ? this.state.runningTransitions / elapsedSec : 0;

    // Update EWMA of scheduling throughput
    const alpha = this.config.runningRateAlpha;
    this.state.runningRateEWMA = alpha * currentRate + (1 - alpha) * this.state.runningRateEWMA;

    // Reset counters for next interval
    this.state.runningTransitions = 0;
    this.state.lastAdaptTime = now;

    // Adapt fillRate: increase if throughput is good, decrease if errors
    // If we're successfully scheduling pods, we can increase submission rate
    // Target 1.2x observed throughput to stay ahead of the scheduler
    const targetRate = Math.max(1.0, 1.2 * this.state.runningRateEWMA);

    // Reduce fillRate if we're seeing API errors
    const errorPenalty = Math.max(0.5, 1 - 2 * this.state.createErrorEWMA);

    // Keep fillRate within reasonable bounds
    const configuredRate = parseFloat(process.env.HF_VAR_ADMISSION_FILL_RATE) || this.config.initialFillRate;
    this.fillRate = Math.max(1.0, Math.min(configuredRate * 2, targetRate * errorPenalty));

    // Adapt pendingMax with hysteresis to prevent under-utilization during temporary slowdowns
    // Calculate target pendingMax based on current throughput
    const minuteBuffer = Math.round(60 * Math.max(0.5, this.state.runningRateEWMA));
    const targetPendingMax = Math.min(
      this.config.maxPendingMax,
      Math.max(this.config.minPendingMax, minuteBuffer)
    );

    // Hysteresis: increase immediately, decrease only after sustained slowdown (2 minutes)
    const hysteresisWindowMs = 120000; // 2 minutes
    const timeSinceLastDecrease = now - this.state.lastPendingMaxDecrease;

    if (targetPendingMax > this.config.pendingMax) {
      // INCREASE: immediate (aggressive)
      this.config.pendingMax = targetPendingMax;
    } else if (targetPendingMax < this.config.pendingMax) {
      // DECREASE: only if slowdown persists > 2 minutes (conservative)
      if (timeSinceLastDecrease >= hysteresisWindowMs) {
        this.config.pendingMax = targetPendingMax;
        this.state.lastPendingMaxDecrease = now;
      }
      // Otherwise: keep current pendingMax (ignore temporary dip)
    }

    this.log(`Adapt: rate=${currentRate.toFixed(2)} pods/s, EWMA=${this.state.runningRateEWMA.toFixed(2)}, fillRate=${this.fillRate.toFixed(2)}, pendingMax=${this.config.pendingMax}, errors=${this.state.createErrorEWMA.toFixed(3)}, tracked=${this.state.podPhases.size}`);

    // Periodic cleanup of terminated pods from podPhases map (every 5 minutes)
    this._cleanupCounter++;
    if (this._cleanupCounter >= 300) {
      this._cleanupCounter = 0;
      let cleaned = 0;
      for (const [name, phase] of this.state.podPhases) {
        if (phase === 'Succeeded' || phase === 'Failed') {
          this.state.podPhases.delete(name);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.log(`Cleaned ${cleaned} terminated pods from tracking map (remaining: ${this.state.podPhases.size})`);
      }
    }
  }

  /**
   * Acquire a permit to create a Pod (waits for both gates to allow)
   * Returns immediately after acquiring permit - does NOT execute Pod creation
   * Use this for fire-and-forget pattern to preserve parallelism
   */
  async acquirePermit() {
    if (!this.initialized) {
      throw new Error('AdmissionController not initialized. Call initialize() first.');
    }

    while (true) {
      // Gate 1: Pending window
      if (this.state.pendingCount >= this.config.pendingMax) {
        const delay = this._jitter(150, 400);
        const now = Date.now();
        if (now - this.lastGate1LogTime >= this.gateLogThrottleMs) {
          this.log(`Gate 1 blocked: pending (${this.state.pendingCount}) >= max (${this.config.pendingMax}), waiting ${delay}ms`);
          this.lastGate1LogTime = now;
        }
        await this._sleep(delay);
        continue;
      }

      // Gate 2: Token bucket
      this._refillTokens();
      if (this.tokens < 1) {
        const delay = this._jitter(50, 150);
        const now = Date.now();
        if (now - this.lastGate2LogTime >= this.gateLogThrottleMs) {
          this.log(`Gate 2 blocked: no tokens (${this.tokens.toFixed(2)}), waiting ${delay}ms`);
          this.lastGate2LogTime = now;
        }
        await this._sleep(delay);
        continue;
      }

      // Both gates passed, consume token and return permit
      this.tokens -= 1;

      this.log(`Permit acquired (pending: ${this.state.pendingCount}, tokens: ${this.tokens.toFixed(2)})`);
      return; // Permit granted
    }
  }

  /**
   * Release a permit (call if Pod creation failed and you want to return the token)
   * Only returns the token; pendingCount is managed solely by the watch.
   */
  releasePermit() {
    this.tokens = Math.min(this.config.burst, this.tokens + 1);
    this.log(`Permit released (tokens: ${this.tokens.toFixed(2)})`);
  }

  /**
   * Record an error for adaptive tuning (updates error EWMA)
   * Call this if Pod creation failed after acquiring a permit
   */
  recordError() {
    this.state.createErrorEWMA = this.config.errorRateAlpha * 1 +
                                  (1 - this.config.errorRateAlpha) * this.state.createErrorEWMA;
  }

  /**
   * Gate function: wait until both gates (pending window + token bucket) allow submission
   * Then execute the provided Pod creation function
   *
   * This is the all-in-one method that handles permit acquisition, execution, and error handling.
   * For fire-and-forget pattern, use acquirePermit() instead.
   */
  async maybeSubmit(createPodFn) {
    if (!this.initialized) {
      throw new Error('AdmissionController not initialized. Call initialize() first.');
    }

    while (true) {
      // Acquire permit (waits for gates)
      await this.acquirePermit();

      try {
        this.log(`Submitting Pod (pending: ${this.state.pendingCount}, tokens: ${this.tokens.toFixed(2)})`);
        await createPodFn();

        // Reset backoff on success
        this.backoffMs = this.config.backoffInitialMs;

        return; // Success

      } catch (err) {
        // Return the permit
        this.releasePermit();

        // Update error rate EWMA
        this.recordError();

        // Check if it's a retryable error
        const statusCode = err.response?.statusCode || err.statusCode;
        const isRetryable = statusCode === 409 || statusCode === 429 || statusCode >= 500;

        if (isRetryable) {
          // Exponential backoff with jitter
          const delay = this._jitter(this.backoffMs, this.backoffMs * 2);
          clog.warn(`[AdmissionController] Pod creation failed (${statusCode}), retrying after ${delay}ms:`, err.message);

          this.backoffMs = Math.min(this.backoffMs * 2, this.config.backoffMaxMs);
          await this._sleep(delay);
          continue; // Retry (will acquire new permit)
        } else {
          // Non-retryable error, propagate
          clog.error('[AdmissionController] Pod creation failed with non-retryable error:', err.message);
          throw err;
        }
      }
    }
  }

  /**
   * Shutdown the admission controller
   */
  async shutdown() {
    this.log('Shutting down admission controller...');

    if (this.adaptInterval) {
      clearInterval(this.adaptInterval);
      this.adaptInterval = null;
    }

    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = null;
    }

    this.initialized = false;
    this.log('Admission controller shut down');
  }

  /**
   * Get current state (for monitoring/debugging)
   */
  getState() {
    return {
      pendingCount: this.state.pendingCount,
      runningRateEWMA: this.state.runningRateEWMA,
      createErrorEWMA: this.state.createErrorEWMA,
      fillRate: this.fillRate,
      tokens: this.tokens,
      pendingMax: this.config.pendingMax,
      backoffMs: this.backoffMs
    };
  }

  // Utility functions
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _jitter(minMs, maxMs) {
    return Math.floor(minMs + Math.random() * (maxMs - minMs));
  }

  log(message) {
    if (this.config.debug) {
      clog.debug(`[AdmissionController] ${message}`);
    }
  }
}

module.exports = { K8sAdmissionController };
