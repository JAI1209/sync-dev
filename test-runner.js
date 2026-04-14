#!/usr/bin/env node
/**
 * SyncDev Test Runner
 * Usage: node test-runner.js [test-name]
 * Examples:
 *   node test-runner.js rbac
 *   node test-runner.js integration
 *   node test-runner.js all
 */

const { execSync } = require("child_process");

const tests = {
  rbac: {
    file: "Server/tests/rbac.test.js",
    desc: "RBAC permission and role tests",
  },
  comprehensive: {
    file: "Server/tests/comprehensive.test.js",
    desc: "Comprehensive test suite - all scenarios",
  },
  integration: {
    file: "Server/tests/integration.test.js",
    desc: "Full integration tests (requires running server)",
  },
};

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

function runTest(name) {
  const test = tests[name];
  if (!test) {
    console.error(`Unknown test: ${name}`);
    console.log("Available tests:", Object.keys(tests).join(", "));
    process.exit(1);
  }

  if (name === "integration" && !runIntegration) {
    console.log("\n============================================================");
    console.log("Skipping integration tests (set RUN_INTEGRATION_TESTS=1)");
    console.log("============================================================\n");
    return true;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running: ${test.desc}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    execSync(`node ${test.file}`, {
      cwd: __dirname,
      stdio: "inherit",
    });
    console.log(`\n[PASS] ${name} tests passed!`);
    return true;
  } catch {
    console.error(`\n[FAIL] ${name} tests failed!`);
    return false;
  }
}

const args = process.argv.slice(2);
const testName = args[0] || "all";

if (testName === "all") {
  let allPassed = true;
  const names = ["rbac", "comprehensive", "integration"];
  for (const name of names) {
    const passed = runTest(name);
    if (!passed) allPassed = false;
  }

  console.log(`\n${"=".repeat(60)}`);
  if (allPassed) {
    console.log("[PASS] All tests passed!");
    process.exit(0);
  }

  console.log("[FAIL] Some tests failed!");
  process.exit(1);
}

const passed = runTest(testName);
process.exit(passed ? 0 : 1);
