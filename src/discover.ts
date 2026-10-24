import { type Fs, join, toPosix } from "./fsys.ts";
import { gitIgnoresFile } from "./gitignore.ts";
import type { ConfigFile, FileKind, Scope, Tool } from "./types.ts";

export type ScanMode = "all" | "user" | "project";

export interface DiscoverOptions {
  fs: Fs;
  home: string;
  project: string;
  mode: ScanMode;
  /** Folders that may hold managed-settings.json (system-wide policy). */
  managedDirs?: string[];
}

export const SCRIPT_EXT = /\.(sh|bash|zsh|ksh|fish|ps1|psm1|py|js|mjs|cjs|ts|rb|pl|bat|cmd)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", ".trash", ".venv", "venv", "__pycache__", "dist", "build"]);
const MAX_WALK_FILES = 5000;

export function displayPath(abs: string, home: string, project: string): string {
  const p = toPosix(abs);
  const proj = toPosix(project);
  const h = toPosix(home);
  if (p === proj) return ".";
  if (p.startsWith(proj + "/")) return "./" + p.slice(proj.length + 1);
  if (p.startsWith(h + "/")) return "~/" + p.slice(h.length + 1);
  return p;
}

/** List files under dir, depth-limited, skipping dependency and VCS folders. */
export function walk(fs: Fs, dir: string, maxDepth: number, budget = { left: MAX_WALK_FILES }): string[] {
  const out: string[] = [];
  const entries = fs.list(dir);
  if (!entries) return out;
  for (const e of entries) {
    if (budget.left <= 0) break;
    const p = join(dir, e.name);
    if (e.isDir) {
      if (SKIP_DIRS.has(e.name) || maxDepth <= 0) continue;
      out.push(...walk(fs, p, maxDepth - 1, budget));
    } else {
      budget.left--;
      out.push(p);
    }
  }
  return out;
}

const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist)$/i;

/** File names that usually hold secrets (DENY check). */
export function isSecretFileName(name: string): boolean {
  if (name === ".env") return true;
  if (/^\.env\..+/i.test(name)) return !ENV_TEMPLATE.test(name);
  if (/\.(pem|key)$/i.test(name)) return true;
  return /^(id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials\.json|\.npmrc|\.pypirc)$/i.test(name);
}

const hasShebang =(text: string | undefined): boolean => !!text && text.startsWith("#!");

export function discover(opts: DiscoverOptions): { files: ConfigFile[]; projectEntries: string[] } {
  const { fs, mode } = opts;
  const home = toPosix(opts.home);
  const project = toPosix(opts.project);
  const files: ConfigFile[] = [];
  const seen = new Set<string>();

  const add = (path: string, tool: Tool, kind: FileKind, scope: Scope): void => {
    const p = toPosix(path);
    if (seen.has(p)) return;
    const text = fs.readText(p);
    if (text === undefined) return;
    seen.add(p);
    files.push({ path: p, display: displayPath(p, home, project), tool, kind, scope, text });
  };

  const addScripts = (dir: string, tool: Tool, scope: Scope, depth = 4): void => {
    for (const p of walk(fs, dir, depth)) {
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (SCRIPT_EXT.test(name) && !name.endsWith(".d.ts")) add(p, tool, "script", scope);
      else if (!name.includes(".") && hasShebang(fs.readText(p))) add(p, tool, "script", scope);
    }
  };

  const addRules = (dir: string, tool: Tool, scope: Scope): void => {
    for (const p of walk(fs, dir, 3)) {
      if (/\.(md|mdc)$/i.test(p)) add(p, tool, "instructions", scope);
    }
  };

  if (mode !== "project") {
    for (const dir of opts.managedDirs ?? []) {
      add(join(dir, "managed-settings.json"), "claude", "claude-settings", "managed");
      add(join(dir, "managed-mcp.json"), "claude", "mcp-json", "managed");
    }
    // Claude Code
    add(join(home, ".claude/settings.json"), "claude", "claude-settings", "user");
    add(join(home, ".claude.json"), "claude", "claude-json", "user");
    add(join(home, ".claude/CLAUDE.md"), "claude", "instructions", "user");
    addRules(join(home, ".claude/rules"), "claude", "user");
    addScripts(join(home, ".claude/skills"), "claude", "user");
    addScripts(join(home, ".claude/hooks"), "claude", "user", 2);
    // Installed plugins: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/...
    const cache = join(home, ".claude/plugins/cache");
    for (const p of walk(fs, cache, 8)) {
      const rel = p.slice(cache.length + 1);
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (rel.endsWith("/hooks/hooks.json")) add(p, "claude", "plugin-hooks", "plugin");
      else if (rel.endsWith("/.claude-plugin/plugin.json")) add(p, "claude", "plugin-manifest", "plugin");
      else if (name === ".mcp.json") add(p, "claude", "mcp-json", "plugin");
      else if (SCRIPT_EXT.test(name) && !name.endsWith(".d.ts")) add(p, "claude", "script", "plugin");
    }
    // Codex
    add(join(home, ".codex/config.toml"), "codex", "codex-config", "user");
    for (const e of fs.list(join(home, ".codex")) ?? []) {
      if (!e.isDir && e.name.endsWith(".config.toml")) add(join(home, ".codex", e.name), "codex", "codex-config", "user");
    }
    add(join(home, ".codex/hooks.json"), "codex", "codex-hooks", "user");
    add(join(home, ".codex/AGENTS.md"), "codex", "instructions", "user");
    addScripts(join(home, ".codex/skills"), "codex", "user");
    addScripts(join(home, ".agents/skills"), "agents", "user");
    // Cursor and Gemini
    add(join(home, ".cursor/mcp.json"), "cursor", "cursor-mcp", "user");
    add(join(home, ".gemini/GEMINI.md"), "gemini", "instructions", "user");
  }

  const projectEntries: string[] = [];
  if (mode !== "user" && project !== home) {
    add(join(project, ".claude/settings.json"), "claude", "claude-settings", "project");
    add(join(project, ".claude/settings.local.json"), "claude", "claude-settings", "local");
    const local = files.find((f) => f.path === join(project, ".claude/settings.local.json"));
    if (local) local.gitIgnored = gitIgnoresFile(fs, home, project, ".claude/settings.local.json");
    add(join(project, ".mcp.json"), "claude", "mcp-json", "project");
    for (const n of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"]) {
      add(join(project, n), "claude", "instructions", n === "CLAUDE.local.md" ? "local" : "project");
    }
    addRules(join(project, ".claude/rules"), "claude", "project");
    addScripts(join(project, ".claude/skills"), "claude", "project");
    addScripts(join(project, ".claude/hooks"), "claude", "project", 2);
    add(join(project, "AGENTS.md"), "agents", "instructions", "project");
    add(join(project, "AGENTS.override.md"), "agents", "instructions", "project");
    add(join(project, "GEMINI.md"), "gemini", "instructions", "project");
    add(join(project, ".cursorrules"), "cursor", "instructions", "project");
    addRules(join(project, ".cursor/rules"), "cursor", "project");
    add(join(project, ".cursor/mcp.json"), "cursor", "cursor-mcp", "project");
    add(join(project, ".codex/config.toml"), "codex", "codex-config", "project");
    add(join(project, ".codex/hooks.json"), "codex", "codex-hooks", "project");
    addScripts(join(project, ".codex/skills"), "codex", "project");
    addScripts(join(project, ".agents/skills"), "agents", "project");
    for (const p of walk(fs, project, 1)) {
      projectEntries.push(p);
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (!seen.has(p) && isSecretFileName(name)) {
        seen.add(p);
        // Only .npmrc and .pypirc need their text (to see whether they hold a token).
        const text = /^\.(npmrc|pypirc)$/i.test(name) ? fs.readText(p) : undefined;
        files.push({ path: p, display: displayPath(p, home, project), tool: "agents", kind: "secret-file", scope: "project", text });
      }
    }
  }
  return { files, projectEntries };
}

/** Default places for managed settings on each OS. */
export function defaultManagedDirs(platform: string): string[] {
  if (platform === "win32") return ["C:/Program Files/ClaudeCode"];
  if (platform === "darwin") return ["/Library/Application Support/ClaudeCode"];
  return ["/etc/claude-code"];
}
