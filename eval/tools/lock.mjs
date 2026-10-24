// Write or verify eval/test.lock: a sha256 per test case (line endings normalised) and one for the set.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "./keys.mjs";
// Usage: node eval/tools/lock.mjs write|verify [--force] [--dir eval/cases/test-win --lock eval/test-win.lock].
// Hashes the assembled text (keys.mjs), so storing fake keys split doesn't change a frozen set.
const opt = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const dir = opt("--dir", "eval/cases/test");
const lockPath = opt("--lock", "eval/test.lock");
const sha = (s) => createHash("sha256").update(s).digest("hex");
export function computeLock() {
  const files = {};
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    files[n] = sha(assemble(readFileSync(join(dir, n), "utf8")).replace(/\r\n/g, "\n"));
  }
  const set = sha(Object.entries(files).map(([n, h]) => `${n} ${h}`).join("\n"));
  return { set, count: Object.keys(files).length, files };
}
const mode = process.argv[2];
if (mode === "write") {
  if (existsSync(lockPath) && !process.argv.includes("--force")) { console.error("test.lock exists; pass --force only with a recorded reason"); process.exit(2); }
  const lock = { frozen: new Date().toISOString().slice(0, 10), ...computeLock() };
  writeFileSync(lockPath, JSON.stringify(lock, null, 1) + "\n");
  console.log(`frozen ${lock.count} cases, set ${lock.set.slice(0, 16)}`);
} else if (mode === "verify") {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const now = computeLock();
  if (now.set !== lock.set) {
    const changed = Object.keys({ ...lock.files, ...now.files }).filter((n) => lock.files[n] !== now.files[n]);
    console.error(`test split changed since freezing: ${changed.join(", ")}`);
    process.exit(1);
  }
  console.log(`test split matches lock (${now.count} cases)`);
}
