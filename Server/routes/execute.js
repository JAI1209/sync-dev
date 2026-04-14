const express = require("express");
const vm = require("vm");
const { authJwt } = require("../middleware/authJwt");
const {
  MAX_CODE_BYTES,
  EXECUTE_MAX_TIMEOUT_MS,
} = require("../config/constants");

const router = express.Router();

let ts = null;
try {
  ts = require("typescript");
} catch {
  /* optional */
}

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

router.post("/run", authJwt, (req, res) => {
  const code = req.body.code;
  const language = String(req.body.language || "javascript").toLowerCase();

  if (code == null || typeof code !== "string") {
    return res.status(400).json({ msg: "code is required" });
  }
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    return res.status(400).json({ msg: "Code exceeds size limit." });
  }

  let js = code;
  if (language === "typescript" || language === "ts" || language === "tsx") {
    if (!ts) {
      return res.status(503).json({
        msg: "TypeScript is not installed on the server. Run: npm install typescript (in Server/).",
      });
    }
    try {
      const out = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: language === "tsx" ? ts.JsxEmit.React : ts.JsxEmit.None,
        },
      });
      js = out.outputText;
    } catch (e) {
      return res.status(400).json({
        ok: false,
        logs: [],
        error: e.message || "TypeScript transpile failed",
      });
    }
  }

  const { logs, sandbox } = buildSandbox();
  if (language === "tsx") {
    sandbox.React = {
      createElement: () => null,
      Fragment: Symbol.for("react.fragment"),
    };
  }
  const timeout = Math.min(EXECUTE_MAX_TIMEOUT_MS, 30000);

  const wrapped = `"use strict";\n(function(){\n${js}\n})();`;

  try {
    vm.runInNewContext(wrapped, sandbox, {
      timeout,
      displayErrors: true,
    });
    return res.json({ ok: true, logs, error: null });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return res.json({ ok: false, logs, error: msg });
  }
});

module.exports = router;
