// Loaded with --import before the CLI. Any attempt at network access or spawning a process
// writes a line to stderr starting with NETWORK-ATTEMPT and throws.
import { createRequire, syncBuiltinESMExports } from "node:module";
const require = createRequire(import.meta.url);
const trip = (what) => () => {
  process.stderr.write(`NETWORK-ATTEMPT ${what}\n`);
  throw new Error(`blocked: ${what}`);
};
const block = {
  net: ["connect", "createConnection", "createServer"],
  tls: ["connect", "createServer"],
  dns: ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"],
  http: ["request", "get", "createServer"],
  https: ["request", "get", "createServer"],
  http2: ["connect", "createServer", "createSecureServer"],
  dgram: ["createSocket"],
  child_process: ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"],
};
for (const [mod, fns] of Object.entries(block)) {
  const m = require(mod);
  for (const fn of fns) m[fn] = trip(`${mod}.${fn}`);
}
require("dns").promises.lookup = trip("dns.promises.lookup");
// Replacing the Socket class breaks Node internals that extend it, so trip on connecting instead.
require("net").Socket.prototype.connect = trip("net.Socket.connect");
syncBuiltinESMExports();
globalThis.fetch = trip("fetch");
globalThis.WebSocket = trip("WebSocket");
globalThis.EventSource = trip("EventSource");
