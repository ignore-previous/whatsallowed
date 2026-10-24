// Checks that the settings we read have the shape the checks expect. A value of the wrong type (text where a
// list belongs, a list where an object belongs) would otherwise be skipped without a word, so the file would
// look clean when part of it was never looked at.
import { get, isObj, type PathSeg } from "./parse.ts";
const HELPER_KEYS_LIST = ["apiKeyHelper", "awsCredentialExport", "awsAuthRefresh", "otelHeadersHelper"];
import type { FileKind } from "./types.ts";

type Want = "object" | "list" | "text list" | "text" | "flag" | "text or list";

const MAX_SHOWN = 3;

const kindOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "string" ? "text" : typeof v === "number" ? "a number" : typeof v === "boolean" ? "true or false" : "an object";

const WORD: Record<Want, string> = {
  object: "an object",
  list: "a list",
  "text list": "a list",
  text: "text",
  flag: "true or false",
  "text or list": "text or a list",
};

function fits(v: unknown, want: Want): boolean {
  switch (want) {
    case "object":
      return isObj(v);
    case "list":
    case "text list":
      return Array.isArray(v);
    case "text":
      return typeof v === "string";
    case "flag":
      return typeof v === "boolean";
    case "text or list":
      return typeof v === "string" || Array.isArray(v);
  }
}

class Problems {
  readonly list: string[] = [];
  expect(root: unknown, path: PathSeg[], want: Want): void {
    const v = get(root, ...path);
    if (v === undefined) return;
    const name = path.join(".");
    if (!fits(v, want)) this.list.push(`"${name}" is ${kindOf(v)}, not ${WORD[want]}`);
    else if (want === "text list" && (v as unknown[]).some((x) => typeof x !== "string")) this.list.push(`"${name}" has an entry that isn't text`);
  }
}

function servers(p: Problems, root: unknown, path: PathSeg[]): void {
  p.expect(root, path, "object");
  const map = get(root, ...path);
  if (!isObj(map)) return;
  for (const [name, def] of Object.entries(map)) {
    const at = [...path, name];
    p.expect(root, at, "object");
    if (!isObj(def)) continue;
    p.expect(root, [...at, "command"], "text or list");
    p.expect(root, [...at, "args"], "list");
    p.expect(root, [...at, "env"], "object");
    p.expect(root, [...at, "headers"], "object");
    p.expect(root, [...at, "http_headers"], "object");
    for (const key of ["url", "serverUrl", "httpUrl"]) p.expect(root, [...at, key], "text");
  }
}

/** What is wrong with the shape of a parsed settings file, one short sentence per problem. */
export function shapeProblems(kind: FileKind, root: unknown): string[] {
  const p = new Problems();
  if (kind === "claude-settings") {
    p.expect(root, ["permissions"], "object");
    for (const k of ["allow", "deny", "ask"]) p.expect(root, ["permissions", k], "text list");
    p.expect(root, ["permissions", "additionalDirectories"], "text list");
    p.expect(root, ["permissions", "defaultMode"], "text");
    p.expect(root, ["defaultMode"], "text");
    p.expect(root, ["hooks"], "object");
    p.expect(root, ["env"], "object");
    p.expect(root, ["statusLine"], "object");
    p.expect(root, ["allowedHttpHookUrls"], "text list");
    p.expect(root, ["enabledMcpjsonServers"], "text list");
    for (const k of ["enableAllProjectMcpServers", "skipDangerousModePermissionPrompt"]) p.expect(root, [k], "flag");
    for (const k of HELPER_KEYS_LIST) p.expect(root, [k], "text");
  } else if (kind === "claude-json") {
    servers(p, root, ["mcpServers"]);
    p.expect(root, ["projects"], "object");
    const projects = get(root, "projects");
    if (isObj(projects)) {
      for (const name of Object.keys(projects)) {
        p.expect(root, ["projects", name], "object");
        if (isObj(projects[name])) servers(p, root, ["projects", name, "mcpServers"]);
      }
    }
  } else if (kind === "mcp-json" || kind === "cursor-mcp" || kind === "plugin-manifest") {
    // A bare .mcp.json may be the server map itself, so a missing "mcpServers" key is fine.
    servers(p, root, ["mcpServers"]);
  } else if (kind === "codex-config") {
    servers(p, root, ["mcp_servers"]);
    p.expect(root, ["sandbox_mode"], "text");
    p.expect(root, ["approval_policy"], "text");
    p.expect(root, ["notify"], "text or list");
    p.expect(root, ["profiles"], "object");
    p.expect(root, ["projects"], "object");
    p.expect(root, ["hooks"], "object");
  } else if (kind === "codex-hooks" || kind === "plugin-hooks") {
    p.expect(root, ["hooks"], "object");
  }
  if (p.list.length > MAX_SHOWN) return [...p.list.slice(0, MAX_SHOWN), `and ${p.list.length - MAX_SHOWN} more`];
  return p.list;
}
