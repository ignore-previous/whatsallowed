import type { Doc, PathSeg } from "../parse.ts";
import type { CheckId, ConfigFile, Finding, Scope, Severity } from "../types.ts";

export interface FindingInput {
  rule: string;
  severity: Severity;
  title: string;
  file: ConfigFile;
  line: number;
  match: string;
  why: string;
  fix: string;
}

export const make = (check: CheckId, f: FindingInput): Finding => ({
  rule: f.rule,
  check,
  severity: f.severity,
  title: f.title,
  file: f.file.display,
  line: f.line,
  match: f.match,
  why: f.why,
  fix: f.fix,
});

/** Show enough of a secret to find it, never enough to use it. */
export function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return `${"•".repeat(Math.min(v.length, 4))} (${v.length} chars)`;
  const keep = Math.min(6, Math.floor(v.length / 5));
  return `${v.slice(0, keep)}… (${v.length} chars)`;
}

export const lineOf =(doc: Doc, path: PathSeg[]): number => doc.lineOf(path);

/** Files that arrive with a cloned repository, or with a plugin someone else wrote. */
export const isShared = (s: Scope): boolean => s === "project" || s === "plugin";

export const scopeWord = (s: Scope): string =>
  ({
    managed: "managed settings file",
    user: "user settings file",
    project: "repository file",
    local: "local project file",
    plugin: "installed plugin",
  })[s];
