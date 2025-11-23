# Kubernetes Admission Controller

## Overview

The K8s Admission Controller prevents overwhelming the Kubernetes scheduler when submitting large numbers of workflow tasks as Pods.

### Problem

When thousands of tasks are ready to execute, creating thousands of Pods immediately can overwhelm the Kubernetes scheduler, resulting in many Pods stuck in Pending state and API throttling (HTTP 429 errors).

### Solution

The admission controller implements a local gate using:

1. **Watch-based state tracking** - Monitors Pod state via long-lived watch (no polling)
2. **Token bucket rate limiter** - Smoothly paces Pod creation requests
3. **Concurrency window** - Caps the number of pending Pods
4. **Adaptive tuning** - Automatically adjusts limits based on observed cluster throughput

## How It Works

### Two-Gate Model

Every task submission must pass through two gates:

**Gate 1: Concurrency Window**
```
IF pendingCount >= pendingMax THEN wait
```
- Prevents too many Pods stuck in Pending state
- `pendingCount` tracked in real-time via Kubernetes Watch API
- `pendingMax` is the maximum allowed pending Pods

**Gate 2: Token Bucket**
```
IF tokens < 1 THEN wait
tokens = tokens - 1
```
- Smooths out bursts and paces submissions over time
- Tokens refill continuously at rate `fillRate` (tokens/second)
- Maximum token accumulation capped at `burst`

### Token Bucket Refill

```
elapsed = currentTime - lastRefillTime
newTokens = elapsed * fillRate
tokens = min(burst, tokens + newTokens)
```

**Parameters:**
- `fillRate` - Tokens added per second (controls submission rate)
- `burst` - Maximum token accumulation (handles bursts)
- `tokens` - Current available tokens

### Adaptive Tuning

Every second, the controller measures cluster performance and adjusts parameters:

**Throughput Measurement:**
```
currentRate = Pending→Running transitions / elapsed time (pods/sec)
runningRateEWMA = α × currentRate + (1 - α) × runningRateEWMA
```

**Fill Rate Adaptation:**
```
targetRate = max(1.0, 1.2 × runningRateEWMA)
errorPenalty = max(0.5, 1 - 2 × createErrorEWMA)
fillRate = max(1.0, min(configuredRate × 2, targetRate × errorPenalty))
```

**Pending Max Adaptation (with Hysteresis):**
```
minuteBuffer = round(60 × max(0.5, runningRateEWMA))
targetPendingMax = clamp(minuteBuffer, minPendingMax, maxPendingMax)

IF targetPendingMax > pendingMax THEN
  pendingMax = targetPendingMax  // Increase immediately (aggressive)
ELSE IF targetPendingMax < pendingMax AND timeSinceLastDecrease > 2 minutes THEN
  pendingMax = targetPendingMax  // Decrease only if sustained (conservative)
  lastPendingMaxDecrease = now
ELSE
  // Keep current pendingMax (ignore temporary dip)
END
```

**Parameters:**
- `α` (alpha) = 0.2 - EWMA smoothing factor (higher = more reactive)
- `runningRateEWMA` - Exponentially weighted moving average of scheduling rate
- `createErrorEWMA` - EWMA of API error rate (0-1)
- `minPendingMax` = 50 - Minimum allowed pending limit
- `maxPendingMax` = 2000 - Maximum allowed pending limit
- `hysteresisWindow` = 2 minutes - Minimum time before decreasing pendingMax

**Adaptive behavior:**
- **High throughput observed** → increase `fillRate` to submit more
- **API errors detected** → reduce `fillRate` via error penalty
- **Fast scheduling** → increase `pendingMax` immediately (aggressive)
- **Temporary slowdown** → keep `pendingMax` high (prevent under-utilization)
- **Sustained slowdown (>2 min)** → decrease `pendingMax` conservatively

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HF_VAR_ADMISSION_CONTROLLER` | `1` | Set to `0` to disable |
| `HF_VAR_ADMISSION_PENDING_MAX` | `200` | Max pending Pods |
| `HF_VAR_ADMISSION_FILL_RATE` | `1` | Token fill rate (tokens/sec) |
| `HF_VAR_ADMISSION_BURST` | `20` | Max token bucket size |
| `HF_VAR_ADMISSION_ADAPTIVE` | `1` | Set to `0` to disable adaptive tuning |
| `HF_VAR_ADMISSION_DEBUG` | `0` | Set to `1` to enable debug logging |

## Usage

The admission controller is **automatically enabled** when using the standard HyperFlow k8s executor. No code changes required.

To disable:
```bash
export HF_VAR_ADMISSION_CONTROLLER=0
```

## Tuning Examples

### Conservative (Small Clusters)
```bash
export HF_VAR_ADMISSION_PENDING_MAX=50
export HF_VAR_ADMISSION_FILL_RATE=1
export HF_VAR_ADMISSION_BURST=10
```

### Aggressive (Large Clusters)
```bash
export HF_VAR_ADMISSION_PENDING_MAX=500
export HF_VAR_ADMISSION_FILL_RATE=10
export HF_VAR_ADMISSION_BURST=50
```

### Adaptive (Recommended)
```bash
export HF_VAR_ADMISSION_ADAPTIVE=1
# Controller automatically adjusts based on observed cluster performance
```
