import { findNodeAtLocation, type Node, type ParseError, parseTree, getNodeValue } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

export type PathSeg = string | number;

export interface Doc {
  ok: boolean;
  value: unknown;
  error?: string;
  /** 1-based line of the value at a path, or of its nearest existing parent. */
  lineOf(path: PathSeg[]): number;
}

export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Real config files nest a handful of levels. Anything deeper is refused, because the parser recurses and would overflow the stack. */
export const MAX_NESTING = 128;

export const TOO_DEEP = "nested too deeply to read";

/** A document that could not be read at all. */
export const unreadable = (error: string): Doc => ({ ok: false, value: undefined, error, lineOf: () => 1 });

/** How deeply brackets nest in JSON text. Counts without recursing, ignores strings and comments, and stops once past the limit. */
export function nestingDepth(text: string, limit = MAX_NESTING): number {
  let depth = 0;
  let deepest = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 34) {
      // A string: skip to its closing quote.
      for (i++; i < text.length && text.charCodeAt(i) !== 34; i++) if (text.charCodeAt(i) === 92) i++;
    } else if (ch === 47 && text.charCodeAt(i + 1) === 47) {
      while (i < text.length && text.charCodeAt(i) !== 10) i++;
    } else if (ch === 47 && text.charCodeAt(i + 1) === 42) {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (ch === 123 || ch === 91) {
      if (++depth > deepest && (deepest = depth) > limit) return deepest;
    } else if ((ch === 125 || ch === 93) && depth > 0) depth--;
  }
  return deepest;
}

export function parseJson(raw: string): Doc {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (nestingDepth(text) > MAX_NESTING) return unreadable(TOO_DEEP);
  const errors: ParseError[] = [];
  let root: Node | undefined;
  let value: unknown;
  try {
    root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (root) value = getNodeValue(root);
  } catch (e) {
    return unreadable(e instanceof RangeError ? TOO_DEEP : "not valid JSON");
  }
  if (!root) return unreadable("not valid JSON");
  const first = errors[0];
  return {
    ok: errors.length === 0,
    value,
    error: first ? `JSON has syntax errors near line ${lineAt(text, first.offset)}` : undefined,
    lineOf(path) {
      for (let n = path.length; n >= 0; n--) {
        const node: Node | undefined = findNodeAtLocation(root, path.slice(0, n));
        if (node) {
          const at = node.parent?.type === "property" ? node.parent.offset : node.offset;
          return lineAt(text, at);
        }
      }
      return 1;
    },
  };
}

/** Split a TOML key or table header into segments: a."b.c".d -> [a, b.c, d]. */
export function tomlKeySegments(key: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | undefined;
  for (const ch of key.trim()) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ".") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((s) => s.length > 0);
}

const startsWith = (full: string[], prefix: string[]): boolean =>
  prefix.length <= full.length && prefix.every((s, i) => full[i] === s);

/** Find the line of a key path in TOML text by tracking table headers and dotted keys. */
export function tomlLine(text: string, path: PathSeg[]): number {
  const target = path.filter((p): p is string => typeof p === "string");
  const lines = text.split(/\r?\n/);
  let table: string[] = [];
  let best = 1;
  let bestLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? "").trim();
    if (!raw || raw.startsWith("#")) continue;
    let full: string[] | undefined;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(raw);
    if (header?.[1]) {
      table = tomlKeySegments(header[1]);
      full = table;
    } else {
      const kv = /^((?:"[^"]*"|'[^']*'|[A-Za-z0-9_.\- ])+?)\s*=/.exec(raw);
      if (kv?.[1]) full = [...table, ...tomlKeySegments(kv[1])];
    }
    if (!full) continue;
    if (startsWith(full, target) && full.length === target.length) return i + 1;
    // Longest prefix of the target that this line defines (covers inline tables).
    let n = 0;
    while (n < full.length && n < target.length && full[n] === target[n]) n++;
    if (n === full.length && n > bestLen) {
      best = i + 1;
      bestLen = n;
    } else if (n === target.length && n > bestLen) {
      best = i + 1;
      bestLen = n;
    }
  }
  return best;
}

export function parseTomlDoc(text: string): Doc {
  try {
    const value = parseToml(text);
    return { ok: true, value, lineOf: (p) => tomlLine(text, p) };
  } catch (e) {
    const deep = e instanceof RangeError || /nested/i.test(e instanceof Error ? e.message : "");
    return { ok: false, value: undefined, error: deep ? TOO_DEEP : "TOML has syntax errors", lineOf: (p) => tomlLine(text, p) };
  }
}

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const get = (v: unknown, ...path: PathSeg[]): unknown => {
  let cur: unknown = v;
  for (const p of path) {
    if (Array.isArray(cur) && typeof p === "number") cur = cur[p];
    else if (isObj(cur) && typeof p === "string") cur = cur[p];
    else return undefined;
  }
  return cur;
};

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
