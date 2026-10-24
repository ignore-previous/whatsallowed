import { describe, expect, it } from "vitest";
import { formatText } from "../src/output.ts";
import { type CheckSummary, type Summary, summarize } from "../src/summary.ts";
import type { CheckId } from "../src/types.ts";
import { scanFiles } from "./helpers.ts";

function sum(files: Record<string, unknown>, before?: Record<string, unknown>): { s: Summary; c: Record<CheckId, CheckSummary> } {
  const s = summarize(scanFiles(files, before));
  return { s, c: Object.fromEntries(s.checks.map((x) => [x.check, x])) as Record<CheckId, CheckSummary> };
}

const settings = (body: unknown): Record<string, unknown> => ({ "./.claude/settings.json": body });

describe("summary: one entry per check, in a fixed order", () => {
  it("lists all ten checks", () => {
    expect(sum(settings({})).s.checks.map((x) => x.check)).toEqual(["MODE", "ALLOW", "DENY", "ENDPOINT", "HOOK", "HTTPHOOK", "MCP", "DRIFT", "SECRET", "SKILL"]);
  });
});

describe("summary: files", () => {
  it("counts files per tool, with AGENTS.md and secrets files under other", () => {
    const { s } = sum({
      "./.claude/settings.json": {},
      "./CLAUDE.md": "# notes",
      "~/.codex/config.toml": 'model = "x"\n',
      "~/.cursor/mcp.json": { mcpServers: {} },
      "./AGENTS.md": "# agents",
      "./.env": "A=1",
    });
    expect(s.files).toEqual({ total: 6, claude: 2, codex: 1, cursor: 1, other: 2 });
    expect(s.scope).toBe("all");
  });
});

describe("summary: MODE", () => {
  it("names the broadest Claude Code mode and skips modes Claude Code ignores in project files", () => {
    const { c } = sum({ "~/.claude/settings.json": { permissions: { defaultMode: "acceptEdits" } }, ...settings({ permissions: { defaultMode: "bypassPermissions" } }) });
    expect(c.MODE.count).toBe(2);
    expect(c.MODE.broadest).toBe('Claude Code "acceptEdits"');
    expect(c.MODE.meaning).toBe("Claude Code edits files without asking, but asks before running commands.");
    expect(c.MODE.items.some((i) => i.includes("ignored in a project file"))).toBe(true);
  });
  it("names the broadest Codex sandbox and approval policy", () => {
    const { c } = sum({ "~/.codex/config.toml": 'sandbox_mode = "workspace-write"\napproval_policy = "never"\n[profiles.yolo]\nsandbox_mode = "danger-full-access"\n' });
    expect(c.MODE.count).toBe(3);
    expect(c.MODE.broadest).toBe('Codex "danger-full-access" with approval "never"');
    expect(c.MODE.meaning).toContain("full access to your disk and network");
    expect(c.MODE.meaning).toContain("never asks first");
  });
  it("says when no mode is set", () => {
    const { c } = sum(settings({}));
    expect(c.MODE.count).toBe(0);
    expect(c.MODE.text).toBe("No permission mode set in the files checked.");
  });
});

describe("summary: ALLOW", () => {
  it("counts allow rules and names the broadest, stating none approves everything", () => {
    const { c } = sum(settings({ permissions: { allow: ["Bash(npm test)", "Read(./src/**)", "Bash(npm run *)"] } }));
    expect(c.ALLOW.count).toBe(3);
    expect(c.ALLOW.broadest).toBe("Bash(npm run *)");
    expect(c.ALLOW.text).toBe("3 allow rules. Broadest: Bash(npm run *).");
    expect(c.ALLOW.meaning).toContain("None approves every command");
  });
  it("ranks a rule that approves every command above a powerful program, and says how many there are", () => {
    const { c } = sum(settings({ permissions: { allow: ["Bash(curl *)", "Bash(npm test)", "Bash(*)"] } }));
    expect(c.ALLOW.broadest).toBe("Bash(*)");
    expect(c.ALLOW.meaning).toContain("2 rules approve every command");
    expect(c.ALLOW.findings).toEqual({ high: 1, medium: 1, info: 0 });
  });
  it("counts extra folders and says when there are no rules", () => {
    const { c } = sum(settings({ permissions: { additionalDirectories: ["../other"] } }));
    expect(c.ALLOW.count).toBe(0);
    expect(c.ALLOW.text).toBe("No allow rules. Extra folders it can work in: 1.");
  });
});

describe("summary: DENY", () => {
  it("counts deny rules and how many secrets files are blocked", () => {
    const { c } = sum({ ...settings({ permissions: { deny: ["Read(./.env)", "Bash(rm *)"] } }), "./.env": "A=1", "./keys/id_rsa": "x" });
    expect(c.DENY.checked).toBe(true);
    expect(c.DENY.count).toBe(2);
    expect(c.DENY.text).toBe("2 deny rules. 1 of 2 secrets files in the top two folder levels of this project isn't covered by a deny rule.");
  });
  it("says when every secrets file is blocked", () => {
    const { c } = sum({ ...settings({ permissions: { deny: ["Read(./.env)"] } }), "./.env": "A=1" });
    expect(c.DENY.text).toBe("1 deny rule. The 1 secrets file in the top two folder levels of this project is covered by a deny rule.");
  });
  it("says when there are no secrets files", () => {
    const { c } = sum(settings({}));
    expect(c.DENY.text).toBe("0 deny rules. No .env, key or credentials files in the top two folder levels of this project.");
  });
  it("is not checked in a project with no Claude Code files", () => {
    const { c } = sum({ "~/.claude/settings.json": { permissions: { deny: ["Read(**/.env)"] } }, "./.env": "A=1" });
    expect(c.DENY.checked).toBe(false);
    expect(c.DENY.count).toBe(1);
    expect(c.DENY.text).toContain("this project has no Claude Code files");
  });
});

describe("summary: ENDPOINT", () => {
  it("counts project settings files and names settings without their values", () => {
    const { c } = sum(settings({ env: { ANTHROPIC_BASE_URL: "https://relay.example.com", ANTHROPIC_AUTH_TOKEN: "placeholder-value-for-test" } }));
    expect(c.ENDPOINT.count).toBe(1);
    expect(c.ENDPOINT.text).toBe("1 project settings file. 2 settings change where your requests go or which credentials they use.");
    expect(c.ENDPOINT.items).toEqual(["ANTHROPIC_BASE_URL (./.claude/settings.json)", "ANTHROPIC_AUTH_TOKEN (./.claude/settings.json)"]);
    expect(JSON.stringify(c.ENDPOINT)).not.toContain("placeholder-value-for-test");
  });
  it("states the fact when nothing changes", () => {
    const { c } = sum(settings({ env: { DEBUG: "1" } }));
    expect(c.ENDPOINT.text).toBe("1 project settings file. None changes where your requests go or which credentials they use.");
  });
  it("ignores user settings", () => {
    const { c } = sum({ "~/.claude/settings.json": { env: { ANTHROPIC_BASE_URL: "https://relay.example.com" } } });
    expect(c.ENDPOINT.count).toBe(0);
    expect(c.ENDPOINT.text).toBe("No project settings files to check.");
  });
});

describe("summary: HOOK and HTTPHOOK", () => {
  const hook = (command: string): unknown => ({ PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command }] }] });
  it("counts commands by kind and shared origin, listing only the program name", () => {
    const { c } = sum({
      "~/.claude/settings.json": { hooks: hook("npm run lint"), statusLine: { type: "command", command: "~/bin/status.sh" } },
      ...settings({ hooks: hook('curl -H "Authorization: Bearer placeholder" https://example.com/ping') }),
    });
    expect(c.HOOK.count).toBe(3);
    expect(c.HOOK.text).toBe("3 commands that run by themselves: 2 hooks, 1 status line. 1 comes from a repository or plugin.");
    expect(c.HOOK.meaning).toContain("None downloads and runs code");
    expect(c.HOOK.items).toContain("hook in ./.claude/settings.json: curl");
    expect(JSON.stringify(c.HOOK)).not.toContain("Bearer");
  });
  it("uses the singular for one command", () => {
    const { c } = sum(settings({ hooks: hook("npm run lint") }));
    expect(c.HOOK.text).toBe("1 command that runs by itself: 1 hook. 1 comes from a repository or plugin.");
  });
  it("lists HTTP hook hosts, never the full URL", () => {
    const { c } = sum({ "~/.claude/settings.json": { hooks: { Stop: [{ hooks: [{ type: "http", url: "https://hooks.example.com/in?token=abc123" }] }] } } });
    expect(c.HTTPHOOK.count).toBe(1);
    expect(c.HTTPHOOK.text).toBe("1 HTTP hook. Hosts off this machine: hooks.example.com.");
    expect(JSON.stringify(c.HTTPHOOK)).not.toContain("abc123");
    expect(c.HOOK.count).toBe(0);
  });
  it("says when there are none", () => {
    const { c } = sum(settings({}));
    expect(c.HOOK.text).toBe("No hooks, status line or helper commands.");
    expect(c.HTTPHOOK.text).toBe("No HTTP hooks.");
  });
});

describe("summary: MCP and DRIFT", () => {
  const servers = { a: { command: "npx", args: ["a@1.0.0"] }, b: { command: "npx", args: ["-y", "b"] }, c: { url: "https://mcp.example.com/mcp" } };
  it("counts servers by tool and place, and how many packages are pinned", () => {
    const { c } = sum({ "./.mcp.json": { mcpServers: servers } });
    expect(c.MCP.count).toBe(3);
    expect(c.MCP.text).toBe("3 MCP servers (Claude Code 3): 2 started on this machine, 1 remote. 1 of 2 downloaded packages isn't pinned to an exact version.");
    expect(c.MCP.items).toContain('"c" (Claude Code, ./.mcp.json): remote, mcp.example.com');
  });
  it("states when every downloaded package is pinned", () => {
    const { c } = sum({ "./.mcp.json": { mcpServers: { a: servers.a, d: { command: "uvx", args: ["d==2.0.1"] } } } });
    expect(c.MCP.text).toContain("All 2 downloaded packages are pinned to an exact version.");
  });
  it("names the baseline command when there is no baseline", () => {
    const { c } = sum({ "./.mcp.json": { mcpServers: servers } });
    expect(c.DRIFT.checked).toBe(false);
    expect(c.DRIFT.fix).toBe("npx whatsallowed baseline");
  });
  it("counts changed, new and removed servers against a baseline", () => {
    const before = { "./.mcp.json": { mcpServers: { a: servers.a, b: servers.b, gone: { command: "node", args: ["x.js"] } } } };
    const after = { "./.mcp.json": { mcpServers: { a: { command: "npx", args: ["a@1.0.1"] }, b: servers.b, c: servers.c } } };
    const { c } = sum(after, before);
    expect(c.DRIFT.checked).toBe(true);
    expect(c.DRIFT.count).toBe(3);
    expect(c.DRIFT.text).toBe("Baseline of 2026-01-01, 3 servers: 1 changed, 1 new, 1 removed since then.");
  });
  it("has nothing to compare with no servers", () => {
    const { c } = sum(settings({}));
    expect(c.MCP.text).toBe("No MCP servers.");
    expect(c.DRIFT.checked).toBe(true);
    expect(c.DRIFT.text).toBe("No MCP servers, so there is nothing to compare.");
  });
});

describe("summary: SECRET and SKILL", () => {
  it("counts instruction files and settings and MCP values looked at", () => {
    const { c } = sum({
      ...settings({ env: { DEBUG: "1" } }),
      "./CLAUDE.md": "# notes",
      "./AGENTS.md": "# agents",
      "./.mcp.json": { mcpServers: { a: { command: "node", args: ["a.js"], env: { MODE: "dev" } } } },
    });
    expect(c.SECRET.count).toBe(4);
    expect(c.SECRET.text).toBe("Looked for keys and tokens in 2 instruction files and 2 settings and MCP values.");
    expect(c.SECRET.meaning).toBe("None holds a key or token in plain text that this check recognises.");
  });
  it("counts skill scripts, leaving out minified files", () => {
    const { c } = sum({ "~/.claude/skills/x/run.sh": "#!/bin/sh\necho hi\n", "~/.claude/skills/x/lib.min.js": "x" });
    expect(c.SKILL.count).toBe(1);
    expect(c.SKILL.text).toBe("1 skill, plugin or hooks-folder script.");
    expect(c.SKILL.meaning).toContain("None downloads and runs code");
  });
});

describe("summary text", () => {
  const text = (files: Record<string, unknown>, verbose = false): string => formatText(scanFiles(files), { color: false, verbose });
  it("clean run: verdict, then the summary, and the safety disclaimer once", () => {
    const out = text(settings({ permissions: { allow: ["Bash(npm test)"] } }));
    expect(out).toContain("No high or medium findings in the 1 file checked.");
    expect(out).toContain("Summary: this project folder and your user settings. Other projects on this machine aren't read.");
    expect(out).toContain("  Files     1 read: Claude Code 1. Codex or Cursor: no files found.");
    expect(out).toContain("  ALLOW     1 allow rule. Broadest: Bash(npm test).");
    expect(out).toContain("  DRIFT     No MCP servers, so there is nothing to compare.");
    expect(out.split("not a security assessment").length - 1).toBe(1);
    expect(out).not.toMatch(/\b(?:fine|safe to|looks good)\b|✓|✔/i);
  });
  it("findings run: findings come first, then the summary", () => {
    const out = text({ ...settings({ permissions: { allow: ["Bash(*)"] } }), "./.mcp.json": { mcpServers: { a: { command: "npx", args: ["a"] } } } });
    expect(out.indexOf("Look at these first")).toBeGreaterThan(-1);
    expect(out.indexOf("Look at these first")).toBeLessThan(out.indexOf("Summary:"));
    expect(out).toContain("  ALLOW     1 allow rule. Broadest: Bash(*).");
    expect(out).toContain("  DRIFT     Not checked yet: no baseline recorded. Run: npx whatsallowed baseline");
    expect(out).not.toContain("No baseline recorded, so MCP drift");
  });
  it("lists every item only with --verbose", () => {
    const files = settings({ permissions: { allow: ["Bash(npm test)", "Bash(git diff *)"] } });
    expect(text(files)).not.toContain("- Bash(git diff *)");
    expect(text(files)).toContain("Add --verbose to list every rule");
    expect(text(files, true)).toContain("            - Bash(git diff *) (./.claude/settings.json)");
  });
  it("names the scope for --project-only", () => {
    const r = scanFiles(settings({}));
    expect(formatText({ ...r, mode: "project" }, { color: false })).toContain("Summary: this project folder only (--project-only).");
  });
});

describe("summary: no secret values in items, broadest or text (review findings)", () => {
  const leaks = (c: Record<CheckId, CheckSummary>, ...secrets: string[]): void => {
    const all = JSON.stringify(c);
    for (const s of secrets) expect(all).not.toContain(s);
  };
  it("skips NAME=value assignments before a hook, status line or helper program", () => {
    const { c } = sum(
      settings({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "TOKEN=HOOKSECRET1 python3 x.py" }] }] },
        statusLine: { type: "command", command: "env TOKEN=ENVPFX777 node ./sl.js" },
        apiKeyHelper: "SECRETCMD=abc999 /usr/bin/helper",
      }),
    );
    leaks(c, "HOOKSECRET1", "ENVPFX777", "abc999");
    expect(c.HOOK.items).toContain("hook in ./.claude/settings.json: python3");
    expect(c.HOOK.items).toContain("statusLine in ./.claude/settings.json: node");
  });
  it("says (shell command) when a command is only assignments", () => {
    const { c } = sum(settings({ hooks: { Stop: [{ hooks: [{ type: "command", command: "A=SECRETONLY1" }] }] } }));
    leaks(c, "SECRETONLY1");
    expect(c.HOOK.items).toEqual(["hook in ./.claude/settings.json: (shell command)"]);
  });
  it("shows only the host of an MCP package given as an address", () => {
    const { c } = sum({
      "./.mcp.json": {
        mcpServers: {
          a: { command: "uvx", args: ["--from", "git+https://ghp_FAKETOKEN0000@github.com/o/r", "tool"] },
          b: { command: "npx", args: ["-y", "https://u:NPXPASS99@h.example/p.tgz"] },
        },
      },
    });
    leaks(c, "ghp_FAKETOKEN0000", "NPXPASS99");
    expect(c.MCP.items.join("\n")).toContain("package at h.example");
  });
  it("masks tokens and assignments inside allow and deny rules", () => {
    const { c } = sum(
      settings({
        permissions: {
          allow: ["Bash(curl -H 'Authorization: Bearer ALLOWSECRET1' *)", "Bash(API_KEY=ALLOWSECRET2 npm test)", "Bash(tool --token=ALLOWSECRET3 run)"],
          deny: ["Bash(curl https://user:DENYSECRET1@h.example/*)"],
        },
      }),
    );
    leaks(c, "ALLOWSECRET1", "ALLOWSECRET2", "ALLOWSECRET3", "DENYSECRET1");
    expect(c.ALLOW.items).toContain("Bash(API_KEY=••• npm test) (./.claude/settings.json)");
  });
  it("masks quoted assignment values, login flags, auth headers and query tokens in rules", () => {
    const { c } = sum(
      settings({
        permissions: {
          allow: [
            "Bash(FOO='QSECRET1' cmd)",
            'Bash(API_KEY="QSECRET2 with space" npm test)',
            "Bash(curl -u admin:QSECRET3 *)",
            "Bash(curl --user admin:QSECRET4 *)",
            "Bash(curl -H 'X-Api-Key: QSECRET5' *)",
            'Bash(curl -H "Authorization: Token QSECRET6" *)',
            "Bash(curl https://h.example/p?token=QSECRET7 *)",
            "Bash(tool --token\tQSECRET8 run)",
          ],
        },
      }),
    );
    leaks(c, "QSECRET1", "QSECRET2", "with space", "QSECRET3", "QSECRET4", "QSECRET5", "QSECRET6", "QSECRET7", "QSECRET8");
    expect(c.ALLOW.items).toContain("Bash(FOO=••• cmd) (./.claude/settings.json)");
    expect(c.ALLOW.items).toContain("Bash(curl -u admin:••• *) (./.claude/settings.json)");
  });
  it("skips quoted assignments and env options before a hook program", () => {
    const { c } = sum(
      settings({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: 'TOKEN="H5SECRET spaced" node x.js' },
                { type: "command", command: "env -i TOKEN=H6SECRET python3 y.py" },
                { type: "command", command: "/usr/bin/env A='H7 x' B=H8SECRET ruby z.rb" },
              ],
            },
          ],
        },
      }),
    );
    leaks(c, "H5SECRET", "spaced", "H6SECRET", "H7", "H8SECRET");
    expect(c.HOOK.items).toEqual([
      "hook in ./.claude/settings.json: node",
      "hook in ./.claude/settings.json: env",
      "hook in ./.claude/settings.json: ruby",
    ]);
  });
  it("stays fast on long, hostile rules", async () => {
    const { scrub } = await import("../src/summary.ts");
    const inputs = ["-" + "key-".repeat(4000), "a-".repeat(100_000), "Bash(" + "x".repeat(200_000) + ")", "-u " + "a".repeat(100_000)];
    for (const s of inputs) {
      const t = performance.now();
      scrub(s);
      expect(performance.now() - t).toBeLessThan(250);
    }
  });
  it("keeps ordinary rules as they are", () => {
    const { c } = sum(settings({ permissions: { allow: ["Bash(npm run *)", "Bash(git commit --format=oneline *)", "Read(~/.ssh/**)"] } }));
    expect(c.ALLOW.items).toEqual([
      "Bash(npm run *) (./.claude/settings.json)",
      "Bash(git commit --format=oneline *) (./.claude/settings.json)",
      "Read(~/.ssh/**) (./.claude/settings.json)",
    ]);
  });
});

describe("summary: wording branches (review findings)", () => {
  it("MODE: says when it doesn't recognise a mode value", () => {
    const { c } = sum({ "~/.claude/settings.json": { permissions: { defaultMode: "foo" } } });
    expect(c.MODE.meaning).toBe("This check doesn't recognise the mode values set here, so it can't say what they do.");
  });
  it("MODE: a Codex approval policy alone still makes sense", () => {
    const { c } = sum({ "~/.codex/config.toml": 'approval_policy = "on-request"\n' });
    expect(c.MODE.meaning).toBe("Codex asks before going outside the sandbox.");
  });
  it("ENDPOINT: a repository status line alone doesn't count as redirecting requests", () => {
    const { c } = sum(settings({ statusLine: { type: "command", command: "node ./sl.js" } }));
    expect(c.ENDPOINT.text).toBe("1 project settings file. None changes where your requests go or which credentials they use.");
    expect(c.ENDPOINT.meaning).toBe("Your prompts and code go where your own settings send them.");
  });
  it("Files: lists the tools with no files as a list", () => {
    const out = formatText(scanFiles({ "./AGENTS.md": "# agents" }), { color: false });
    expect(out).toContain("Claude Code, Codex or Cursor: no files found.");
  });
});

describe("summary: JSON carries the same data as the text", () => {
  it("formatJson's summary equals summarize()", async () => {
    const { formatJson } = await import("../src/output.ts");
    const r = scanFiles({ ...settings({ permissions: { allow: ["Bash(*)"] } }), "./.mcp.json": { mcpServers: { a: { command: "npx", args: ["a"] } } } });
    expect(JSON.parse(formatJson(r)).summary).toEqual(JSON.parse(JSON.stringify(summarize(r))));
  });
});
