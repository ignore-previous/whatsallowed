// Files we can't read in full must never read as clean: they get a finding (too large) or a note (the rest).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.ts";
import { decodeText, MAX_BYTES } from "../src/fsys.ts";
import { shapeProblems } from "../src/shape.ts";
import { scanFiles } from "./helpers.ts";

let root: string;
let home: string;
let project: string;

function put(rel: string, body: string | Buffer, base = project): void {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function cli(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const io: Io = { out: (s) => (out += s), err: (s) => (err += s), cwd: project, home, platform: "linux", env: {}, isTty: false };
  return { code: run(argv, io), out, err };
}

const ALLOW_ALL = JSON.stringify({ permissions: { allow: ["Bash(*)"] } });
const padded = (): string => JSON.stringify({ permissions: { allow: ["Bash(*)"] }, padding: "x".repeat(MAX_BYTES) });
const utf16 = (s: string, bom: boolean): Buffer => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, "utf16le")]);
const notes = (files: Record<string, string>): string[] => scanFiles(files).notes;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wa-unread-"));
  home = join(root, "home");
  project = join(home, "project");
  mkdirSync(project, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("config file over 1 MiB", () => {
  it("is reported as FILE-001, not as a clean scan", () => {
    put(".claude/settings.json", padded());
    const r = cli([]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("FILE-001");
    expect(r.out).toContain(".claude/settings.json");
    expect(r.out).toContain("too large to check");
    expect(r.out).toContain("limit 1,048,576 bytes");
    expect(r.out).toContain("0 read.");
    expect(r.out).not.toContain("read: .");
    expect(r.out).not.toContain("Nothing was checked");
    expect(r.out).not.toContain("No high or medium findings");
  });
  it("fails --fail-on at the levels a normal finding would", () => {
    put(".claude/settings.json", padded());
    for (const level of ["high", "medium", "info"]) expect(cli(["--fail-on", level]).code, level).toBe(1);
    expect(cli(["--fail-on", "never"]).code).toBe(0);
  });
  it("appears in JSON and SARIF", () => {
    put(".claude/settings.json", padded());
    const j = JSON.parse(cli(["--format", "json"]).out);
    expect(j.findings.map((f: { rule: string }) => f.rule)).toContain("FILE-001");
    expect(j.summary.files.unchecked).toBe(1);
    const s = JSON.parse(cli(["--format", "sarif"]).out);
    expect(s.runs[0].results.map((x: { ruleId: string }) => x.ruleId)).toContain("FILE-001");
  });
  it("still checks the other files", () => {
    put(".claude/settings.json", padded());
    put(".mcp.json", JSON.stringify({ mcpServers: { a: { command: "npx", args: ["pkg"] } } }));
    expect(cli(["--format", "json"]).out).toContain("MCP-001");
  });
  it("is medium in a user file, so a big ~/.claude.json does not fail the default run", () => {
    put(".claude.json", JSON.stringify({ padding: "x".repeat(MAX_BYTES) }), home);
    const j = JSON.parse(cli(["--format", "json"]).out);
    const f = j.findings.find((x: { rule: string }) => x.rule === "FILE-001");
    expect(f.severity).toBe("medium");
    expect(f.fix).toContain("claude mcp list");
    expect(f.fix).not.toMatch(/split the file/);
    expect(cli([]).code).toBe(0);
    expect(cli(["--fail-on", "medium"]).code).toBe(1);
  });
  it("is reported from in-memory files too", () => {
    const r = scanFiles({ "./.claude/settings.json": padded() });
    const f = r.findings.find((x) => x.rule === "FILE-001");
    expect(f?.file).toBe("./.claude/settings.json");
    expect(f?.severity).toBe("high");
  });
  it("a file just under the limit is read normally", () => {
    const body = JSON.stringify({ permissions: { allow: ["Bash(*)"] }, padding: "x".repeat(MAX_BYTES - 200) });
    const r = scanFiles({ "./.claude/settings.json": body });
    expect(r.findings.map((x) => x.rule)).toContain("ALLOW-001");
    expect(r.findings.map((x) => x.rule)).not.toContain("FILE-001");
  });
});

describe("deeply nested JSON", () => {
  const deep = (n: number): string => "[".repeat(n) + "]".repeat(n);
  it("does not crash, and the file gets a note", () => {
    put(".claude/settings.json", deep(200_000));
    put(".mcp.json", JSON.stringify({ mcpServers: { a: { command: "npx", args: ["pkg"] } } }));
    const r = cli(["--format", "json"]);
    expect(r.code).not.toBe(2);
    expect(r.err).toBe("");
    const j = JSON.parse(r.out);
    expect(j.notes.join("\n")).toContain("nested too deeply to read, skipped");
    expect(j.findings.map((f: { rule: string }) => f.rule)).toContain("MCP-001");
  });
  it("covers objects nested inside a real settings file", () => {
    const text = `{"permissions":{"allow":["Bash(*)"]},"x":${'{"a":'.repeat(50_000)}1${"}".repeat(50_000)}}`;
    const r = scanFiles({ "./.claude/settings.json": text });
    expect(r.notes.join("\n")).toContain("nested too deeply to read");
  });
  it("brackets inside strings do not count", () => {
    const text = JSON.stringify({ permissions: { allow: ["Bash(*)"] }, x: "[".repeat(5000) });
    expect(scanFiles({ "./.claude/settings.json": text }).findings.map((f) => f.rule)).toContain("ALLOW-001");
  });
  it("TOML nesting does not crash", () => {
    const text = `a = ${"[".repeat(100_000)}${"]".repeat(100_000)}\n`;
    expect(notes({ "~/.codex/config.toml": text }).join("\n")).toContain("skipped");
  });
});

describe("UTF-16 files", () => {
  it("decodeText reads UTF-16 with and without a BOM, and strips a UTF-8 BOM", () => {
    expect(decodeText(utf16('{"a":1}', true))).toBe('{"a":1}');
    expect(decodeText(utf16('{"a":1}', false))).toBe('{"a":1}');
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('{"a":1}', "utf16le").swap16()]))).toBe('{"a":1}');
    expect(decodeText(Buffer.from("﻿{}", "utf8"))).toBe("{}");
    expect(decodeText(Buffer.from("héllo", "utf8"))).toBe("héllo");
  });
  it("UTF-16LE settings.json (BOM or not) gives the same finding as UTF-8", () => {
    put(".claude/settings.json", ALLOW_ALL);
    const base = JSON.parse(cli(["--format", "json"]).out).findings.map((f: { rule: string; line: number }) => [f.rule, f.line]);
    expect(base).toContainEqual(["ALLOW-001", expect.any(Number)]);
    for (const bom of [true, false]) {
      put(".claude/settings.json", utf16(ALLOW_ALL, bom));
      const j = JSON.parse(cli(["--format", "json"]).out);
      expect(j.findings.map((f: { rule: string; line: number }) => [f.rule, f.line]), `bom=${bom}`).toEqual(base);
      expect(j.notes.join("\n")).not.toContain("skipped");
    }
  });
  it("UTF-16LE pretty-printed with CRLF keeps the right line", () => {
    const text = JSON.stringify({ permissions: { allow: ["Bash(*)"] } }, null, 2).replace(/\n/g, "\r\n");
    put(".claude/settings.json", text);
    const a = JSON.parse(cli(["--format", "json"]).out).findings[0].line;
    put(".claude/settings.json", utf16(text, true));
    expect(JSON.parse(cli(["--format", "json"]).out).findings[0].line).toBe(a);
  });
});

describe("files we can't read get a note", () => {
  const S = "./.claude/settings.json";
  it("binary data", () => {
    const n = notes({ [S]: "{\u0000\u0001\u0002 binary" });
    expect(n.join("\n")).toContain(".claude/settings.json: looks like a binary file, not text, skipped");
  });
  it("a top-level list", () => {
    expect(notes({ [S]: '["Bash(*)"]' }).join("\n")).toContain(".claude/settings.json: the top level is a list, not an object, skipped");
  });
  it("a top-level number, text and null", () => {
    expect(notes({ [S]: "42" }).join("\n")).toContain("the top level is a number, not an object, skipped");
    expect(notes({ [S]: '"hi"' }).join("\n")).toContain("the top level is text, not an object, skipped");
    expect(notes({ [S]: "null" }).join("\n")).toContain("not an object, skipped");
  });
  it("truncated JSON", () => {
    const n = notes({ [S]: '{"permissions": {"allow": ["Bash(*)"' }).join("\n");
    expect(n).toMatch(/\.claude\/settings\.json: couldn't fully read this file, JSON has syntax errors near line 1\./);
    expect(n).toContain("Only the part that could be read was checked.");
  });
  it("truncated JSON still reports what could be read", () => {
    const r = scanFiles({ [S]: '{"permissions": {"allow": ["Bash(*)"]}, "env": {' });
    expect(r.findings.map((f) => f.rule)).toContain("ALLOW-001");
    expect(r.notes.join("\n")).toContain("couldn't fully read");
  });
  it("text that is not JSON", () => {
    expect(notes({ [S]: "hello there" }).join("\n")).toContain("not valid JSON, skipped");
  });
  it("wrong types where a list or object belongs", () => {
    const n = notes({ [S]: JSON.stringify({ permissions: { allow: "Bash(*)", deny: { a: 1 } }, hooks: [] }) }).join("\n");
    expect(n).toContain('"permissions.allow" is text, not a list');
    expect(n).toContain('"permissions.deny" is an object, not a list');
    expect(n).toContain('"hooks" is a list, not an object');
    expect(n).toContain("Those settings were ignored.");
  });
  it("permissions as text", () => {
    expect(notes({ [S]: JSON.stringify({ permissions: "allow everything" }) }).join("\n")).toContain('"permissions" is text, not an object');
  });
  it("MCP server definitions of the wrong type", () => {
    const n = notes({ "./.mcp.json": JSON.stringify({ mcpServers: { a: "npx pkg", b: { command: "npx", args: "pkg" } } }) }).join("\n");
    expect(n).toContain('"mcpServers.a" is text, not an object');
    expect(n).toContain('"mcpServers.b.args" is text, not a list');
  });
  it("a Codex file with a wrong-typed value", () => {
    expect(notes({ "~/.codex/config.toml": 'mcp_servers = "x"\n' }).join("\n")).toContain('"mcp_servers" is text, not an object');
  });
  it("a Codex file with syntax errors", () => {
    expect(notes({ "~/.codex/config.toml": "this is [not toml" }).join("\n")).toContain("config.toml: TOML has syntax errors, skipped");
  });
  it("many problems are capped", () => {
    const n = shapeProblems("claude-settings", { permissions: { allow: 1, deny: 1, ask: 1, additionalDirectories: 1 }, hooks: 1, env: 1 });
    expect(n).toHaveLength(4);
    expect(n[3]).toBe("and 3 more");
  });
  it("a well-formed file gets no note", () => {
    expect(notes({ [S]: JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: {}, env: { A: "b" } }) })).toEqual([]);
  });
  it("the notes do not change the exit code on their own", () => {
    put(".claude/settings.json", "[]");
    const r = cli([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("the top level is a list");
  });
});
