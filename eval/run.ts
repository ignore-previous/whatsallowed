/**
 * Eval harness. Scans every labelled case in memory and reports per-check precision and recall
 * with Wilson 95% intervals. No disk writes except the reports, no network.
 *
 *   node --experimental-strip-types eval/run.ts [--split dev|test] [--no-write] [--check-thresholds]
 *
 * The published figures (docs/ACCURACY.md) come from the test split only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordBaseline } from "../src/checks/drift.ts";
import { memFs } from "../src/fsys.ts";
import { TOOL_NAME, TOOL_VERSION } from "../src/name.ts";
import { scan } from "../src/scan.ts";
import { CHECK_IDS, type CheckId, type Finding } from "../src/types.ts";

export const HOME = "/home/user";
export const PROJECT = "/home/user/project";
/** Windows cases (`platform: "windows"`) put the machine here instead. */
export const WIN_HOME = "C:/Users/user";
export const WIN_PROJECT = "C:/Users/user/project";

/** Same marker as eval/tools/keys.mjs: fake keys are stored split and assembled here. */
export const SPLIT = "@@SPLIT@@";
export const assemble = (text: string): string => text.replaceAll(SPLIT, "");

export interface Case {
  id: string;
  split: "dev" | "test";
  risky: CheckId[];
  rationale: string;
  source: string;
  files: Record<string, unknown>;
  before?: Record<string, unknown>;
  platform?: "windows";
}

export function toFsMap(files: Record<string, unknown>, home = HOME, project = PROJECT): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, v] of Object.entries(files)) {
    const abs = p.startsWith("~/") ? `${home}/${p.slice(2)}` : p.startsWith("./") ? `${project}/${p.slice(2)}` : p;
    out[abs] = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  }
  return out;
}

export function scanCase(c: Case): Finding[] {
  const win = c.platform === "windows";
  const home = win ? WIN_HOME : HOME;
  const project = win ? WIN_PROJECT : PROJECT;
  const base = { home, project, mode: "all" as const, managedDirs: [] };
  let baseline;
  if (c.before) {
    const before = scan({ ...base, fs: memFs(toFsMap(c.before, home, project)) });
    baseline = recordBaseline(before.model, "2026-01-01T00:00:00.000Z");
  }
  return scan({ ...base, fs: memFs(toFsMap(c.files, home, project)), baseline }).findings;
}

/** Wilson score interval, 95%. */
export function wilson(k: number, n: number): [number, number] | undefined {
  if (n === 0) return undefined;
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface CheckStats {
  check: CheckId;
  positives: number;
  tp: number;
  fn: number;
  fp: number;
  precision?: number;
  precisionCI?: [number, number];
  recall?: number;
  recallCI?: [number, number];
  missed: string[];
  falseAlarms: Array<{ id: string; rules: string[] }>;
}

export function loadCases(split: string): Case[] {
  const dir = join("eval", "cases", split);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => JSON.parse(assemble(readFileSync(join(dir, n), "utf8"))) as Case);
}

export function evaluate(cases: Case[]): { stats: CheckStats[]; perCase: Array<{ id: string; risky: CheckId[]; alerted: CheckId[]; rules: string[] }> } {
  const stats = new Map<CheckId, CheckStats>(CHECK_IDS.map((c) => [c, { check: c, positives: 0, tp: 0, fn: 0, fp: 0, missed: [], falseAlarms: [] }]));
  const perCase = [];
  for (const c of cases) {
    const findings = scanCase(c).filter((f) => f.severity !== "info");
    const alerted = new Set(findings.map((f) => f.check));
    for (const check of CHECK_IDS) {
      const s = stats.get(check)!;
      const risky = c.risky.includes(check);
      if (risky) s.positives++;
      if (risky && alerted.has(check)) s.tp++;
      else if (risky) (s.fn++, s.missed.push(c.id));
      else if (alerted.has(check)) (s.fp++, s.falseAlarms.push({ id: c.id, rules: [...new Set(findings.filter((f) => f.check === check).map((f) => f.rule))] }));
    }
    perCase.push({ id: c.id, risky: c.risky, alerted: [...alerted].sort(), rules: [...new Set(findings.map((f) => f.rule))].sort() });
  }
  for (const s of stats.values()) {
    const fired = s.tp + s.fp;
    if (fired) ((s.precision = s.tp / fired), (s.precisionCI = wilson(s.tp, fired)));
    if (s.positives) ((s.recall = s.tp / s.positives), (s.recallCI = wilson(s.tp, s.positives)));
  }
  return { stats: [...stats.values()], perCase };
}

const pct = (x?: number): string => (x === undefined ? "n/a" : `${(x * 100).toFixed(0)}%`);
const ci = (x?: [number, number]): string => (x ? `${pct(x[0])}–${pct(x[1])}` : "n/a");

/** Cohen's kappa over per-check binary labels for the blind-labelled sample. */
export function kappa(a: CheckId[][], b: CheckId[][]): number | undefined {
  let agree = 0, n = 0, aYes = 0, bYes = 0;
  for (let i = 0; i < a.length; i++) {
    for (const c of CHECK_IDS) {
      const x = a[i]!.includes(c), y = b[i]!.includes(c);
      n++;
      if (x === y) agree++;
      if (x) aYes++;
      if (y) bYes++;
    }
  }
  if (!n) return undefined;
  const po = agree / n;
  const pe = (aYes / n) * (bYes / n) + (1 - aYes / n) * (1 - bYes / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

const KAPPA_FILE = join("eval", "kappa", "reviewer-labels.json");

/** One plain sentence near the top of the page on who labelled. It follows whether the maintainer's labels are in. */
function labelProvenance(): string {
  return existsSync(KAPPA_FILE)
    ? 'Every label came from an AI model, except that the maintainer also labelled a 30-case sample of the test split blind (see "Label agreement"). No person labelled the real-world alerts.'
    : "Every label on this page came from an AI model, not a person.";
}

function kappaSection(cases: Case[]): string {
  const file = KAPPA_FILE;
  if (!existsSync(file)) {
    return "No person has labelled any test case yet: the maintainer's blind labels for a 30-case sample aren't in (`eval/kappa/reviewer-labels.json`). Until they are, every label comes from AI models (the agents that wrote the cases and, for the real-world alerts, two other models), so the figures above measure agreement with those models' reading of the labelling rule, not with a person's.\n";
  }
  const reviewer = JSON.parse(readFileSync(file, "utf8")) as Record<string, CheckId[]>;
  const ids = Object.keys(reviewer).filter((id) => cases.some((c) => c.id === id));
  const k = kappa(ids.map((id) => cases.find((c) => c.id === id)!.risky), ids.map((id) => reviewer[id]!));
  const disagree = ids.filter((id) => [...cases.find((c) => c.id === id)!.risky].sort().join() !== [...reviewer[id]!].sort().join());
  return `The maintainer labelled ${ids.length} test cases blind, without seeing the case labels or the tool's output. Cohen's kappa between those labels and the case labels, per check and case: **${k?.toFixed(2) ?? "n/a"}**. Cases where the labels differ: ${disagree.length ? disagree.map((d) => `\`${d}\``).join(", ") : "none"}.\n`;
}

/** The first run of the test split, kept so later runs can't quietly replace it. */
function historySection(stats: CheckStats[]): string {
  const file = join("eval", "first-run.json");
  if (!existsSync(file)) return "";
  const first = JSON.parse(readFileSync(file, "utf8")) as { version: string; stats: CheckStats[] };
  const fig = (s: CheckStats): string => `${s.tp}/${s.positives} caught, ${s.fp} false alarms`;
  const changed = first.stats.filter((f) => {
    const now = stats.find((s) => s.check === f.check);
    return now && (now.tp !== f.tp || now.fp !== f.fp || now.positives !== f.positives);
  });
  const rows = first.stats.map((s) => `| \`${s.check}\` | ${pct(s.precision)} (${ci(s.precisionCI)}) | ${pct(s.recall)} (${ci(s.recallCI)}) |`);
  return `## Test-split history

The test split was first run once, after tuning on the dev split, with ${TOOL_NAME} ${first.version}. Those figures are kept here (\`eval/first-run.json\`) and are the best guide to how the checks do on cases they weren't fixed against.

| Check | Precision (95% CI) | Recall (95% CI) |
|---|---|---|
${rows.join("\n")}

Changes since the first run:

- \`DENY\`: the first run missed \`t-a-deny-08\`. Rereading the Claude Code permissions docs (not the test cases) showed two bugs in how \`Read(...)\` deny rules were matched: a pattern starting with \`./\`, \`/\` or \`~/\` was treated as matching at any depth, and \`!\` carve-outs were read from the wrong folder and could cancel rules they can't. Both were fixed and new dev cases were added for them. The fix also catches \`t-a-deny-08\`, so that case is no longer unseen, and the \`DENY\` row in the main table counts it. Read \`DENY\` recall on unseen cases as the first-run figure.
- \`SKILL\`: the first run missed \`t-b-skill-02\` (Python that fetches code and runs it with \`exec\` a few lines later) and \`t-b-skill-06\` (a batch file that saves an \`.exe\` to \`%TEMP%\\\` and starts it). On 19 Oct, Windows dev cases were added for PowerShell, batch and Python scripts, and the fixes for them (following a fetched value into \`exec\` or \`Invoke-Expression\`, running a saved file by any path or through \`start\`/\`call\`, and \`^\` line continuations) also catch both cases. They are no longer unseen, and the \`SKILL\` row in the main table counts them. Read \`SKILL\` recall on unseen cases as the first-run figure.
- \`ENDPOINT\`: on 19 Oct a base URL pointing at this machine in a \`settings.local.json\` that git ignores became an info note instead of a medium alert (see "Changes after freezing" in [LABELLING.md](../eval/LABELLING.md)). No test case has that setup, and the figures didn't change.
${changed.length ? changed.map((f) => `- \`${f.check}\` first run: ${fig(f)}. Now: ${fig(stats.find((s) => s.check === f.check)!)}.`).join("\n") : "- No other check's figures have changed since the first run."}
`;
}

const statRow = (s: CheckStats): string =>
  `| \`${s.check}\` | ${s.positives} | ${s.tp} | ${s.fn} | ${s.fp} | ${pct(s.precision)} (${ci(s.precisionCI)}) | ${pct(s.recall)} (${ci(s.recallCI)}) |`;
const STAT_HEAD = "| Check | Risky cases | Caught | Missed | False alarms | Precision (95% CI) | Recall (95% CI) |\n|---|---|---|---|---|---|---|";

/** The second frozen batch: Windows configs and scripts, reported apart from the main split. */
function windowsSection(win: WinRun | undefined): string {
  if (!win) return "";
  const firstFile = WIN_FIRST_RUN;
  const first = existsSync(firstFile) ? (JSON.parse(readFileSync(firstFile, "utf8")) as { version: string; date: string; stats: CheckStats[] }) : undefined;
  const used = (s: CheckStats): boolean => s.positives > 0 || s.fp > 0;
  const firstRows = first ? first.stats.filter(used).map(statRow) : [];
  const nowRows = win.stats.filter(used).map(statRow);
  const benign = win.cases.filter((c) => c.risky.length === 0).length;
  const misses = (first?.stats ?? []).flatMap((s) => s.missed.map((id) => `\`${s.check}\` missed \`${id}\``));
  return `## Windows batch (synthetic, frozen)

A second blind batch of ${win.cases.length} cases (${benign} benign) for Windows: PowerShell hooks, backslash and \`%USERPROFILE%\` paths, \`.bat\`, \`.cmd\` and \`.ps1\` scripts, and Python \`exec\`. A separate helper agent wrote and labelled them from [LABELLING.md](../eval/LABELLING.md) only, without seeing the code or the other cases. Frozen set hash \`${win.lockSet.slice(0, 16)}\` (\`eval/test-win.lock\`). The checks were not tuned on it before its first run. It is too small for the intervals to say much; read it as a smoke test of Windows support.

${first ? `First run (${TOOL_NAME} ${first.version}, ${first.date}, kept in \`eval/first-run-win.json\`):

${STAT_HEAD}
${firstRows.join("\n")}

${misses.length ? `In the first run, ${misses.join(", ")}. ` : ""}` : ""}${misses.some((m) => m.includes("w-skill-cmd-fetch-03")) ? "That case splits a `curl` download over two lines with cmd's `^` continuation. Support for `^` was added after the first run, with a new dev case, so the case is no longer unseen.\n\n" : ""}Now:

${STAT_HEAD}
${nowRows.join("\n")}

Checks with no risky cases and no alerts in this batch are left out.
`;
}

interface RealWorld {
  date: string;
  /** How the alerts were labelled. Older files leave it out and get the original wording. */
  sample: { repos: number; files: Record<string, number>; method: string; reposWithAlerts: number; labelling?: string };
  checks: Array<{ check: string; alerts: number; tp: number; fp: number; lowValue: number }>;
  notes: string[];
}

/** The newest real-world precision summary in eval/realworld, if any. */
function realWorldSection(): string {
  const dir = join("eval", "realworld");
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort() : [];
  const head = "## Real-world precision (sampled public configs, dated)\n\n";
  if (!files.length) return `${head}Not run yet.\n`;
  const r = JSON.parse(readFileSync(join(dir, files.at(-1)!), "utf8")) as RealWorld;
  const kinds = Object.entries(r.sample.files).map(([k, n]) => `${n} \`${k}\``).join(", ");
  const rows = r.checks.map((c) => {
    const p = c.alerts ? c.tp / c.alerts : undefined;
    return `| \`${c.check}\` | ${c.alerts} | ${c.tp} | ${c.fp} | ${c.lowValue} | ${c.alerts ? `${pct(p)} (${ci(wilson(c.tp, c.alerts))})` : "no alerts"} |`;
  });
  return `${head}Run on ${r.date} with ${TOOL_NAME} in project-only mode, on ${r.sample.repos} public repositories (${kinds}). ${r.sample.method} Only those config files were read. ${r.sample.reposWithAlerts} of the ${r.sample.repos} repositories had at least one alert. ${r.sample.labelling ?? "Every high or medium alert was labelled against [LABELLING.md](../eval/LABELLING.md) by a model; secret alerts were labelled from the masked output only."} Only these totals are published: no repository, owner or file is named, and no third-party file is kept (\`eval/realworld/${files.at(-1)}\`).

This measures precision only (how many alerts were right). It can't measure recall, because nobody knows how many risky settings the sample holds. "Low value" counts alerts that are right by the rule's wording but look harmless in context; they are included in "Correct".

| Check | Alerts | Correct | Wrong | Low value | Precision (95% CI) |
|---|---|---|---|---|---|
${rows.join("\n")}

${r.notes.map((n) => `- ${n}`).join("\n")}
`;
}

function accuracyPage(cases: Case[], stats: CheckStats[], lockSet: string, win?: WinRun): string {
  const benign = cases.filter((c) => c.risky.length === 0).length;
  const rows = stats.map(
    (s) => `| \`${s.check}\` | ${s.positives} | ${s.tp} | ${s.fn} | ${s.fp} | ${pct(s.precision)} (${ci(s.precisionCI)}) | ${pct(s.recall)} (${ci(s.recallCI)}) |`,
  );
  const misses = stats.flatMap((s) => s.missed.map((id) => `- \`${s.check}\` missed \`${id}\`: ${cases.find((c) => c.id === id)?.rationale ?? ""}`));
  const fas = stats.flatMap((s) => s.falseAlarms.map((fa) => `- \`${s.check}\` (${fa.rules.join(", ")}) fired on \`${fa.id}\`, labelled not risky for ${s.check}: ${cases.find((c) => c.id === fa.id)?.rationale ?? ""}`));
  return `# Accuracy

Generated by \`npm run eval\` from the frozen test splits and the newest file in \`eval/realworld\`. Don't edit by hand.

- Tool: ${TOOL_NAME} ${TOOL_VERSION}
- Test split: ${cases.length} cases (${benign} benign), frozen set hash \`${lockSet.slice(0, 16)}\` (\`eval/test.lock\`)
- Labels follow [eval/LABELLING.md](../eval/LABELLING.md). ${labelProvenance()} Cases were written and labelled blind by separate model agents that never saw the source code.

Two kinds of figure are reported, and they answer different questions:

- **Spec conformance (synthetic, frozen)**: does each check flag what the labelling rule says it should, on hand-written cases it wasn't tuned on? This gives precision and recall.
- **Real-world precision (sampled public configs, dated)**: when a check fires on configs people actually commit, how often is the alert right? This gives precision only.

## Spec conformance (synthetic, frozen)

A check "alerts" on a case when it raises a high or medium finding. Info notes don't count. Precision = of the cases a check alerted on, how many were labelled risky for it. Recall = of the cases labelled risky for a check, how many it alerted on. Ranges are Wilson 95% intervals.

| Check | Risky cases | Caught | Missed | False alarms | Precision (95% CI) | Recall (95% CI) |
|---|---|---|---|---|---|---|
${rows.join("\n")}

${historySection(stats)}
${windowsSection(win)}
${realWorldSection()}
## Label agreement

${kappaSection(cases)}
## Limits

- The cases are synthetic. They were written to follow the labelling rule and to include near misses, but real configs are messier, and the figures will be different on them.
- The checks were tuned on a separate dev split (\`eval/cases/dev\`), written by the same agent that wrote the checks. Its scores aren't reported here, because the checks were fitted to it. The test split was first run once, after tuning; see the history above for what changed after that.
- About 10 risky cases per check is small. The intervals are wide, and a single case moves a figure by several points.
- The labels say whether a setting matches the labelling rule. They don't say whether it's dangerous on a given machine.
- Each case writer labelled mainly the five checks it was given, so a case can be risky for another check without being labelled that way. Those show up below as false alarms or misses and are counted as they stand, without relabelling.
- The checks read config files only. They don't run anything, follow a hook into the script it calls (except scripts in skill, plugin and hooks folders), contact MCP servers, or see settings applied by an administrator outside the files listed in [config-surface.md](config-surface.md).
- Cursor checks cover MCP config and rules files only, because Cursor keeps its run mode in the app, not in a file.
- This is a configuration check, not a security assessment. A clean result doesn't mean a setup is safe.

## Known misses

${misses.length ? misses.join("\n") : "None in the test split. Misses in real projects can't be counted; see the real-world section above."}

## False alarms

${fas.length ? fas.join("\n") : "None in the test split. The real-world sample had two; see the real-world section above."}
`;
}

/** Frozen splits and their lock files. They must not change after freezing. */
const FROZEN: Record<string, string> = { test: "eval/test.lock", "test-win": "eval/test-win.lock" };
const WIN_FIRST_RUN = join("eval", "first-run-win.json");

interface WinRun {
  cases: Case[];
  stats: CheckStats[];
  lockSet: string;
}

/** Hash a frozen split the way eval/tools/lock.mjs does and stop if it doesn't match its lock. */
function verifyLock(split: string): string {
  const lockFile = FROZEN[split]!;
  const lock = JSON.parse(readFileSync(lockFile, "utf8")) as { set: string };
  const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
  const dir = join("eval", "cases", split);
  const files: Record<string, string> = {};
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) files[n] = sha(assemble(readFileSync(join(dir, n), "utf8")).replace(/\r\n/g, "\n"));
  const set = sha(Object.entries(files).map(([n, h]) => `${n} ${h}`).join("\n"));
  if (set !== lock.set) {
    console.error(`eval/cases/${split} doesn't match ${lockFile}. It must not change after freezing.`);
    process.exit(2);
  }
  return set;
}

/** Keep the first run of a frozen batch. Later runs never overwrite it. */
function recordFirstRun(file: string, split: string, lockSet: string, stats: CheckStats[]): void {
  if (existsSync(file)) return;
  writeFileSync(file, JSON.stringify({ tool: TOOL_NAME, version: TOOL_VERSION, split, lockSet, date: new Date().toISOString().slice(0, 10), stats }, null, 2) + "\n");
  console.log(`recorded the first run of ${split} in ${file}`);
}

function printStats(split: string, n: number, stats: CheckStats[]): void {
  console.log(`${split}: ${n} cases`);
  for (const s of stats) {
    if (split === "test-win" && !s.positives && !s.fp) continue;
    console.log(`${s.check.padEnd(9)} pos ${String(s.positives).padStart(3)}  tp ${String(s.tp).padStart(3)}  fn ${String(s.fn).padStart(3)}  fp ${String(s.fp).padStart(3)}  P ${pct(s.precision).padStart(4)}  R ${pct(s.recall).padStart(4)}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const split = argv.includes("--split") ? (argv[argv.indexOf("--split") + 1] ?? "test") : "test";
  const write = !argv.includes("--no-write");
  const cases = loadCases(split);
  if (!cases.length) {
    console.error(`no cases in eval/cases/${split}`);
    process.exit(2);
  }
  const lockSet = FROZEN[split] ? verifyLock(split) : "";
  const { stats, perCase } = evaluate(cases);
  printStats(split, cases.length, stats);
  if (split === "dev" || split === "test-win") {
    for (const s of stats) {
      for (const id of s.missed) console.log(`  MISS ${s.check} ${id}`);
      for (const fa of s.falseAlarms) console.log(`  FA   ${s.check} ${fa.id} ${fa.rules.join(",")}`);
    }
  }
  if (write) {
    mkdirSync(join("eval", "out"), { recursive: true });
    writeFileSync(join("eval", "out", `${split}-results.json`), JSON.stringify({ tool: TOOL_NAME, version: TOOL_VERSION, split, stats, perCase }, null, 2) + "\n");
    if (split === "test-win") recordFirstRun(WIN_FIRST_RUN, split, lockSet, stats);
    if (split === "test") {
      writeFileSync(join("eval", "results.json"), JSON.stringify({ tool: TOOL_NAME, version: TOOL_VERSION, split, lockSet, stats }, null, 2) + "\n");
      // The Windows batch is reported alongside, in its own section.
      let win: WinRun | undefined;
      const winCases = loadCases("test-win");
      if (winCases.length) {
        const winSet = verifyLock("test-win");
        const winStats = evaluate(winCases).stats;
        printStats("test-win", winCases.length, winStats);
        recordFirstRun(WIN_FIRST_RUN, "test-win", winSet, winStats);
        win = { cases: winCases, stats: winStats, lockSet: winSet };
      }
      writeFileSync(join("docs", "ACCURACY.md"), accuracyPage(cases, stats, lockSet, win));
    }
  }
  if (argv.includes("--check-thresholds")) {
    const t = JSON.parse(readFileSync(join("eval", "thresholds.json"), "utf8")) as Record<string, { precision?: number; recall?: number } | string>;
    const fails: string[] = [];
    for (const s of stats) {
      const want = t[s.check];
      if (typeof want === "string") continue;
      if (!want) continue;
      if (want.precision !== undefined && s.precision !== undefined && s.precision < want.precision) fails.push(`${s.check} precision ${pct(s.precision)} < ${pct(want.precision)}`);
      if (want.recall !== undefined && s.recall !== undefined && s.recall < want.recall) fails.push(`${s.check} recall ${pct(s.recall)} < ${pct(want.recall)}`);
    }
    if (fails.length) {
      console.error(`Below threshold:\n  ${fails.join("\n  ")}`);
      process.exit(1);
    }
    console.log("All checks meet eval/thresholds.json.");
  }
}

if (/run\.ts$/.test((process.argv[1] ?? "").replaceAll("\\", "/"))) main();
