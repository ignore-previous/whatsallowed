import { toPosix } from "./fsys.ts";
import { type Doc, get, isObj, parseJson, parseTomlDoc, type PathSeg, str, strArr } from "./parse.ts";
import type { ConfigFile, ScanContext, Scope, Tool } from "./types.ts";

/** A parsed config file. */
export interface Parsed {
  file: ConfigFile;
  doc: Doc;
}

export interface McpServer {
  file: ConfigFile;
  doc: Doc;
  tool: Tool;
  scope: Scope;
  name: string;
  /** Stable identity for the baseline: "<absolute path>#<name>" or "<absolute path>#local:<name>". */
  key: string;
  def: Record<string, unknown>;
  /** Path of the server object inside the file. */
  base: PathSeg[];
}

export interface HookHandler {
  file: ConfigFile;
  doc: Doc;
  scope: Scope;
  type: "command" | "http";
  /** Command with any exec-form args joined in. */
  command?: string;
  url?: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
  path: PathSeg[];
  /** Where it came from, for the message: "hook", "statusLine", "apiKeyHelper", "notify". */
  origin: string;
}

export interface Model {
  ctx: ScanContext;
  parsed: Parsed[];
  settings: Parsed[];
  codex: Parsed[];
  servers: McpServer[];
  handlers: HookHandler[];
}

export const HELPER_KEYS = ["apiKeyHelper", "awsCredentialExport", "awsAuthRefresh", "otelHeadersHelper"] as const;

const JSON_KINDS = new Set(["claude-settings", "claude-json", "mcp-json", "codex-hooks", "cursor-mcp", "plugin-hooks", "plugin-manifest"]);

function serversFrom(p: Parsed, map: unknown, base: PathSeg[], scope: Scope, keyPrefix = ""): McpServer[] {
  if (!isObj(map)) return [];
  const out: McpServer[] = [];
  for (const [name, def] of Object.entries(map)) {
    if (!isObj(def)) continue;
    out.push({
      file: p.file,
      doc: p.doc,
      tool: p.file.tool,
      scope,
      name,
      key: `${p.file.path}#${keyPrefix}${name}`,
      def,
      base: [...base, name],
    });
  }
  return out;
}

const looksLikeServerMap = (v: unknown): boolean =>
  isObj(v) && Object.values(v).length > 0 && Object.values(v).every((d) => isObj(d) && ("command" in d || "url" in d));

function collectServers(p: Parsed, project: string): McpServer[] {
  const v = p.doc.value;
  const { kind, scope } = p.file;
  if (kind === "codex-config") return serversFrom(p, get(v, "mcp_servers"), ["mcp_servers"], scope);
  if (kind === "claude-json") {
    const out = serversFrom(p, get(v, "mcpServers"), ["mcpServers"], "user");
    const projects = get(v, "projects");
    if (isObj(projects)) {
      const want = toPosix(project).toLowerCase();
      for (const [path, entry] of Object.entries(projects)) {
        if (toPosix(path).toLowerCase() !== want) continue;
        out.push(...serversFrom(p, get(entry, "mcpServers"), ["projects", path, "mcpServers"], "local", "local:"));
      }
    }
    return out;
  }
  if (kind === "mcp-json" || kind === "cursor-mcp" || kind === "plugin-manifest") {
    const m = get(v, "mcpServers");
    if (isObj(m)) return serversFrom(p, m, ["mcpServers"], scope);
    if (kind === "mcp-json" && looksLikeServerMap(v)) return serversFrom(p, v, [], scope);
  }
  return [];
}

/** Walk a hooks value and pull out every command and http handler, whatever the nesting. */
function walkHooks(p: Parsed, v: unknown, path: PathSeg[], out: HookHandler[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(v)) {
    v.forEach((x, i) => walkHooks(p, x, [...path, i], out, depth + 1));
    return;
  }
  if (!isObj(v)) return;
  const type = str(v.type);
  const url = str(v.url);
  if (type === "http" && url) {
    out.push({
      file: p.file,
      doc: p.doc,
      scope: p.file.scope,
      type: "http",
      url,
      headers: stringMap(v.headers),
      allowedEnvVars: strArr(v.allowedEnvVars),
      path: [...path, "url"],
      origin: "hook",
    });
    return;
  }
  const cmd = commandOf(v);
  if (cmd && (type === undefined || type === "command")) {
    out.push({ file: p.file, doc: p.doc, scope: p.file.scope, type: "command", command: cmd, headers: {}, allowedEnvVars: [], path: [...path, "command"], origin: "hook" });
    return;
  }
  for (const [k, x] of Object.entries(v)) walkHooks(p, x, [...path, k], out, depth + 1);
}

function commandOf(v: Record<string, unknown>): string | undefined {
  const c = v.command;
  const args = strArr(v.args);
  if (typeof c === "string") return [c, ...args].join(" ");
  if (Array.isArray(c)) return strArr(c).join(" ");
  return undefined;
}

export function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
}

function collectHandlers(p: Parsed): HookHandler[] {
  const out: HookHandler[] = [];
  const v = p.doc.value;
  const { kind } = p.file;
  if (kind === "claude-settings" || kind === "plugin-manifest" || kind === "codex-config") {
    walkHooks(p, get(v, "hooks"), ["hooks"], out);
  } else if (kind === "plugin-hooks" || kind === "codex-hooks") {
    const h = get(v, "hooks");
    walkHooks(p, h ?? v, h ? ["hooks"] : [], out);
  }
  const base = { file: p.file, doc: p.doc, scope: p.file.scope, type: "command" as const, headers: {}, allowedEnvVars: [] };
  if (kind === "claude-settings") {
    for (const key of HELPER_KEYS) {
      const c = str(get(v, key));
      if (c) out.push({ ...base, command: c, path: [key], origin: key });
    }
    const sl = get(v, "statusLine");
    const slc = isObj(sl) ? commandOf(sl) : undefined;
    if (slc) out.push({ ...base, command: slc, path: ["statusLine", "command"], origin: "statusLine" });
  }
  if (kind === "codex-config") {
    const n = get(v, "notify");
    const parts = Array.isArray(n) ? strArr(n) : typeof n === "string" ? [n] : [];
    if (parts.length) out.push({ ...base, command: parts.join(" "), path: ["notify"], origin: "notify" });
  }
  return out;
}

export function buildModel(ctx: ScanContext): Model {
  const parsed: Parsed[] = [];
  for (const file of ctx.files) {
    if (file.text === undefined) continue;
    if (JSON_KINDS.has(file.kind)) parsed.push({ file, doc: parseJson(file.text) });
    else if (file.kind === "codex-config") parsed.push({ file, doc: parseTomlDoc(file.text) });
  }
  for (const p of parsed) {
    if (!p.doc.ok && p.doc.value === undefined) ctx.notes.push(`${p.file.display}: ${p.doc.error ?? "could not be parsed"}, skipped`);
  }
  const settings = parsed.filter((p) => p.file.kind === "claude-settings");
  const codex = parsed.filter((p) => p.file.kind === "codex-config");
  const servers = parsed.flatMap((p) => collectServers(p, ctx.project));
  const handlers = parsed.flatMap(collectHandlers);
  return { ctx, parsed, settings, codex, servers, handlers };
}
