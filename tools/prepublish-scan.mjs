// Before a public export: fail if any file that would be published names this machine's user,
// git identity or home folder, or holds a real-format key. The identities are read at run time,
// so they are never written into the repo.
// Usage: node tools/prepublish-scan.mjs [dir]   (default: the current repo's tracked files)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { findRealFormatKeys } from "../eval/tools/keys.mjs";

const dir = process.argv[2];
const git = (args, cwd) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
// The public pseudonym this repo is published under. The repo's own git identity is set to it on purpose, so it is
// the one identity allowed in published files. Every other identity is still searched for: the OS user, the home
// folder, and every git name and email in any config scope (system, global, local, worktree, and files they include),
// which is where the real name usually lives. PREPUBLISH_EXTRA_NAMES (comma-separated) adds more.
// If no real name is found anywhere, the scan fails, because "clean" would mean the name was never checked.
// PREPUBLISH_ALLOW_NO_REAL_NAME=1 overrides that on purpose (for example in CI).
const PUBLIC_IDENTITIES = new Set(["ruddy-dev", "345788022+ruddy-dev@users.noreply.github.com"]);
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const usable = (s) => s.length >= 3 && !PUBLIC_IDENTITIES.has(s);
const gitIdentities = git(["config", "--includes", "--get-regexp", "^user\\.(name|email)$"], process.cwd())
  .split("\n")
  .map((line) => line.replace(/^\S+\s*/, ""))
  .map(norm)
  .filter(usable);
const extraNames = (process.env.PREPUBLISH_EXTRA_NAMES ?? "").split(",").map(norm).filter(usable);
const names = [
  ...new Set(
    [userInfo().username, homedir(), homedir().replaceAll("\\", "/"), ...gitIdentities, ...extraNames]
      .map(norm)
      .filter(usable),
  ),
];
if (gitIdentities.length === 0 && extraNames.length === 0) {
  if (process.env.PREPUBLISH_ALLOW_NO_REAL_NAME !== "1") {
    console.error(
      "prepublish scan: no git name or email other than the public pseudonym, so the real name can't be checked.\n" +
        "Set PREPUBLISH_EXTRA_NAMES to the real name, or PREPUBLISH_ALLOW_NO_REAL_NAME=1 to scan without it.",
    );
    process.exit(1);
  }
  console.error("warning: scanning without a real name (PREPUBLISH_ALLOW_NO_REAL_NAME=1)");
}

function walk(root) {
  const out = [];
  const go = (d) => {
    for (const n of readdirSync(d)) {
      if (n === ".git" || n === "node_modules") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) go(p);
      else out.push(relative(root, p));
    }
  };
  go(root);
  return out;
}
const root = dir ?? ".";
const files = dir ? walk(dir) : git(["ls-files", "--cached", "--others", "--exclude-standard"], ".").split("\n").filter(Boolean);
const problems = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(join(root, f), "utf8");
  } catch {
    continue;
  }
  const lower = norm(text);
  names.forEach((n, i) => {
    if (lower.includes(n)) problems.push(`${f}: contains local identity #${i + 1}`);
  });
  for (const k of findRealFormatKeys(text)) problems.push(`${f}: real-format key ${k}`);
  // esbuild marks each bundled module with a path comment. One that climbs out of the repo (a linked
  // node_modules, say) shows how this machine's folders are laid out.
  if (/^\/\/ (?:\.\.\/|\/|[A-Za-z]:[\\/])/m.test(text)) problems.push(`${f}: names a source path outside the repo`);
  if (/^progress\.md$/i.test(f)) problems.push(`${f}: progress notes must stay out of the public repo`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s). Identities are numbered, not printed.`);
  process.exit(1);
}
const scope = gitIdentities.length || extraNames.length ? "" : " (real name NOT checked)";
console.log(`prepublish scan: ${files.length} files clean${scope}`);
