import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/cli.ts";
import { scanDemo } from "../src/demo.ts";
import { formatJson, formatSarif, formatText } from "../src/output.ts";
import { scanFiles } from "./helpers.ts";

function demo(args: string[] = [], terminal: Partial<Io> = {}): string {
  let out = "";
  expect(run(["demo", ...args], {
    out: (s) => { out += s; }, err: () => {}, cwd: "/absent", home: "/absent",
    platform: "linux", env: { NO_COLOR: "1" }, isTty: false, ...terminal,
  })).toBe(0);
  return out;
}

describe("short text reports", () => {
  it("opens with counts and keeps explanations out of the default report", () => {
    const out = demo();
    expect(out.split("\n")[0]).toMatch(/^\d+ high, \d+ medium, \d+ info; \d+ files checked\.$/);
    expect(out).toContain("./.claude/settings.json:4");
    expect(out).not.toContain("What this means:");
    expect(out).not.toContain("Rule:");
  });

  it("preserves the pre-change JSON and SARIF bytes", () => {
    const result = scanDemo();
    expect(formatJson(result)).toBe(readFileSync(new URL("./fixtures/demo-before.json", import.meta.url), "utf8"));
    expect(formatSarif(result)).toBe(readFileSync(new URL("./fixtures/demo-before.sarif", import.meta.url), "utf8"));
  });

  it.each([false, true])("snapshots the demo and clean report, details=%s", (details) => {
    expect(demo(details ? ["--details"] : [])).toMatchSnapshot();
    const clean = scanFiles({ "./.claude/settings.json": { permissions: { allow: ["Bash(npm test)"] } } });
    expect(clean.findings).toEqual([]);
    expect(formatText(clean, { color: false, details, width: 80 })).toMatchSnapshot();
  });

  it.each([20, 40, 60, 80, 90, 120])("wraps both demo modes at terminal width %s", (columns) => {
    for (const details of [[], ["--details"], ["--details", "--verbose"]]) {
      for (const isTty of [false, true]) {
        const out = demo(details, { columns, isTty });
        expect(Math.max(...out.split("\n").map((line) => Array.from(line).length))).toBeLessThanOrEqual(isTty ? Math.min(columns, 90) : 80);
      }
    }
  });

  it("indents explanation continuations under the label", () => {
    const lines = demo(["--details"]).split("\n");
    const start = lines.findIndex((line) => line.startsWith("    What this means:"));
    expect(lines[start + 1]).toMatch(/^ {21}\S/);
    expect(demo(["--details"])).toContain("Rule: ALLOW-001");
    expect(demo(["--help"])).toContain("--details");
  });

  it("never rewrites names taken from the user's config", () => {
    const r = scanFiles({ "./.mcp.json": { mcpServers: { "agent-tools": { type: "http", url: "http://tools.example.com/mcp" } } } });
    const out = formatText(r, { color: false, width: 80 });
    expect(r.findings.some((f) => f.rule === "MCP-006")).toBe(true);
    expect(out).toContain('Extra tool "agent-tools" talks to a remote host');
    expect(out).not.toContain("AI-tools");
  });

  it("gives each default finding a first step and points to --details", () => {
    const out = demo();
    expect(out).toContain("What to do: Replace it with the specific commands you use");
    expect(out).toContain("Add --details");
    expect(demo(["--details"])).not.toContain("What to do:");
  });

  it("keeps JSON identical with text flags combined", () => {
    expect(demo(["--format", "json", "--details", "--verbose"])).toBe(demo(["--format", "json"]));
  });

  it("wraps long paths and notes without dropping characters", () => {
    const result = scanDemo();
    const path = `./${"x".repeat(150)}.json`;
    const out = formatText({ ...result, findings: [{ ...result.findings[0]!, file: path }], notes: ["y".repeat(150)] }, { color: false, width: 40 });
    expect(Math.max(...out.split("\n").map((line) => line.length))).toBeLessThanOrEqual(40);
    expect(out.replace(/\s/g, "")).toContain(path);
    expect(out.replace(/\s/g, "")).toContain("y".repeat(150));
  });
});
