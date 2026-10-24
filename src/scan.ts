import { checkAllow } from "./checks/allow.ts";
import { checkDeny } from "./checks/deny.ts";
import { checkDrift } from "./checks/drift.ts";
import { checkEndpoint } from "./checks/endpoint.ts";
import { checkHooks } from "./checks/hooks.ts";
import { checkMcp } from "./checks/mcp.ts";
import { checkMode } from "./checks/mode.ts";
import { checkSecrets } from "./checks/secrets.ts";
import { checkSkills } from "./checks/skills.ts";
import { make } from "./checks/util.ts";
import { discover, type ScanMode } from "./discover.ts";
import { type Fs, MAX_BYTES } from "./fsys.ts";
import { buildModel, type Model } from "./model.ts";
import type { Baseline, ConfigFile, Finding, Severity, UncheckedFile } from "./types.ts";

export interface ScanOptions {
  fs: Fs;
  home: string;
  project: string;
  mode: ScanMode;
  managedDirs?: string[];
  baseline?: Baseline;
}

export interface ScanResult {
  /** Which config was scanned: the project and user config ("all"), or one of them. */
  mode: ScanMode;
  files: ConfigFile[];
  /** Config files found but not read because they are over the size limit. Each also has a FILE-001 finding. */
  unchecked: UncheckedFile[];
  findings: Finding[];
  notes: string[];
  model: Model;
}

const CHECKS = [checkMode, checkAllow, checkDeny, checkEndpoint, checkHooks, checkMcp, checkDrift, checkSecrets, checkSkills];

const mib = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MiB`;

/** A file we didn't read must not look like a file with nothing wrong in it. */
function uncheckedFinding(u: UncheckedFile): Finding {
  const shared = u.scope === "project" || u.scope === "local" || u.scope === "plugin";
  return make("FILE", {
    rule: "FILE-001",
    severity: shared ? "high" : "medium",
    title: `${u.display} is too large to check`,
    file: u,
    line: 1,
    match: `${mib(u.bytes)}, limit ${mib(MAX_BYTES)}`,
    why:
      u.kind === "claude-json"
        ? "We skip config files over 1 MiB, so nothing in this one was checked, including its MCP servers. Claude Code grows this file as you use it, so it may be harmless."
        : "We skip config files over 1 MiB, so nothing in this one was checked. Real settings files are a few kilobytes. A padded file can hide risky settings from a check like this.",
    fix: "Open the file and find out why it is so big. Remove the padding or split the file, then run the check again.",
  });
}

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, info: 1 };

export function scan(opts: ScanOptions): ScanResult {
  const { files, projectEntries, unchecked } = discover(opts);
  const notes: string[] = [];
  const model = buildModel({ home: opts.home, project: opts.project, files, projectEntries, baseline: opts.baseline, notes });
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const check of CHECKS) {
    for (const f of check(model)) {
      const key = `${f.rule}|${f.file}|${f.line}|${f.match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  findings.push(...unchecked.map(uncheckedFinding));
  findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  return { mode: opts.mode, files, unchecked, findings, notes: [...new Set(notes)], model };
}
