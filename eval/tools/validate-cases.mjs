// Format check for labelled cases. Prints counts and problems only, never case contents.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const CHECKS = ["MODE","ALLOW","DENY","ENDPOINT","HOOK","HTTPHOOK","MCP","DRIFT","SECRET","SKILL"];
const dir = process.argv[2];
const split = process.argv[3];
const problems = [];
const counts = Object.fromEntries(CHECKS.map((c) => [c, 0]));
let benign = 0, total = 0, withBefore = 0;
const ids = new Set();
for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
  total++;
  let c;
  try { c = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { problems.push(`${name}: not JSON`); continue; }
  if (c.id + ".json" !== name) problems.push(`${name}: id mismatch`);
  if (ids.has(c.id)) problems.push(`${name}: duplicate id`); ids.add(c.id);
  if (c.split !== split) problems.push(`${name}: split=${c.split}`);
  if (!Array.isArray(c.risky) || c.risky.some((r) => !CHECKS.includes(r))) problems.push(`${name}: bad risky`);
  if (new Set(c.risky).size !== c.risky.length) problems.push(`${name}: duplicate risky entry`);
  if (typeof c.rationale !== "string" || c.rationale.length < 10) problems.push(`${name}: rationale missing`);
  if (typeof c.source !== "string") problems.push(`${name}: source missing`);
  for (const key of ["files", "before"]) {
    if (key === "before" && c.before === undefined) continue;
    const f = c[key];
    if (!f || typeof f !== "object" || Array.isArray(f) || Object.keys(f).length === 0) { problems.push(`${name}: ${key} empty or bad`); continue; }
    for (const [p, v] of Object.entries(f)) {
      if (!/^(~|\.)\//.test(p)) problems.push(`${name}: ${key} path ${p}`);
      if (typeof v !== "string" && (typeof v !== "object" || v === null)) problems.push(`${name}: ${key} value type at ${p}`);
    }
  }
  if (c.before) withBefore++;
  if (c.risky.includes("DRIFT") && !c.before) problems.push(`${name}: DRIFT without before`);
  if (c.risky.length === 0) benign++;
  for (const r of c.risky) counts[r]++;
}
console.log(JSON.stringify({ total, benign, withBefore, counts, problems }, null, 1));
