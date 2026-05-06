const MIN_PORT = 3001;
const MAX_PORT = 3999;
const used = new Set();

async function allocatePort() {
  for (let p = MIN_PORT; p <= MAX_PORT; p += 1) {
    if (!used.has(p)) {
      used.add(p);
      return p;
    }
  }
  throw new Error("No free ports available (3001–3999 exhausted)");
}

function releasePort(port) {
  used.delete(Number(port));
}

module.exports = { allocatePort, releasePort };
