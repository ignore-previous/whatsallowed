import { type Fs, join, toPosix } from "./fsys.ts";

/** gitignore glob to a regex body. "*" stays inside one folder, "**" crosses folders. */
function globBody(pat: string): string {
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
    } else if (c === "\\" && i + 1 < pat.length) {
      out += (pat[++i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return out;
}

interface Pattern {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

/** Parse the lines of one ignore file. `base` is the folder it sits in, relative to the repo root ("" for the root). */
export function parseIgnore(text: string, base = ""): Pattern[] {
  const out: Pattern[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    line = line.replace(/\/+$/, "");
    if (!line) continue;
    // A slash at the start or in the middle anchors the pattern to the ignore file's folder.
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    const prefix = base ? `${base.replace(/\/+$/, "")}/` : "";
    const lead = anchored ? "" : "(?:.*/)?";
    const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out.push({ re: new RegExp(`^${esc}${lead}${globBody(line)}$`), negate, dirOnly });
  }
  return out;
}

/** Last matching pattern wins; undefined when none match. */
function verdict(patterns: Pattern[], rel: string, isDir: boolean): boolean | undefined {
  let v: boolean | undefined;
  for (const p of patterns) {
    if (p.dirOnly && !isDir) continue;
    if (p.re.test(rel)) v = !p.negate;
  }
  return v;
}

/**
 * Would git ignore this repo-relative file path? A file inside an ignored folder stays ignored,
 * because git doesn't look inside it, even if a later "!" pattern names the file.
 */
export function isIgnored(patterns: Pattern[], rel: string): boolean {
  const parts = toPosix(rel).split("/");
  for (let i = 1; i < parts.length; i++) {
    if (verdict(patterns, parts.slice(0, i).join("/"), true)) return true;
  }
  return verdict(patterns, parts.join("/"), false) ?? false;
}

/** The excludesFile path from a git config file, if set. */
function excludesFileFrom(gitconfig: string | undefined, home: string): string | undefined {
  if (!gitconfig) return undefined;
  let inCore = false;
  for (const line of gitconfig.split(/\r?\n/)) {
    const sec = /^\s*\[([^\]]+)\]/.exec(line);
    if (sec) {
      inCore = (sec[1] ?? "").trim().toLowerCase() === "core";
      continue;
    }
    const m = inCore ? /^\s*excludesfile\s*=\s*"?([^"#;]+?)"?\s*(?:[#;].*)?$/i.exec(line) : null;
    if (m?.[1]) return toPosix(m[1].replace(/^~(?=\/|\\|$)/, home));
  }
  return undefined;
}

/**
 * Is this project file kept out of git? Reads the project's .gitignore files, .git/info/exclude and the
 * user's global excludes file. A file already in the git index counts as tracked, so not ignored.
 */
export function gitIgnoresFile(fs: Fs, home: string, project: string, rel: string): boolean {
  const index = fs.readText(join(project, ".git/index"));
  if (index?.includes(rel)) return false;
  const patterns: Pattern[] = [];
  const globalFile = excludesFileFrom(fs.readText(join(home, ".gitconfig")), home) ?? join(home, ".config/git/ignore");
  const sources: Array<[string, string]> = [
    [globalFile, ""],
    [join(project, ".git/info/exclude"), ""],
    [join(project, ".gitignore"), ""],
  ];
  // .gitignore files in the folders on the way down to the file
  const dirs = rel.split("/").slice(0, -1);
  for (let i = 1; i <= dirs.length; i++) {
    const d = dirs.slice(0, i).join("/");
    sources.push([join(project, d, ".gitignore"), d]);
  }
  for (const [path, base] of sources) {
    const text = fs.readText(path);
    if (text !== undefined) patterns.push(...parseIgnore(text, base));
  }
  return isIgnored(patterns, rel);
}
