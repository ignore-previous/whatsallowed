import { ruleById, RULES } from "./rules.ts";
import { SEVERITY_RANK, type ScanResult } from "./scan.ts";
import { type Summary, summarize } from "./summary.ts";
import type { ScanMode } from "./discover.ts";
import { TOOL_NAME, TOOL_VERSION } from "./name.ts";
import type { CheckId, Finding, Severity } from "./types.ts";

export type FailOn = Severity | "never";

export function exitCodeFor(findings: Finding[], failOn: FailOn): 0 | 1 {
  if (failOn === "never") return 0;
  const min = SEVERITY_RANK[failOn];
  return findings.some((f) => SEVERITY_RANK[f.severity] >= min) ? 1 : 0;
}

const ANSI = { red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m", cyan: "\x1b[36m" };

/** One plain sentence per kind of setting, shown the first time a finding of that kind appears. */
const TERMS: Partial<Record<CheckId, string>> = {
  MODE: "Permission mode: how often your agent stops to ask before it acts.",
  ALLOW: "Allow rule: a setting that lets your agent do something without asking you first.",
  DENY: "Deny rule: a setting that stops your agent reading a file or running a command.",
  ENDPOINT: "API address: where your agent sends its requests, and the credentials that go with them.",
  HOOK: "Hook: a command that Claude Code or Codex runs by itself when something happens, such as after a file edit.",
  HTTPHOOK: "HTTP hook: a hook that sends details of what your agent is doing to a web address.",
  MCP: "MCP server: a helper program your agent can call to use other tools or services.",
  DRIFT: "Baseline: a saved copy of your MCP server settings, used to spot later changes.",
  SECRET: "Secret: a password, key or token. Anyone who has it can act as you.",
  SKILL: "Skill or plugin: an add-on that gives your agent extra abilities, often with its own scripts.",
  FILE: "Unchecked file: a config file we skipped, so nothing in it was looked at.",
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const SCOPE_TEXT: Record<ScanMode, string> = {
  all: "this project folder and your user settings. Other projects on this machine aren't read.",
  project: "this project folder only (--project-only).",
  user: "your user settings only (--user-only).",
};

/** The per-check summary block, printed after the findings on every scan that found files. */
export function formatSummary(s: Summary, opts: { color: boolean; verbose?: boolean; scopeText?: string }): string[] {
  const c = (code: keyof typeof ANSI, x: string): string => (opts.color ? `${ANSI[code]}${x}${ANSI.reset}` : x);
  const pad = (label: string): string => `  ${label.padEnd(10)}`;
  const indent = " ".repeat(12);
  const lines: string[] = [c("bold", `Summary: ${opts.scopeText ?? SCOPE_TEXT[s.scope]}`), ""];
  const f = s.files;
  const tools = [
    ["Claude Code", f.claude],
    ["Codex", f.codex],
    ["Cursor", f.cursor],
  ] as const;
  const found = tools.filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`);
  if (f.other) found.push(`other ${f.other}`);
  const missing = tools.filter(([, n]) => n === 0).map(([t]) => t);
  lines.push(
    `${pad("Files")}${f.total} read: ${found.join(", ")}.${missing.length ? ` ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} or ${missing.at(-1)}` : missing[0]}: no files found.` : ""}`,
    c("dim", `${indent}Settings, instruction files, skill scripts, and secrets files such as .env.`),
  );
  if (f.unchecked) lines.push(`${pad("")}${plural(f.unchecked, "config file was", "config files were")} too large to check, so ${f.unchecked === 1 ? "it was" : "they were"} skipped.`);
  for (const x of s.checks) {
    lines.push(`${pad(x.check)}${x.text}${x.fix ? ` Run: ${x.fix}` : ""}`, c("dim", `${indent}${x.meaning}`));
    if (opts.verbose) for (const item of x.items) lines.push(c("dim", `${indent}- ${item}`));
  }
  if (!opts.verbose && s.checks.some((x) => x.items.length)) lines.push("", c("dim", "Add --verbose to list every rule, server, hook and file counted."));
  lines.push("");
  return lines;
}

export function formatText(r: ScanResult, opts: { color: boolean; verbose?: boolean; scopeText?: string }): string {
  const c = (code: keyof typeof ANSI, s: string): string => (opts.color ? `${ANSI[code]}${s}${ANSI.reset}` : s);
  const lines: string[] = [];
  const high = r.findings.filter((f) => f.severity === "high");
  const medium = r.findings.filter((f) => f.severity === "medium");
  const infos = r.findings.filter((f) => f.severity === "info");
  const alerts = high.length + medium.length;
  const checked = plural(r.files.length, "file", "files");

  lines.push(`${c("bold", TOOL_NAME)} ${TOOL_VERSION}. This is a read-only check: it changes nothing and sends nothing anywhere.`, "");

  // One-line verdict first.
  if (!r.files.length && !r.unchecked.length) {
    lines.push(c("bold", "Nothing was checked: no agent settings files were found here."));
    lines.push("Run it from a project folder, or see --help.");
  } else if (!r.files.length) {
    lines.push(c(high.length ? "red" : "yellow", `${plural(alerts, "thing", "things")} to look at. No config file could be checked: ${r.unchecked.length === 1 ? "the one" : "those"} we found ${r.unchecked.length === 1 ? "is" : "are"} too large.`));
  } else if (!alerts) {
    lines.push(c("bold", `No high or medium findings in the ${checked} checked.`));
    lines.push("The summary at the end shows what was checked.");
  } else if (high.length) {
    lines.push(c("red", `${plural(alerts, "thing", "things")} to look at in the ${checked} checked. ${plural(high.length, "needs", "need")} attention first.`));
  } else {
    lines.push(c("yellow", `${plural(alerts, "thing", "things")} worth a look in the ${checked} checked. Nothing needs urgent attention.`));
  }
  lines.push("");

  const seenTerms = new Set<CheckId>();
  const show = (f: Finding): void => {
    lines.push(`  ${c("bold", f.title)}`);
    if (TERMS[f.check] && !seenTerms.has(f.check)) {
      seenTerms.add(f.check);
      lines.push(`    ${c("dim", `(${TERMS[f.check]})`)}`);
    }
    lines.push(`    What this means: ${f.why}`);
    lines.push(`    What you could do: ${f.fix}`);
    lines.push(`    ${c("dim", "Where:")} ${c("cyan", f.line > 0 ? `${f.file}, line ${f.line}` : f.file)}  ${c("dim", `Found: ${f.match}  Rule: ${f.rule}`)}`);
    lines.push("");
  };
  const group = (title: string, note: string, list: Finding[], color: keyof typeof ANSI): void => {
    if (!list.length) return;
    lines.push(c(color, `${title} (${list.length})`) + c("dim", `  ${note}`), "");
    list.forEach(show);
  };
  group("Look at these first", "High: could let something run or leak without you noticing.", high, "red");
  group("Worth checking", "Medium: risky in some set-ups, harmless in others.", medium, "yellow");
  if (infos.length) {
    if (opts.verbose) group("For your information", "Not a problem on its own.", infos, "dim");
    else lines.push(c("dim", `${plural(infos.length, "lower-priority note is", "lower-priority notes are")} hidden. Add --verbose to see ${infos.length === 1 ? "it" : "them"}.`), "");
  }

  for (const n of r.notes) lines.push(c("dim", `Note: ${n}`));
  if (r.notes.length) lines.push("");

  if (r.files.length || r.unchecked.length) lines.push(...formatSummary(summarize(r), opts));

  if (alerts) lines.push("Nothing has been changed. If you decide to act, you make the change yourself; the \"What you could do\" lines say how.");
  lines.push(c("dim", "This is a configuration check, not a security assessment. A clean result doesn't mean a setup is safe."));
  lines.push(c("dim", "Writing a script? Use --format json for the same findings in a stable, machine-readable form."));
  return lines.join("\n") + "\n";
}

export function formatJson(r: ScanResult): string {
  return (
    JSON.stringify(
      {
        tool: TOOL_NAME,
        version: TOOL_VERSION,
        files: r.files.map((f) => ({ path: f.display, tool: f.tool, kind: f.kind, scope: f.scope })),
        findings: r.findings,
        notes: r.notes,
        summary: summarize(r),
      },
      null,
      2,
    ) + "\n"
  );
}

const sarifLevel: Record<Severity, "error" | "warning" | "note"> = { high: "error", medium: "warning", info: "note" };

/** SARIF 2.1.0. Paths under the project are relative to it; others keep their ~/ form. */
export function formatSarif(r: ScanResult): string {
  const used = [...new Set(r.findings.map((f) => f.rule))];
  const rules = RULES.filter((x) => used.includes(x.id));
  const index = new Map(rules.map((x, i) => [x.id, i]));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: TOOL_VERSION,
            rules: rules.map((x) => ({
              id: x.id,
              name: x.id.replace("-", ""),
              shortDescription: { text: x.summary },
              defaultConfiguration: { level: sarifLevel[x.severity] },
              properties: { check: x.check },
            })),
          },
        },
        results: r.findings.map((f) => {
          const inProject = f.file.startsWith("./");
          return {
            ruleId: f.rule,
            ruleIndex: index.get(f.rule) ?? 0,
            level: sarifLevel[f.severity],
            message: { text: `${f.title}. ${f.why} Fix: ${f.fix}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: inProject
                    ? { uri: f.file.slice(2), uriBaseId: "SRCROOT" }
                    : f.file.startsWith("~/")
                      ? { uri: f.file.slice(2), uriBaseId: "HOMEDIR" }
                      : { uri: f.file },
                  region: { startLine: Math.max(1, f.line) },
                },
              },
            ],
            properties: { severity: f.severity, check: f.check, match: f.match },
          };
        }),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}

export function formatRules(): string {
  return RULES.map((r) => `${r.id.padEnd(13)} ${r.severity.padEnd(6)} ${r.summary}`).join("\n") + "\n";
}

export function formatInventory(r: ScanResult): string {
  if (!r.files.length && !r.unchecked.length) return "No agent config files found.\n";
  const rows = [
    ...r.files.map((f) => `${f.scope.padEnd(8)} ${f.tool.padEnd(7)} ${f.kind.padEnd(16)} ${f.display}`),
    ...r.unchecked.map((f) => `${f.scope.padEnd(8)} ${f.tool.padEnd(7)} ${f.kind.padEnd(16)} ${f.display} (too large, not checked)`),
  ];
  return `${"scope".padEnd(8)} ${"tool".padEnd(7)} ${"kind".padEnd(16)} path\n${rows.join("\n")}\n`;
}

export { ruleById };
