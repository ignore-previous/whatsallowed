// Regenerates the rule table at the end of docs/checks.md from src/rules.ts.
// Run: node --experimental-strip-types tools/rules-doc.ts
import { readFileSync, writeFileSync } from "node:fs";
import { RULES } from "../src/rules.ts";

const MARK = "<!-- rules:start -->";
const file = "docs/checks.md";
const head = readFileSync(file, "utf8").split(MARK)[0]!.trimEnd();
const rows = RULES.map((r) => `| \`${r.id}\` | ${r.severity} | ${r.summary.replaceAll("|", "\|")} |`);
writeFileSync(file, `${head}\n\n${MARK}\n## Rules\n\nGenerated from \`src/rules.ts\`. The level shown is the usual one; some rules set it lower for your own files, as the summary says.\n\n| Rule | Level | Summary |\n|---|---|---|\n${rows.join("\n")}\n`);
console.log(`wrote ${RULES.length} rules to ${file}`);
