import { describe, expect, it } from "vitest";
import { memFs } from "../src/fsys.ts";
import { gitIgnoresFile, isIgnored, parseIgnore } from "../src/gitignore.ts";
import { scanFiles } from "./helpers.ts";

const REL = ".claude/settings.local.json";

describe("gitignore matching", () => {
  it.each([
    [".claude/settings.local.json", true],
    ["/.claude/settings.local.json", true],
    [".claude/", true],
    [".claude", true],
    ["settings.local.json", true],
    ["*.local.json", true],
    [".claude/*", true],
    ["**/settings.local.json", true],
    ["# .claude/settings.local.json", false],
    ["node_modules/", false],
    [".claude/settings.json", false],
    ["/settings.local.json", false],
  ])("%s -> %s", (pattern, want) => {
    expect(isIgnored(parseIgnore(pattern), REL)).toBe(want);
  });
  it("a later ! pattern re-includes the file", () => {
    expect(isIgnored(parseIgnore("*.local.json\n!.claude/settings.local.json"), REL)).toBe(false);
  });
  it("a ! pattern can't re-include a file inside an ignored folder", () => {
    expect(isIgnored(parseIgnore(".claude/\n!.claude/settings.local.json"), REL)).toBe(true);
  });
  it("reads .claude/.gitignore, info/exclude and the global excludes file", () => {
    const P = "/h/p";
    expect(gitIgnoresFile(memFs({ "/h/p/.claude/.gitignore": "settings.local.json\n" }), "/h", P, REL)).toBe(true);
    expect(gitIgnoresFile(memFs({ "/h/p/.git/info/exclude": ".claude/settings.local.json\n" }), "/h", P, REL)).toBe(true);
    expect(gitIgnoresFile(memFs({ "/h/.config/git/ignore": "**/.claude/settings.local.json\n" }), "/h", P, REL)).toBe(true);
    expect(gitIgnoresFile(memFs({ "/h/.gitconfig": "[core]\n\texcludesfile = ~/.gitignore_global\n", "/h/.gitignore_global": "settings.local.json\n" }), "/h", P, REL)).toBe(true);
    expect(gitIgnoresFile(memFs({ "/h/p/.gitignore": "dist/\n" }), "/h", P, REL)).toBe(false);
  });
  it("a file already in the git index counts as tracked", () => {
    const fs = memFs({ "/h/p/.gitignore": ".claude/\n", "/h/p/.git/index": `DIRC\u0000\u0000${REL}\u0000` });
    expect(gitIgnoresFile(fs, "/h", "/h/p", REL)).toBe(false);
  });
});

describe("ENDPOINT loopback in a git-ignored local file", () => {
  const local = { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } };
  const sev = (files: Record<string, unknown>): string | undefined => scanFiles(files).findings.find((f) => f.rule === "ENDPOINT-001")?.severity;
  it("is info when git ignores the file", () => {
    expect(sev({ "./.claude/settings.local.json": local, "./.gitignore": ".claude/settings.local.json\n" })).toBe("info");
  });
  it("stays medium when the file isn't ignored", () => {
    expect(sev({ "./.claude/settings.local.json": local })).toBe("medium");
  });
  it("stays medium for a remote address in an ignored local file", () => {
    expect(sev({ "./.claude/settings.local.json": { env: { ANTHROPIC_BASE_URL: "https://gw.example.org" } }, "./.gitignore": ".claude/\n" })).toBe("medium");
  });
  it("stays medium for loopback in the repository's own settings", () => {
    expect(sev({ "./.claude/settings.json": local, "./.gitignore": ".claude/settings.local.json\n" })).toBe("medium");
  });
});
