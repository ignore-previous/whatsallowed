import { createHash } from "node:crypto";
import type { McpServer, Model } from "../model.ts";
import { isObj } from "../parse.ts";
import type { Baseline, Finding } from "../types.ts";
import { make } from "./util.ts";

/** The parts of a server definition that decide what runs and where it connects. */
const FIELDS = ["command", "args", "url", "serverUrl", "httpUrl", "env"] as const;

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}

export function serverFingerprint(s: McpServer): string {
  const picked: Record<string, unknown> = {};
  for (const k of FIELDS) if (s.def[k] !== undefined) picked[k] = s.def[k];
  return createHash("sha256").update(JSON.stringify(canonical(picked))).digest("hex");
}

/** Build a baseline record from a model. */
export function recordBaseline(m: Model, created: string): Baseline {
  const files = m.parsed
    .filter((p) => ["mcp-json", "claude-json", "codex-config", "cursor-mcp", "plugin-manifest"].includes(p.file.kind))
    .map((p) => p.file.path);
  const servers: Record<string, string> = {};
  for (const s of m.servers) servers[s.key] = serverFingerprint(s);
  return { version: 1, created, files: [...new Set(files)].sort(), servers };
}

export function checkDrift(m: Model): Finding[] {
  const b = m.ctx.baseline;
  if (!b) {
    if (m.servers.length) m.ctx.notes.push("No baseline recorded, so MCP drift wasn't checked. Run the baseline command once to start tracking changes.");
    return [];
  }
  const recorded = new Set(b.files);
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const s of m.servers) {
    if (!recorded.has(s.file.path)) continue;
    seen.add(s.key);
    const before = b.servers[s.key];
    const line = s.doc.lineOf(s.base);
    if (before === undefined) {
      out.push(
        make("DRIFT", {
          rule: "DRIFT-002",
          severity: "info",
          title: `MCP server "${s.name}" is new since the baseline`,
          file: s.file,
          line,
          match: s.name,
          why: "It wasn't there when you recorded the baseline. The MCP check still reviews it.",
          fix: "If you added it, re-record the baseline with --reset-baseline.",
        }),
      );
    } else if (before !== serverFingerprint(s)) {
      out.push(
        make("DRIFT", {
          rule: "DRIFT-001",
          severity: "medium",
          title: `MCP server "${s.name}" changed since the baseline`,
          file: s.file,
          line,
          match: s.name,
          why: "Its command, arguments, URL or environment differ from what you recorded, so it may now run different code or connect somewhere else.",
          fix: "Check the change (git log or diff the file). If you made it, re-record the baseline with --reset-baseline.",
        }),
      );
    }
  }
  const scanned = new Set(m.parsed.map((p) => p.file.path));
  for (const key of Object.keys(b.servers)) {
    const file = key.slice(0, key.lastIndexOf("#"));
    if (seen.has(key) || !scanned.has(file)) continue;
    m.ctx.notes.push(`MCP server ${key.slice(key.lastIndexOf("#") + 1)} in ${file} was removed since the baseline.`);
  }
  return out;
}
