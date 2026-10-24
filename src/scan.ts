import { checkAllow } from "./checks/allow.ts";
import { checkDeny } from "./checks/deny.ts";
import { checkDrift } from "./checks/drift.ts";
import { checkEndpoint } from "./checks/endpoint.ts";
import { checkHooks } from "./checks/hooks.ts";
import { checkMcp } from "./checks/mcp.ts";
import { checkMode } from "./checks/mode.ts";
import { checkSecrets } from "./checks/secrets.ts";
import { checkSkills } from "./checks/skills.ts";
import { discover, type ScanMode } from "./discover.ts";
import type { Fs } from "./fsys.ts";
import { buildModel, type Model } from "./model.ts";
import type { Baseline, ConfigFile, Finding, Severity } from "./types.ts";

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
  findings: Finding[];
  notes: string[];
  model: Model;
}

const CHECKS = [checkMode, checkAllow, checkDeny, checkEndpoint, checkHooks, checkMcp, checkDrift, checkSecrets, checkSkills];

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, info: 1 };

export function scan(opts: ScanOptions): ScanResult {
  const { files, projectEntries } = discover(opts);
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
  findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  return { mode: opts.mode, files, findings, notes: [...new Set(notes)], model };
}
