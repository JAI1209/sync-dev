#!/usr/bin/env node
/**
 * SyncDev Test Runner
 * Usage: node test-runner.js [test-name]
 * Examples:
 *   node test-runner.js rbac
 *   node test-runner.js integration
 *   node test-runner.js all
 */

const { execSync } = require('child_process');
const path = require('path');

const tests = {
  rbac: {
    file: 'Server/tests/rbac.test.js',
    desc: 'RBAC permission and role tests'
  },
  comprehensive: {
    file: 'Server/tests/comprehensive.test.js',
    desc: 'Comprehensive test suite - all scenarios'
  },
  integration: {
    file: 'Server/tests/integration.test.js',
    desc: 'Full integration tests (requires running server)'
  }
};

function runTest(name) {
  const test = tests[name];
  if (!test) {
    console.error(`Unknown test: ${name}`);
    console.log('Available tests:', Object.keys(tests).join(', '));
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${test.desc}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    execSync(`node ${test.file}`, {
      cwd: __dirname,
      stdio: 'inherit'
    });
    console.log(`\n✅ ${name} tests passed!`);
    return true;
  } catch (err) {
    console.error(`\n❌ ${name} tests failed!`);
    return false;
  }
}

const args = process.argv.slice(2);
const testName = args[0] || 'all';

if (testName === 'all') {
  let allPassed = true;
  for (const name of Object.keys(tests)) {
    const passed = runTest(name);
    if (!passed) allPassed = false;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  if (allPassed) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
} else {
  const passed = runTest(testName);
  process.exit(passed ? 0 : 1);
}
