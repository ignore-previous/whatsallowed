// Picks 30 test cases at random (fixed seed) and writes the blind labelling sheet: the config files only,
// with no labels, rationales, tool output or case IDs (an ID like "hook-04" would give the answer away).
// The reviewer fills the sheet in place, then `npm run kappa:import` turns it into eval/kappa/reviewer-labels.json.
// Run: node eval/tools/kappa-sheet.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SEED = 20261019;
const N = 30;

/** The 30 case IDs, in the (shuffled, so the order gives nothing away) order they appear in the sheet. */
export function pickCases(dir = "eval/cases/test") {
  let s = SEED >>> 0;
  const rand = () => ((s = (s + 0x6d2b79f5) >>> 0), (((s ^ (s >>> 15)) * (1 | s)) >>> 0) / 2 ** 32);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };
  const ids = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  shuffle(ids);
  const pick = ids.slice(0, N).sort();
  shuffle(pick);
  return pick.map((n) => n.replace(/\.json$/, ""));
}

const show = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

function ruleText() {
  const t = readFileSync("eval/LABELLING.md", "utf8");
  const a = t.indexOf("## What a label is");
  const b = t.indexOf("## Process");
  return t.slice(a, b).trim().replace(/^## /gm, "### ");
}

function writeSheet() {
  const dir = "eval/cases/test";
  const pick = pickCases(dir);
  let md = `# Blind labelling sheet (${N} test cases)

**What to do** (about 45 minutes; don't look at the tool's output, \`docs/ACCURACY.md\` or the case files first):
1. Read the labelling rule below once.
2. For each case, write after \`Risky for:\` the checks it is risky for, separated by commas (MODE, ALLOW, DENY, ENDPOINT, HOOK, HTTPHOOK, MCP, DRIFT, SECRET, SKILL), or \`none\`. Leave nothing blank.
3. Save this file, then run \`npm run kappa:import\` and \`npm run eval\`. The first turns your answers into \`eval/kappa/reviewer-labels.json\` and says what is missing or misspelt; the second puts the agreement figure on the accuracy page.

Paths: \`~/\` is the home folder, \`./\` is the project folder. "Before" files are the baseline recorded earlier. Fake keys are stored with \`@@SPLIT@@\` after the provider prefix; read \`sk-ant-api03-@@SPLIT@@Zq8…\` as the key \`sk-ant-api03-Zq8…\`.

## The labelling rule

${ruleText()}

---

## The cases

`;
  pick.forEach((id, i) => {
    const c = JSON.parse(readFileSync(join(dir, id + ".json"), "utf8"));
    md += `### Case ${i + 1} of ${N}\n\n`;
    for (const [p, v] of Object.entries(c.files)) md += `**${p}**\n\n\`\`\`\n${show(v)}\n\`\`\`\n\n`;
    if (c.before) for (const [p, v] of Object.entries(c.before)) md += `**Before (baseline): ${p}**\n\n\`\`\`\n${show(v)}\n\`\`\`\n\n`;
    md += "Risky for: \n\n---\n\n";
  });
  writeFileSync("eval/kappa/sheet.md", md);
  const template = Object.fromEntries([...pick].sort().map((id) => [id, []]));
  const tpl = "eval/kappa/reviewer-labels.template.json";
  if (!existsSync("eval/kappa/reviewer-labels.json")) writeFileSync(tpl, JSON.stringify(template, null, 2) + "\n");
  console.log(`wrote eval/kappa/sheet.md with ${pick.length} cases`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) writeSheet();
