const express = require("express");
const vm = require("vm");
const { authJwt } = require("../middleware/authJwt");

const router = express.Router();

let ts = null;
try {
  ts = require("typescript");
} catch {
  /* optional */
}

const MAX_CODE_BYTES = 500 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

function buildSandbox() {
  const logs = [];
  const capture =
    (type) =>
    (...args) => {
      logs.push({ type, text: args.map((a) => String(a)).join(" ") });
    };
  return {
    logs,
    sandbox: {
      console: {
        log: capture("log"),
        info: capture("log"),
        warn: capture("warn"),
        error: capture("error"),
        debug: capture("log"),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Math,
      JSON,
      Date,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Symbol,
      BigInt,
      Promise,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Reflect,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      RegExp,
      ArrayBuffer,
      Uint8Array,
      Int8Array,
      Uint16Array,
      Int16Array,
      Uint32Array,
      Int32Array,
      Float32Array,
      Float64Array,
      DataView,
      TextEncoder,
      TextDecoder,
    },
  };
}

/**
 * CRITICAL SECURITY NOTICE:
 * Server-side code execution via vm.runInNewContext has been DISABLED.
 * 
 * The Node.js vm module is NOT a security sandbox. Users can escape via:
 *   Promise.resolve().constructor.constructor('return process')()
 *   setTimeout.constructor('return process')()
 * 
 * This allows reading process.env (MONGODB_URI, JWT_SECRET, API keys) 
 * and arbitrary code execution.
 * 
 * Use WebContainer in the frontend instead, or implement proper isolation
 * with isolated-vm package or sandboxed Docker containers.
 */

router.post("/run", authJwt, (req, res) => {
  return res.status(503).json({
    ok: false,
    logs: [],
    error: "Server-side code execution disabled for security. Use WebContainer in browser instead.",
  });
});

module.exports = router;
