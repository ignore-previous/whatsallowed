// Turns the filled blind-labelling sheet (eval/kappa/sheet.md) into eval/kappa/reviewer-labels.json.
// Run: npm run kappa:import      (then npm run eval to put the agreement figure on the accuracy page)
// Prints what is missing or misspelt and writes nothing until every case has an answer.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pickCases } from "./kappa-sheet.mjs";

const CHECKS = ["MODE", "ALLOW", "DENY", "ENDPOINT", "HOOK", "HTTPHOOK", "MCP", "DRIFT", "SECRET", "SKILL"];

/** Parse the filled sheet. `ids` is the case order from pickCases(). Returns { labels, problems }. */
export function parseSheet(md, ids) {
  const problems = [];
  const parts = md.split(/^### Case (\d+) of \d+\s*$/m);
  const answers = new Map();
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const m = /^\s*(?:\*\*)?Risky for(?:\*\*)?\s*:(?:\*\*)?[ \t]*(.*)$/im.exec(parts[i + 1] ?? "");
    answers.set(n, m ? m[1].trim() : undefined);
  }
  const labels = {};
  ids.forEach((id, i) => {
    const n = i + 1;
    const raw = answers.get(n);
    if (raw === undefined) return problems.push(`Case ${n}: no "Risky for:" line found`);
    if (raw === "") return problems.push(`Case ${n}: no answer yet`);
    const words = raw.split(/[\s,;/+&]+/).map((w) => w.replace(/[`*.]/g, "").toUpperCase()).filter(Boolean);
    if (words.length === 1 && ["NONE", "-", "NOTHING", "NO"].includes(words[0])) return (labels[id] = []);
    const bad = words.filter((w) => !CHECKS.includes(w));
    if (bad.length) return problems.push(`Case ${n}: don't know "${bad.join('", "')}" (use ${CHECKS.join(", ")}, or none)`);
    if (words.includes("NONE")) return problems.push(`Case ${n}: "none" can't be combined with a check`);
    labels[id] = CHECKS.filter((c) => words.includes(c));
  });
  return { labels, problems };
}

function main() {
  const ids = pickCases();
  const { labels, problems } = parseSheet(readFileSync("eval/kappa/sheet.md", "utf8"), ids);
  if (problems.length) {
    console.error(problems.join("\n") + `\n\n${problems.length} problem(s). Nothing was written.`);
    process.exit(1);
  }
  const sorted = Object.fromEntries(Object.keys(labels).sort().map((id) => [id, labels[id]]));
  writeFileSync("eval/kappa/reviewer-labels.json", JSON.stringify(sorted, null, 2) + "\n");
  const none = Object.values(labels).filter((l) => !l.length).length;
  console.log(`wrote eval/kappa/reviewer-labels.json: ${ids.length} cases (${none} marked none). Now run: npm run eval`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
