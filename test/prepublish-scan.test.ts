import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Runs tools/prepublish-scan.mjs from a throwaway git repo whose local identity is the public pseudonym and whose
// "global" config (GIT_CONFIG_GLOBAL) holds a stand-in real name, then scans a folder of sample files.
const SCAN = resolve("tools/prepublish-scan.mjs");
const root = mkdtempSync(join(tmpdir(), "prepublish-scan-"));
const repo = join(root, "repo");
const globalConfig = join(root, "gitconfig");
mkdirSync(repo);
writeFileSync(globalConfig, "[user]\n\tname = Pat Example\n\temail = pat.example@example.test\n");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: globalConfig,
  GIT_CONFIG_NOSYSTEM: "1",
  PREPUBLISH_EXTRA_NAMES: "",
  PREPUBLISH_ALLOW_NO_REAL_NAME: "",
};
// A git hook may set these; they must not point the throwaway repo at the real one.
for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[k];
const gitIn = (...args: string[]) => spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
gitIn("init", "-q");
gitIn("config", "user.name", "ruddy-dev");
gitIn("config", "user.email", "345788022+ruddy-dev@users.noreply.github.com");

function scan(files: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(root, "files-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const r = spawnSync(process.execPath, [SCAN, dir], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("prepublish scan", () => {
  it("passes files that name only the public pseudonym", () => {
    const r = scan({ "LICENSE": "Copyright (c) 2026 ruddy-dev\n", "plugin.json": '{"author":{"name":"ruddy-dev"}}' });
    expect(r.out).toContain("files clean");
    expect(r.status).toBe(0);
  });

  it("still fails on the real name from the global git config", () => {
    const r = scan({ "NOTICE": "Copyright (c) 2026 Pat Example\n" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("NOTICE: contains local identity");
    expect(r.out).not.toContain("Pat Example"); // identities are numbered, never printed
  });

  it("fails on a bundle that names source files outside the repo", () => {
    // esbuild writes each module's path as a comment; a linked node_modules makes those paths climb out of the repo.
    const r = scan({ "cli.mjs": "// ../../other-checkout/node_modules/pkg/index.js\nvar a = 1;\n" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("cli.mjs: names a source path outside the repo");
    expect(scan({ "a.mjs": "// C:/work/other/node_modules/pkg/index.js\n" }).status).toBe(1); // esbuild across drives
    expect(scan({ "b.mjs": "// /opt/build/node_modules/pkg/index.js\n" }).status).toBe(1);
    expect(scan({ "cli.mjs": "// node_modules/pkg/index.js\n// src/cli.ts\n// https://example.com\nvar a = 1;\n" }).status).toBe(0);
  });

  it("still fails on the real email from the global git config", () => {
    expect(scan({ "a.md": "mail pat.example@example.test" }).status).toBe(1);
  });

  it("catches a real name split across lines", () => {
    expect(scan({ "a.md": "Copyright Pat\n  Example" }).status).toBe(1);
  });

  it("finds a real name held in a file the global config includes", () => {
    const inc = join(root, "gitconfig-included");
    const outer = join(root, "gitconfig-outer");
    writeFileSync(inc, "[user]\n\tname = Pat Example\n");
    writeFileSync(outer, `[include]\n\tpath = ${inc.replaceAll("\\", "/")}\n`);
    expect(scan({ "a.md": "by Pat Example" }, { GIT_CONFIG_GLOBAL: outer }).status).toBe(1);
  });

  it("fails when no real name is available, unless told to scan without one", () => {
    const empty = join(root, "gitconfig-empty");
    writeFileSync(empty, "");
    const r = scan({ "a.md": "by ruddy-dev" }, { GIT_CONFIG_GLOBAL: empty });
    expect(r.status).toBe(1);
    expect(r.out).toContain("real name can't be checked");
    expect(scan({ "a.md": "by ruddy-dev" }, { GIT_CONFIG_GLOBAL: empty, PREPUBLISH_EXTRA_NAMES: " ,x" }).status).toBe(1);
    const ok = scan({ "a.md": "by ruddy-dev" }, { GIT_CONFIG_GLOBAL: empty, PREPUBLISH_ALLOW_NO_REAL_NAME: "1" });
    expect(ok.status).toBe(0);
    expect(ok.out).toContain("real name NOT checked");
  });

  it("checks names given in PREPUBLISH_EXTRA_NAMES", () => {
    expect(scan({ "a.md": "by Sam Other" }, { PREPUBLISH_EXTRA_NAMES: "Sam Other" }).status).toBe(1);
  });
});
