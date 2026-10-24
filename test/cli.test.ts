import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Io, parseArgs, run } from "../src/cli.ts";

let root: string;
let home: string;
let project: string;

function put(base: string, rel: string, body: unknown): void {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function cli(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const io: Io = { out: (s) => (out += s), err: (s) => (err += s), cwd: project, home, platform: "linux", env: {}, isTty: false };
  const code = run(argv, io);
  return { code, out, err };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "d1-cli-"));
  home = join(root, "home");
  project = join(home, "project");
  mkdirSync(project, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("exit codes", () => {
  it("0 on a clean setup", () => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(npm test)"] } });
    const r = cli([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("No high or medium findings in the 1 file checked.");
    expect(r.out).toContain("Summary: this project folder and your user settings.");
    expect(r.out).toContain("not a security assessment");
  });
  it("says nothing was checked when no config files exist", () => {
    const r = cli([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing was checked");
    expect(r.out).not.toContain("No high or medium findings");
  });
  it("1 when a high finding exists", () => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(*)"] } });
    expect(cli([]).code).toBe(1);
  });
  it("--fail-on raises and lowers the bar", () => {
    put(project, ".mcp.json", { mcpServers: { a: { command: "npx", args: ["pkg"] } } }); // medium only
    expect(cli([]).code).toBe(0);
    expect(cli(["--fail-on", "medium"]).code).toBe(1);
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash"] } });
    expect(cli(["--fail-on=never"]).code).toBe(0);
  });
  it("2 on bad usage or a missing folder", () => {
    expect(cli(["--format", "xml"]).code).toBe(2);
    expect(cli(["--bogus"]).code).toBe(2);
    expect(cli([join(root, "nope")]).code).toBe(2);
  });
});

describe("formats", () => {
  beforeEach(() => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(*)"] } });
    put(home, ".claude/settings.json", { permissions: { defaultMode: "bypassPermissions" } });
  });
  it("json lists findings with rule, file and line", () => {
    const j = JSON.parse(cli(["--format", "json"]).out);
    const rules = j.findings.map((f: { rule: string }) => f.rule);
    expect(rules).toContain("ALLOW-001");
    expect(rules).toContain("MODE-001");
    const f = j.findings.find((x: { rule: string }) => x.rule === "ALLOW-001");
    expect(f.file).toBe("./.claude/settings.json");
    expect(f.line).toBe(4);
  });
  it("sarif 2.1.0 with relative project paths and rule metadata", () => {
    const s = JSON.parse(cli(["--format", "sarif"]).out);
    expect(s.version).toBe("2.1.0");
    const run0 = s.runs[0];
    const ids = run0.tool.driver.rules.map((r: { id: string }) => r.id);
    for (const res of run0.results) {
      expect(ids[res.ruleIndex]).toBe(res.ruleId);
      expect(["error", "warning", "note"]).toContain(res.level);
      const loc = res.locations[0].physicalLocation;
      expect(loc.region.startLine).toBeGreaterThanOrEqual(1);
      expect(loc.artifactLocation.uri).not.toMatch(/^(\.\/|~\/|\/)/);
    }
    const proj = run0.results.find((r: { ruleId: string }) => r.ruleId === "ALLOW-001");
    expect(proj.locations[0].physicalLocation.artifactLocation).toEqual({ uri: ".claude/settings.json", uriBaseId: "SRCROOT" });
  });
  it("--project-only skips user files", () => {
    const j = JSON.parse(cli(["--project-only", "--format", "json"]).out);
    expect(j.findings.map((f: { rule: string }) => f.rule)).not.toContain("MODE-001");
  });
  it("text has no colour codes when not a terminal", () => {
    expect(cli([]).out).not.toContain("\x1b[");
  });
  it("rules, inventory, help and version run", () => {
    expect(cli(["rules"]).out).toContain("SKILL-003");
    expect(cli(["inventory"]).out).toContain(".claude/settings.json");
    expect(cli(["--help"]).out).toContain("Exit codes");
    expect(cli(["--version"]).code).toBe(0);
  });
});

describe("beginner-first text output", () => {
  it("leads with a plain verdict, then groups by priority, with detail kept but secondary", () => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(*)", "Bash(curl *)"] } });
    const lines = cli([]).out.split("\n");
    expect(lines[0]).toContain("read-only check");
    expect(lines[2]).toBe("2 things to look at in the 1 file checked. 1 needs attention first.");
    const out = lines.join("\n");
    expect(out.indexOf("Look at these first (1)")).toBeGreaterThan(-1);
    expect(out.indexOf("Look at these first (1)")).toBeLessThan(out.indexOf("Worth checking (1)"));
    expect(out).toContain("What this means:");
    expect(out).toContain("What you could do:");
    expect(out).toContain("Where: ./.claude/settings.json, line 4");
    expect(out).toContain("Rule: ALLOW-001");
    expect(out).toContain("Rule: ALLOW-002");
    expect(out).toContain("Nothing has been changed.");
    expect(out).toContain("--format json");
    // Rule IDs and file paths come after the plain title, not before it.
    expect(out.indexOf("An allow rule approves every shell command")).toBeLessThan(out.indexOf("ALLOW-001"));
  });
  it("explains each kind of setting once, the first time it appears", () => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(curl *)", "Bash(wget *)"] } });
    const out = cli([]).out;
    expect(out.split("Allow rule: a setting that lets your agent").length - 1).toBe(1);
    expect(out).not.toContain("Hook: a command");
  });
  it("says nothing needs urgent attention when only medium findings exist", () => {
    put(project, ".mcp.json", { mcpServers: { a: { command: "npx", args: ["pkg"] } } });
    const out = cli([]).out;
    expect(out).toContain("1 thing worth a look in the 1 file checked. Nothing needs urgent attention.");
    expect(out).not.toContain("Look at these first");
  });
  it("keeps --verbose working: info notes are hidden by default and shown with it", () => {
    put(home, ".claude/settings.json", { skipDangerousModePermissionPrompt: true });
    const hidden = cli([]).out;
    expect(hidden).toContain("lower-priority note is hidden. Add --verbose to see it.");
    expect(hidden).not.toContain("For your information");
    const shown = cli(["--verbose"]).out;
    expect(shown).toContain("For your information (1)");
    expect(shown).toContain("Rule: MODE-004");
    expect(shown).not.toContain("hidden");
  });
  it("uses colour only on a terminal and never changes the words", () => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(*)"] } });
    const plain = cli([]).out;
    let colour = "";
    run([], { out: (s) => (colour += s), err: () => {}, cwd: project, home, platform: "linux", env: {}, isTty: true });
    expect(colour).toContain("\x1b[");
    expect(colour.replace(/\x1b\[\d+m/g, "")).toBe(plain);
  });
  it("--format json keeps its keys and finding fields, and adds the summary", () => {
    put(project, ".claude/settings.json", { permissions: { allow: ["Bash(*)"] } });
    const j = JSON.parse(cli(["--format", "json"]).out);
    expect(Object.keys(j)).toEqual(["tool", "version", "files", "findings", "notes", "summary"]);
    expect(Object.keys(j.findings[0])).toEqual(["rule", "check", "severity", "title", "file", "line", "match", "why", "fix"]);
    expect(Object.keys(j.files[0])).toEqual(["path", "tool", "kind", "scope"]);
  });
});

describe("baseline", () => {
  it("records, refuses to overwrite, then flags drift", () => {
    const bl = join(root, "bl.json");
    put(project, ".mcp.json", { mcpServers: { a: { command: "npx", args: ["a@1.0.0"] } } });
    expect(cli(["baseline", "--baseline", bl]).code).toBe(0);
    expect(JSON.parse(readFileSync(bl, "utf8")).version).toBe(1);
    const again = cli(["baseline", "--baseline", bl]);
    expect(again.code).toBe(2);
    expect(again.err).toContain("--reset-baseline");
    put(project, ".mcp.json", { mcpServers: { a: { command: "npx", args: ["a@1.0.1"] } } });
    const j = JSON.parse(cli(["--format", "json", "--baseline", bl]).out);
    expect(j.findings.map((f: { rule: string }) => f.rule)).toContain("DRIFT-001");
    expect(cli(["baseline", "--baseline", bl, "--reset-baseline"]).code).toBe(0);
  });
  it("names a removed server once, with a relative path", () => {
    const bl = join(root, "bl.json");
    put(project, ".mcp.json", { mcpServers: { keep: { command: "npx", args: ["k@1.0.0"] }, gone: { command: "npx", args: ["g@1.0.0"] } } });
    expect(cli(["baseline", "--baseline", bl]).code).toBe(0);
    put(project, ".mcp.json", { mcpServers: { keep: { command: "npx", args: ["k@1.0.0"] } } });
    const text = cli(["--baseline", bl, "--verbose"]).out;
    expect(text).toContain("MCP server gone in ./.mcp.json was removed since the baseline.");
    expect(text).toContain("1 removed since then");
    expect(text.match(/\bgone\b/g)).toHaveLength(1);
    expect(text).not.toContain(root);
    const j = JSON.parse(cli(["--format", "json", "--baseline", bl]).out);
    const drift = j.summary.checks.find((c: { check: string }) => c.check === "DRIFT");
    expect(drift.items.join("\n")).not.toContain("removed:");
    expect(j.notes.join("\n")).toContain("MCP server gone in ./.mcp.json was removed since the baseline.");
  });
  it("2 on a corrupt baseline", () => {
    const bl = join(root, "bad.json");
    writeFileSync(bl, '{"hello":1}');
    expect(cli(["--baseline", bl]).code).toBe(2);
  });
});

describe("parseArgs", () => {
  it("accepts a path and a command in either order", () => {
    expect(parseArgs(["scan", "x"], {}).path).toBe("x");
    expect(parseArgs(["inventory"], {}).command).toBe("inventory");
    expect(parseArgs([], { NO_COLOR: "1" }).color).toBe(false);
  });
  it("rejects --project-only with --user-only", () => {
    expect(() => parseArgs(["--project-only", "--user-only"], {})).toThrow();
  });
});
