import { ruleById, RULES } from "./rules.ts";
import { SEVERITY_RANK, type ScanResult } from "./scan.ts";
import { type CheckSummary, type Summary, summarize } from "./summary.ts";
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
  MODE: "Permission mode: how often your AI stops to ask before it acts.",
  ALLOW: "Allow rule: a setting that lets your AI do something without asking you first.",
  DENY: "Deny rule: a setting that stops your AI reading a file or running a command.",
  ENDPOINT: "API address: where your AI sends its requests, and the credentials that go with them.",
  HOOK: "Hook: a command that Claude Code or Codex runs by itself when something happens, such as after a file edit.",
  HTTPHOOK: "HTTP hook: a hook that sends details of what your AI is doing to a web address.",
  MCP: "MCP server: a helper program your AI can call to use other tools or services.",
  DRIFT: "Baseline: a saved copy of your MCP server settings, used to spot later changes.",
  SECRET: "Secret: a password, key or token. Anyone who has it can act as you.",
  SKILL: "Skill or plugin: an add-on that gives your AI extra abilities, often with its own scripts.",
  FILE: "Unchecked file: a config file we skipped, so nothing in it was looked at.",
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const SCOPE_TEXT: Record<ScanMode, string> = {
  all: "this project folder and your user settings. Other projects on this machine aren't read.",
  project: "this project folder only (--project-only).",
  user: "your user settings only (--user-only).",
};

interface TextOptions {
  color: boolean;
  verbose?: boolean;
  details?: boolean;
  scopeText?: string;
  intro?: string;
  width?: number;
}

const AREA_NAMES: Record<CheckId, string> = {
  MODE: "Permission modes", ALLOW: "Allowed actions", DENY: "Protected files",
  ENDPOINT: "Request addresses", HOOK: "Automatic commands", HTTPHOOK: "Web notifications",
  MCP: "Extra tools", DRIFT: "Changes since baseline", SECRET: "Keys and tokens",
  SKILL: "Add-on scripts", FILE: "Unchecked files",
};

/** Plain words for the fixed part of a title. Quoted names come from the user's config and are never changed. */
function plainWords(text: string): string {
  return text
    .replace(/\bAn allow rule approves\b/g, "A permission allows")
    .replace(/\bshell command\b/g, "command")
    .replace(/\bThe repository (?:pre-)?approves its own MCP servers\b/g, "The project approves its own extra tools")
    .replace(/\bThe repository\b/g, "The project")
    .replace(/\bAn HTTP hook\b/g, "A web notification")
    .replace(/\bA hook\b/g, "An automatic command")
    .replace(/^MCP servers\b/g, "Extra tools")
    .replace(/^MCP server\b/g, "Extra tool")
    .replace(/\bMCP servers\b/g, "extra tools")
    .replace(/\bMCP server\b/g, "extra tool")
    .replace(/\ban unpinned package\b/g, "a package without a fixed version")
    .replace(/\bthe baseline\b/g, "the saved settings")
    .replace(/\bThe agent's\b/g, "The AI's")
    .replace(/\bthe agent\b/g, "the AI")
    .replace(/\bThe agent\b/g, "The AI");
}

function shortTitle(f: Finding): string {
  if (f.rule === "SECRET-002") return "A key or token is written directly in the tool settings";
  // Split on quoted names so only our own wording is rewritten.
  return f.title.split(/("[^"]*")/).map((part, i) => (i % 2 ? part : plainWords(part))).join("");
}

/** The first sentence of the suggested fix, for the short report. */
function firstStep(fix: string): string {
  const m = fix.match(/^.*?[.!?](?=\s+[A-Z]|$)/);
  return (m ? m[0] : fix).trim();
}

function shortSummary(x: CheckSummary): string {
  if (!x.checked || x.fix) return x.text;
  switch (x.check) {
    case "MODE": return `${plural(x.count, "setting", "settings")}.`;
    case "ALLOW": return `${plural(x.count, "permission rule", "permission rules")}.`;
    case "DENY": return `${plural(x.count, "rule blocking access", "rules blocking access")}.`;
    case "HOOK": return `${plural(x.count, "automatic command", "automatic commands")}.`;
    case "HTTPHOOK": return `${plural(x.count, "web notification", "web notifications")}.`;
    case "MCP": return `${plural(x.count, "extra tool", "extra tools")}.`;
    case "SECRET": return `${plural(x.count, "file or value checked", "files or values checked")}.`;
    case "SKILL": return `${plural(x.count, "script", "scripts")}.`;
    default: return x.text;
  }
}

/** Wrap before colouring so escape codes do not count towards the terminal width. */
function wrap(line: string, width: number): string[] {
  if (!line) return [""];
  const prefix = line.match(/^(\s*[^:]+: )/)?.[0] ?? line.match(/^\s*/)?.[0] ?? "";
  // Very narrow terminals must still leave room for text after the indentation.
  const indent = " ".repeat(Math.min(prefix.length, Math.max(0, width - 20)));
  const result: string[] = [];
  let rest = line;
  while (Array.from(rest).length > width) {
    const chars = Array.from(rest);
    const candidate = chars.slice(0, width + 1).join("");
    const space = candidate.lastIndexOf(" ");
    const cut = space > indent.length ? space : width;
    result.push(chars.slice(0, cut).join(""));
    rest = indent + chars.slice(cut).join("").trimStart();
  }
  result.push(rest);
  return result;
}

function textWidth(opts: TextOptions): number {
  const width = opts.width ?? (process.stdout.isTTY ? process.stdout.columns : 80);
  return Number.isFinite(width) && width > 0 ? Math.min(90, Math.floor(width)) : 80;
}

function writer(opts: TextOptions): (line: string, color?: keyof typeof ANSI) => string[] {
  const width = textWidth(opts);
  return (line, color) => wrap(line, width).map((part) =>
    opts.color && color && part ? `${ANSI[color]}${part}${ANSI.reset}` : part);
}

/** Keep empty areas together and name the remaining areas without check codes. */
export function formatSummary(s: Summary, opts: TextOptions): string[] {
  const write = writer(opts);
  const lines = [...write(`Summary: ${opts.scopeText ?? SCOPE_TEXT[s.scope]}`, "bold")];
  if (opts.details) {
    const f = s.files;
    const tools = [["Claude Code", f.claude], ["Codex", f.codex], ["Cursor", f.cursor]] as const;
    const found = tools.filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`);
    if (f.other) found.push(`other ${f.other}`);
    const missing = tools.filter(([, n]) => !n).map(([t]) => t);
    lines.push(...write(`  Files: ${f.total} read.${found.length ? ` ${found.join(", ")}.` : ""}`));
    if (missing.length) lines.push(...write(`  ${missing.join(", ")}: no files found.`));
  }
  const skipped = s.files.unchecked;
  if (skipped) lines.push(...write(`  ${plural(skipped, "config file was", "config files were")} too large to check, so ${skipped === 1 ? "it was" : "they were"} skipped.`));
  const empty: string[] = [];
  for (const x of s.checks) {
    const hasFindings = Object.values(x.findings).some((n) => n > 0);
    if ((!x.count || x.check === "ENDPOINT") && !hasFindings && !x.fix && x.checked) {
      empty.push(AREA_NAMES[x.check].toLowerCase());
      continue;
    }
    const description = opts.details || opts.verbose ? x.text : shortSummary(x);
    lines.push(...write(`  ${AREA_NAMES[x.check]}: ${description}${x.fix ? ` Run: ${x.fix}` : ""}`));
    if (opts.details) lines.push(...write(`    ${x.meaning}`, "dim"));
    if (opts.verbose) for (const item of x.items) lines.push(...write(`    - ${item}`, "dim"));
  }
  if (empty.length) lines.push(...write(`Nothing found${skipped ? " in the files read" : ""} for: ${empty.join(", ")}.`, "dim"));
  return [...lines, ""];
}

export function formatText(r: ScanResult, opts: TextOptions): string {
  const write = writer(opts);
  const lines: string[] = [];
  const high = r.findings.filter((f) => f.severity === "high");
  const medium = r.findings.filter((f) => f.severity === "medium");
  const infos = r.findings.filter((f) => f.severity === "info");
  lines.push(...write(`${high.length} high, ${medium.length} medium, ${infos.length} info; ${plural(r.files.length, "file", "files")} checked.`, "bold"));
  lines.push(...write(opts.intro ?? "Read-only check. Nothing is changed or sent anywhere.", "dim"), "");
  if (!r.files.length && !r.unchecked.length) {
    lines.push(...write("Nothing was checked: no AI settings files were found here."));
    lines.push(...write("Run it from a project folder, or see --help."), "");
  }
  const seenTerms = new Set<CheckId>();
  const show = (f: Finding): void => {
    lines.push(...write(`  ${opts.details ? f.title : shortTitle(f)}`, "bold"));
    lines.push(...write(`    ${opts.details ? "Where: " : ""}${f.line > 0 ? `${f.file}:${f.line}` : f.file}`, "cyan"));
    if (!opts.details) lines.push(...write(`    What to do: ${firstStep(f.fix)}`));
    if (opts.details) {
      lines.push(...write(`    What this means: ${f.why}`));
      lines.push(...write(`    What you could do: ${f.fix}`));
      lines.push(...write(`    Found: ${f.match}`, "dim"));
      lines.push(...write(`    Rule: ${f.rule}`, "dim"));
      if (TERMS[f.check] && !seenTerms.has(f.check)) {
        seenTerms.add(f.check);
        lines.push(...write(`    ${TERMS[f.check]}`, "dim"));
      }
    }
    lines.push("");
  };
  const group = (title: string, list: Finding[], color: keyof typeof ANSI): void => {
    if (!list.length) return;
    lines.push(...write(`${title} (${list.length})`, color), "");
    list.forEach(show);
  };
  group("Look at these first", high, "red");
  group("Worth checking", medium, "yellow");
  if (!opts.details && (high.length || medium.length)) lines.push(...write("Add --details to see why each one matters and more ways to fix it.", "dim"), "");
  if (infos.length) {
    if (opts.verbose) group("For your information", infos, "dim");
    else lines.push(...write(`${plural(infos.length, "lower-priority note is", "lower-priority notes are")} hidden. Add --verbose to see ${infos.length === 1 ? "it" : "them"}.`, "dim"), "");
  }
  for (const n of r.notes) lines.push(...write(`Note: ${n}`, "dim"));
  if (r.notes.length) lines.push("");
  if (r.files.length || r.unchecked.length) lines.push(...formatSummary(summarize(r), opts));
  lines.push(...write("This is not a security assessment. A clean result does not mean it is safe.", "dim"));
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
