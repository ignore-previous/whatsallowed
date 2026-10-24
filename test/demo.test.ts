import { describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.ts";
import { DEMO_PROJECT, scanDemo } from "../src/demo.ts";

const TOKEN = "q7Rk2mWz9LpX4vNc8TbY3sHd";

// cwd and home point nowhere: the demo must not need or read either.
function cli(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const io: Io = { out: (s) => (out += s), err: (s) => (err += s), cwd: "/no/such/folder", home: "/no/such/home", platform: "linux", env: {}, isTty: false };
  return { code: run(argv, io), out, err };
}

describe("demo", () => {
  it("exits 0 and says the setup is made up", () => {
    const r = cli(["demo"]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/made-up/i);
    expect(r.out).toContain("not a security assessment");
  });

  it("finds the risks planted in the made-up setup", () => {
    const ids = new Set(scanDemo("all").findings.map((f) => f.rule));
    for (const id of ["ALLOW-001", "MODE-005", "HOOK-001", "SECRET-002", "MODE-007", "MCP-001", "DRIFT-001"]) expect(ids).toContain(id);
  });

  it("checks the made-up project, not the folder it runs in", () => {
    const r = scanDemo("all");
    expect(r.findings.some((f) => f.file.includes(".claude/settings.json"))).toBe(true);
    expect(JSON.stringify(r)).not.toContain("/no/such");
    expect(DEMO_PROJECT).toMatch(/^\/home\/demo\//);
  });

  it("masks the made-up token in every format", () => {
    for (const args of [["demo"], ["demo", "--verbose"], ["demo", "--format", "json"], ["demo", "--format", "sarif"]]) {
      const r = cli(args);
      expect(r.out).not.toContain(TOKEN);
    }
    expect(cli(["demo"]).out).toContain("q7Rk");
  });

  it("gives parseable JSON and SARIF without the intro", () => {
    const j = JSON.parse(cli(["demo", "--format", "json"]).out);
    expect(j.findings.length).toBeGreaterThan(5);
    const s = JSON.parse(cli(["demo", "--format", "sarif"]).out);
    expect(s.version).toBe("2.1.0");
  });

  it("respects --project-only and --user-only", () => {
    const p = scanDemo("project").findings.map((f) => f.rule);
    const u = scanDemo("user").findings.map((f) => f.rule);
    expect(p).toContain("HOOK-001");
    expect(p).not.toContain("MODE-007");
    expect(u).toContain("MODE-007");
    expect(u).not.toContain("HOOK-001");
  });

  it("refuses a folder argument", () => {
    const r = cli(["demo", "some/path"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("takes no folder");
  });

  it("exits 0 even with --fail-on info", () => {
    expect(cli(["demo", "--fail-on", "info"]).code).toBe(0);
  });
});
