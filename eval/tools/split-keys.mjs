// Rewrites case files so every fake key is stored split (see keys.mjs). The assembled text is unchanged,
// so the test lock, which hashes assembled text, still verifies. Run: node eval/tools/split-keys.mjs <dir>...
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble, splitKeys } from "./keys.mjs";
let changed = 0;
for (const dir of process.argv.slice(2)) {
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const p = join(dir, n);
    const raw = readFileSync(p, "utf8");
    const out = splitKeys(raw);
    if (assemble(out) !== assemble(raw)) throw new Error(`${p}: splitting changed the content`);
    if (out !== raw) (writeFileSync(p, out), changed++);
  }
}
console.log(`split keys in ${changed} files`);
