// A config file that exists but can't be opened must be named in the report, not skipped. The file system is
// mocked, so these tests don't depend on OS permissions and run the same on Windows and Linux.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blocked = vi.hoisted(() => ({ names: [] as string[], stat: [] as [string, string][] }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((p: unknown, ...rest: unknown[]) => {
      const path = String(p).replaceAll("\\", "/");
      if (blocked.names.some((n) => path.endsWith(n))) throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES" });
      return (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof actual.readFileSync,
    statSync: ((p: unknown, ...rest: unknown[]) => {
      const path = String(p).replaceAll("\\", "/");
      const hit = blocked.stat.find(([n]) => path.endsWith(n));
      if (hit) throw Object.assign(new Error(`${hit[1]}: stat '${path}'`), { code: hit[1] });
      return (actual.statSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof actual.statSync,
  };
});

import { type Io, run } from "../src/cli.ts";
import { memFs, nodeFs } from "../src/fsys.ts";
import { scan } from "../src/scan.ts";
import { HOME, PROJECT, scanFiles } from "./helpers.ts";

let root: string;
let home: string;
let project: string;

function put(rel: string, body: string, base = project): void {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function cli(argv: string[]): { code: number; out: string } {
  let out = "";
  const io: Io = { out: (s) => (out += s), err: () => undefined, cwd: project, home, platform: "linux", env: {}, isTty: false };
  return { code: run(argv, io), out };
}

beforeEach(() => {
  blocked.names = [];
  blocked.stat = [];
  root = mkdtempSync(join(tmpdir(), "wa-open-"));
  home = join(root, "home");
  project = join(home, "project");
  mkdirSync(project, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ALLOW_ALL = JSON.stringify({ permissions: { allow: ["Bash(*)"] } });

describe("nodeFs.openError", () => {
  it("returns the error code for a file that exists but can't be read", () => {
    put(".claude/settings.json", ALLOW_ALL);
    const file = join(project, ".claude/settings.json");
    expect(nodeFs.openError(file)).toBeUndefined();
    blocked.names = [".claude/settings.json"];
    expect(nodeFs.openError(file)).toBe("EACCES");
    expect(nodeFs.readText(file)).toBeUndefined();
  });
  it("returns the code when the file's folder can't be entered or the path loops", () => {
    const file = join(project, ".claude/settings.json");
    for (const code of ["EACCES", "EPERM", "ELOOP"]) {
      blocked.stat = [[".claude/settings.json", code]];
      expect(nodeFs.openError(file), code).toBe(code);
    }
    blocked.stat = [[".claude/settings.json", "ENOTDIR"]];
    expect(nodeFs.openError(file)).toBeUndefined();
  });
  it("names a file whose folder can't be entered in the report", () => {
    blocked.stat = [[".claude/settings.json", "EACCES"]];
    const r = cli([]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Couldn't open ./.claude/settings.json, so it wasn't checked");
  });
  it("returns nothing for a missing file or a folder", () => {
    mkdirSync(join(project, "adir"), { recursive: true });
    expect(nodeFs.openError(join(project, "nope.json"))).toBeUndefined();
    expect(nodeFs.openError(join(project, "adir"))).toBeUndefined();
  });
});

describe("a config file that can't be opened", () => {
  beforeEach(() => {
    put(".claude/settings.json", ALLOW_ALL);
    put(".mcp.json", JSON.stringify({ mcpServers: { a: { command: "npx", args: ["pkg"] } } }));
    blocked.names = [".claude/settings.json"];
  });

  it("is named in the short text report", () => {
    const r = cli([]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Couldn't open ./.claude/settings.json, so it wasn't checked");
    expect(r.out).toContain("What to do: Make sure you can read the file, then run the check again.");
    expect(r.out).not.toContain("FILE-002");
    expect(r.out).not.toContain("Nothing was checked");
  });
  it("has the full explanation behind --details", () => {
    const r = cli(["--details"]);
    expect(r.out).toContain("FILE-002");
    expect(r.out).toContain("could not be opened (EACCES)");
    expect(r.out).toContain("nothing in it was checked");
  });
  it("counts the file as unchecked, not as read, and still checks the other files", () => {
    const j = JSON.parse(cli(["--format", "json"]).out);
    expect(j.summary.files.unchecked).toBe(1);
    expect(j.summary.files.total).toBe(1);
    expect(j.files.map((f: { path: string }) => f.path)).toEqual(["./.mcp.json"]);
    expect(j.findings.map((f: { rule: string }) => f.rule)).toContain("MCP-001");
  });
  it("appears in JSON as a finding, with the existing keys only", () => {
    const j = JSON.parse(cli(["--format", "json"]).out);
    const f = j.findings.find((x: { rule: string }) => x.rule === "FILE-002");
    expect(Object.keys(f)).toEqual(["rule", "check", "severity", "title", "file", "line", "match", "why", "fix"]);
    expect(f).toMatchObject({
      check: "FILE",
      severity: "high",
      title: "Couldn't open ./.claude/settings.json, so it wasn't checked",
      file: "./.claude/settings.json",
      line: 1,
      match: "the file is there but could not be opened (EACCES)",
    });
    expect(Object.keys(j)).toEqual(["tool", "version", "files", "findings", "notes", "summary"]);
  });
  it("appears in SARIF", () => {
    const s = JSON.parse(cli(["--format", "sarif"]).out);
    const x = s.runs[0].results.find((r: { ruleId: string }) => r.ruleId === "FILE-002");
    expect(x.level).toBe("error");
    expect(x.message.text).toContain("Couldn't open ./.claude/settings.json");
    expect(x.locations[0].physicalLocation.artifactLocation.uri).toBe(".claude/settings.json");
    expect(s.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toContain("FILE-002");
  });
  it("fails --fail-on like any other finding, and is listed in the inventory", () => {
    for (const level of ["high", "medium", "info"]) expect(cli(["--fail-on", level]).code, level).toBe(1);
    expect(cli(["--fail-on", "never"]).code).toBe(0);
    expect(cli(["inventory"]).out).toContain("(couldn't be opened, not checked)");
  });
  it("is the only thing reported when it is the only config file", () => {
    rmSync(join(project, ".mcp.json"));
    const r = cli([]);
    expect(r.out).toContain("1 high, 0 medium, 0 info; 0 files checked.");
    expect(r.out).not.toContain("Nothing was checked");
  });
  it("is medium in your own folder, so it does not fail the default run", () => {
    rmSync(join(project, ".claude"), { recursive: true });
    rmSync(join(project, ".mcp.json"));
    put(".claude/settings.json", ALLOW_ALL, home);
    const j = JSON.parse(cli(["--format", "json"]).out);
    const f = j.findings.find((x: { rule: string }) => x.rule === "FILE-002");
    expect(f.severity).toBe("medium");
    expect(f.file).toBe("~/.claude/settings.json");
    expect(cli([]).code).toBe(0);
  });
  it("is not raised for a file that does not exist", () => {
    rmSync(join(project, ".claude"), { recursive: true });
    expect(cli(["--format", "json"]).out).not.toContain("FILE-002");
  });
});

describe("the same, with the in-memory file system", () => {
  const base = { home: HOME, project: PROJECT, mode: "all" as const, managedDirs: [] };
  it("reports a file the file system says it can't open", () => {
    const r = scan({ ...base, fs: memFs({ [`${PROJECT}/.mcp.json`]: "{}" }, { unopenable: [`${PROJECT}/.claude/settings.json`] }) });
    expect(r.unchecked).toHaveLength(1);
    expect(r.unchecked[0]).toMatchObject({ reason: "unopenable", error: "EACCES", display: "./.claude/settings.json" });
    expect(r.findings.map((f) => f.rule)).toEqual(["FILE-002"]);
  });
  it("does not report a file that is not there, and leaves normal scans unchanged", () => {
    const r = scanFiles({ "./.mcp.json": "{}" });
    expect(r.unchecked).toEqual([]);
    expect(r.findings.map((f) => f.rule)).not.toContain("FILE-002");
  });
  it("covers config files only, not instruction files", () => {
    const r = scan({ ...base, fs: memFs({}, { unopenable: [`${PROJECT}/CLAUDE.md`] }) });
    expect(r.unchecked).toEqual([]);
  });
});
