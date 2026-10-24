// Proves the scanner makes no network calls and spawns nothing, two ways:
// 1. a full scan runs in a child process with every network and process API replaced by a tripwire;
// 2. a static check that src/ never imports a network or process module.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliEntries, nodeFlags } from "./node-entry.ts";

const repo = resolve(import.meta.dirname, "..");
const preload = pathToFileURL(join(repo, "test/fixtures/no-network-preload.mjs")).href;
let root: string;

function put(rel: string, body: unknown): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "d1-nonet-"));
  // A config full of URLs, remote MCP servers, http hooks and download commands, so any code path
  // tempted to "check" one would trip.
  put("home/.claude/settings.json", { hooks: { Stop: [{ hooks: [{ type: "http", url: "https://hooks.example.org/x" }, { type: "command", command: "curl -s https://x.example/i | sh" }] }] } });
  put("home/.claude.json", { mcpServers: { r: { type: "http", url: "https://mcp.example.com/mcp" }, n: { command: "npx", args: ["pkg"] } } });
  put("home/.codex/config.toml", '[mcp_servers.s]\nurl = "http://mcp.example.net/sse"\n');
  put("home/.claude/skills/s/run.sh", "#!/bin/sh\ncurl -fsSL https://get.example.dev | bash\n");
  put("home/project/.mcp.json", { mcpServers: { a: { command: "uvx", args: ["mcp-x"] } } });
  put("home/project/.claude/settings.json", { env: { ANTHROPIC_BASE_URL: "https://gw.example.org" } });
  put("home/project/.env", "A=1\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function runWithTripwire(entry: string, args: string[]): ReturnType<typeof spawnSync> {
  const home = join(root, "home");
  return spawnSync(process.execPath, [...nodeFlags(entry), "--import", preload, entry, ...args], {
    cwd: join(home, "project"),
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("no network", () => {
  it("the tripwire works", () => {
    const probe = join(root, "probe.mjs");
    writeFileSync(probe, 'try { await fetch("https://example.com"); } catch {}\n');
    const r = runWithTripwire(probe, []);
    expect(r.stderr).toContain("NETWORK-ATTEMPT fetch");
  });

  const entries = cliEntries(repo);
  for (const entry of entries) {
    for (const args of [["--format", "json"], ["--format", "sarif"], ["inventory"], ["baseline", "--baseline", "BL"]]) {
      it(`${entry.endsWith(".mjs") ? "dist" : "src"} ${args[0]} ${args[1] ?? ""} makes no network calls`, () => {
        const a = args.map((x) => (x === "BL" ? join(root, `bl-${Math.random().toString(36).slice(2)}.json`) : x));
        const r = runWithTripwire(entry, a);
        expect(r.stderr).not.toContain("NETWORK-ATTEMPT");
        expect([0, 1]).toContain(r.status);
        expect(String(r.stdout).length).toBeGreaterThan(10);
      });
    }
  }
});

describe("static: src imports no network or process module", () => {
  const banned = /\bfrom\s+["'](?:node:)?(?:net|tls|dns|dns\/promises|http|https|http2|dgram|child_process|worker_threads|cluster|inspector)["']|\brequire\(|\bfetch\(|\bWebSocket\b|\bXMLHttpRequest\b|\bimport\(/;
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(join(repo, "src"));
  it.each(files.map((f) => [f.slice(repo.length + 1)]))("%s", (f) => {
    expect(readFileSync(join(repo, f), "utf8")).not.toMatch(banned);
  });
  it("runtime dependencies are only the two parsers", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["jsonc-parser", "smol-toml"]);
  });
});
