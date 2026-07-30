/**
 * Test/Example script for K8sAdmissionController
 *
 * This demonstrates how to use the admission controller standalone
 * or verify its behavior.
 *
 * Usage:
 *   node test-admission-controller.js
 */

const k8s = require('@kubernetes/client-node');
const { K8sAdmissionController } = require('./k8sAdmissionController.js');

async function testAdmissionController() {
  console.log('=== K8s Admission Controller Test ===\n');

  // Load kubeconfig
  const kubeconfig = new k8s.KubeConfig();
  kubeconfig.loadFromDefault();

  const namespace = process.env.HF_VAR_NAMESPACE || 'default';
  const selector = 'app=hyperflow';

  console.log(`Configuration:`);
  console.log(`  Namespace: ${namespace}`);
  console.log(`  Label selector: ${selector}`);
  console.log(`  Debug mode: enabled\n`);

  // Create admission controller with debug enabled
  const controller = new K8sAdmissionController(kubeconfig, namespace, {
    selector: selector,
    pendingMax: 10,        // Low limit for testing
    initialFillRate: 2,    // 2 tokens/sec
    burst: 5,              // Max 5 tokens
    adaptive: true,
    debug: true            // Enable debug logging
  });

  try {
    // Initialize (starts watch and adaptive loop)
    console.log('Initializing admission controller...');
    await controller.initialize();
    console.log('Admission controller initialized\n');

    // Display initial state
    console.log('Initial state:', controller.getState());
    console.log('');

    // Simulate submitting a few "Pods" (just logs, doesn't actually create)
    console.log('--- Simulating 3 Pod submissions ---\n');

    for (let i = 1; i <= 3; i++) {
      await controller.maybeSubmit(async () => {
        console.log(`  --> Mock Pod ${i} would be created here`);
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      console.log(`  Pod ${i} submission completed\n`);
    }

    // Display state after submissions
    console.log('State after submissions:', controller.getState());
    console.log('');

    // Let it run for a bit to show adaptive tuning
    console.log('Watching state for 10 seconds (observe adaptive tuning)...\n');
    const interval = setInterval(() => {
      console.log('Current state:', controller.getState());
    }, 2000);

    await new Promise(resolve => setTimeout(resolve, 10000));
    clearInterval(interval);

    // Shutdown
    console.log('\nShutting down admission controller...');
    await controller.shutdown();
    console.log('Test completed successfully!');

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

// Run test if executed directly
if (require.main === module) {
  testAdmissionController()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { testAdmissionController };
