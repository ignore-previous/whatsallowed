import { toPosix } from "../fsys.ts";
import type { Model, Parsed } from "../model.ts";
import { get, strArr } from "../parse.ts";
import type { ConfigFile, Finding } from "../types.ts";
import { make } from "./util.ts";

/** Windows paths become /c/... before matching, as Claude Code does. */
export function posixForMatch(p: string): string {
  const t = toPosix(p);
  const m = /^([A-Za-z]):(\/.*)?$/.exec(t);
  return m ? `/${(m[1] ?? "").toLowerCase()}${m[2] ?? ""}` : t;
}

function globToRegex(pat: string): string {
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i] ?? "";
    if (c === "*") {
      if (pat[i + 1] === "*") {
        if (pat[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = pat.indexOf("]", i + 1);
      if (end > i) {
        out += pat.slice(i, end + 1).replace(/^\[!/, "[^");
        i = end;
      } else out += "\\[";
    } else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return out;
}

export interface ReadRule {
  pattern: string;
  /** Where "/path" anchors for this rule's settings file. */
  sourceBase: string;
}

/** Does one Read(...) deny pattern match an absolute file path? */
export function readRuleMatches(rule: ReadRule, fileAbs: string, home: string, project: string): boolean {
  let pat = rule.pattern.trim();
  if (pat === "" || pat === "**" || pat === "*" || pat === "//**" || pat === "./**") return true;
  let base: string;
  // Only a bare pattern ("x", "x/**") can match at any depth. A "./", "/", "~/" or "//" prefix anchors it.
  const bare = !/^(?:\.\/|\/|~\/|~$)/.test(pat);
  if (pat.startsWith("//")) {
    base = "/";
    pat = pat.slice(2);
  } else if (pat === "~" || pat.startsWith("~/")) {
    base = home;
    pat = pat.slice(2);
  } else if (pat.startsWith("/")) {
    base = rule.sourceBase;
    pat = pat.slice(1);
  } else {
    base = project;
    if (pat.startsWith("./")) pat = pat.slice(2);
  }
  const b = posixForMatch(base);
  const target = posixForMatch(fileAbs);
  const prefix = b === "/" ? "/" : `${b}/`;
  if (!target.startsWith(prefix)) return false;
  const rel = target.slice(prefix.length);
  const dirOnly = pat.endsWith("/");
  if (dirOnly) pat = pat.replace(/\/+$/, "");
  // gitignore: a bare pattern with no inner slash matches at any depth; deny rules treat bare "dir/**" the same way.
  const anyDepth = bare && (!pat.includes("/") || /^[^/*]+\/\*\*$/.test(pat));
  const body = globToRegex(pat);
  const tail = dirOnly ? "/.*" : "(?:/.*)?";
  const re = new RegExp(`^${anyDepth && !pat.startsWith("**") ? "(?:.*/)?" : ""}${body}${tail}$`);
  return re.test(rel);
}

export function readDenyRules(p: Parsed, home: string, project: string): ReadRule[] {
  const sourceBase = p.file.scope === "user" ? `${toPosix(home)}/.claude` : p.file.scope === "managed" ? p.file.path.slice(0, p.file.path.lastIndexOf("/")) : project;
  const out: ReadRule[] = [];
  for (const r of strArr(get(p.doc.value, "permissions", "deny"))) {
    const t = r.trim();
    if (t === "Read") out.push({ pattern: "**", sourceBase });
    const m = /^Read\((.*)\)$/s.exec(t);
    if (m) out.push({ pattern: m[1] ?? "", sourceBase });
  }
  return out;
}

/**
 * Is the file covered by the deny list of one settings file, honouring "!" carve-outs in order?
 * Per the permissions docs: a "!" pattern is read relative to the project folder, cancels only earlier
 * "path" or "./path" rules from the same file, and can't reopen a file inside a folder a rule blocks whole.
 */
function coveredByFile(rules: ReadRule[], fileAbs: string, home: string, project: string): boolean {
  const covering: ReadRule[] = [];
  for (const r of rules) {
    if (r.pattern.startsWith("!")) {
      const carve = r.pattern.slice(1);
      if (/^(?:\/|~)/.test(carve)) continue; // anchored after "!": can't match anything Claude Code would carve
      if (!readRuleMatches({ pattern: carve, sourceBase: project }, fileAbs, home, project)) continue;
      for (let i = covering.length - 1; i >= 0; i--) {
        const c = covering[i]!.pattern.trim();
        const cwdRelative = !/^(?:\/|~)/.test(c);
        const wholeDir = /\/\*\*$/.test(c);
        if (cwdRelative && !wholeDir) covering.splice(i, 1);
      }
    } else if (readRuleMatches(r, fileAbs, home, project)) covering.push(r);
  }
  return covering.length > 0;
}

const hasToken = (name: string, text: string | undefined): boolean => {
  if (!text) return false;
  if (/^\.npmrc$/i.test(name)) return /(?:_authToken|_auth|_password)\s*=\s*(?!\$\{)["']?[^\s"'$]{6,}/i.test(text);
  return /^\s*password\s*[=:]\s*(?!\$\{)\S{4,}/im.test(text);
};

/** The DENY check applies only to projects that use Claude Code. */
export function projectUsesClaude(m: Model): boolean {
  const { project, projectEntries, files } = m.ctx;
  const proj = toPosix(project);
  return (
    projectEntries.some((p) => p.startsWith(`${proj}/.claude/`) || p === `${proj}/CLAUDE.md` || p === `${proj}/.mcp.json`) ||
    files.some((f) => f.tool === "claude" && (f.scope === "project" || f.scope === "local"))
  );
}

/** Secrets files in the project that a deny rule should cover (.npmrc and .pypirc only when they hold a token). */
export function secretFilesToGuard(m: Model): ConfigFile[] {
  return m.ctx.files.filter((file) => {
    if (file.kind !== "secret-file") return false;
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    return !(/^\.(npmrc|pypirc)$/i.test(name) && !hasToken(name, file.text));
  });
}

export function checkDeny(m: Model): Finding[] {
  if (!projectUsesClaude(m)) return [];
  const { project, home } = m.ctx;
  const proj = toPosix(project);
  const ruleSets = m.settings.map((p) => readDenyRules(p, home, proj));
  const out: Finding[] = [];
  for (const file of secretFilesToGuard(m)) {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    if (ruleSets.some((rs) => coveredByFile(rs, file.path, home, proj))) continue;
    out.push(
      make("DENY", {
        rule: "DENY-001",
        severity: "medium",
        title: "A secrets file in this project isn't blocked from the agent",
        file,
        line: 1,
        match: file.display,
        why: "Claude Code can read this file without asking, and anything it reads can end up in a prompt, a log or a tool call.",
        fix: `Add "Read(${file.display})" to permissions.deny in .claude/settings.json, or "Read(**/${name})" to cover every copy.`,
      }),
    );
  }
  return out;
}
