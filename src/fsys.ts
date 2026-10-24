import * as fs from "node:fs";
import * as nodePath from "node:path";

export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** The file-system calls the scanner needs. Read-only. */
export interface Fs {
  readText(path: string): string | undefined;
  /** The size in bytes of a file that is over the read limit, so readText skipped it. Undefined for any other file. */
  oversize(path: string): number | undefined;
  /** For a regular file within the size limit that exists but could not be opened (for example, no permission): a short error code. Undefined for any other path. */
  openError(path: string): string | undefined;
  list(dir: string): DirEntry[] | undefined;
}

/** Files bigger than this aren't read. Real config files are a few kilobytes. */
export const MAX_BYTES = 1024 * 1024;

/** Is this buffer UTF-16 without a byte order mark? ASCII-heavy text such as JSON has a zero in every other byte. */
function utf16Order(buf: Buffer): "le" | "be" | undefined {
  const pairs = Math.floor(Math.min(buf.length, 4096) / 2);
  if (pairs < 2) return undefined;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < pairs; i++) {
    if (buf[2 * i] === 0) evenZero++;
    if (buf[2 * i + 1] === 0) oddZero++;
  }
  if (oddZero >= pairs * 0.4 && evenZero <= pairs * 0.05) return "le";
  if (evenZero >= pairs * 0.4 && oddZero <= pairs * 0.05) return "be";
  return undefined;
}

/** Turn file bytes into text. Reads UTF-8 and UTF-16 (what Windows PowerShell 5 writes), with or without a byte order mark. */
export function decodeText(buf: Buffer): string {
  let order: "le" | "be" | undefined;
  let body = buf;
  if (buf[0] === 0xff && buf[1] === 0xfe) ((order = "le"), (body = buf.subarray(2)));
  else if (buf[0] === 0xfe && buf[1] === 0xff) ((order = "be"), (body = buf.subarray(2)));
  else order = utf16Order(buf);
  let text: string;
  if (order) {
    const even = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
    text = (order === "be" ? even.swap16() : even).toString("utf16le");
  } else text = body.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export const toPosix = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "") || "/";

export const join = (...parts: string[]): string =>
  toPosix(parts.join("/").replace(/\/+/g, "/"));

export const nodeFs: Fs = {
  readText(path) {
    try {
      const st = fs.statSync(path);
      if (!st.isFile() || st.size > MAX_BYTES) return undefined;
      return decodeText(fs.readFileSync(path));
    } catch {
      return undefined;
    }
  },
  oversize(path) {
    try {
      const st = fs.statSync(path);
      return st.isFile() && st.size > MAX_BYTES ? st.size : undefined;
    } catch {
      return undefined;
    }
  },
  openError(path) {
    try {
      const st = fs.statSync(path);
      if (!st.isFile() || st.size > MAX_BYTES) return undefined;
    } catch {
      return undefined;
    }
    try {
      decodeText(fs.readFileSync(path));
      return undefined;
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      return typeof code === "string" && /^[A-Z0-9_]{2,20}$/.test(code) ? code : "UNKNOWN";
    }
  },
  list(dir) {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .map((d) => ({ name: d.name, isDir: d.isDirectory() }));
    } catch {
      return undefined;
    }
  },
};

/** In-memory file system for tests and the eval harness. Keys are absolute posix paths. */
export function memFs(files: Record<string, string>, opts: { unopenable?: string[] } = {}): Fs {
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) norm[toPosix(k)] = v;
  // Files that exist but can't be opened. They have no text in `files`.
  const blocked = new Set((opts.unopenable ?? []).map(toPosix));
  return {
    readText: (p) => {
      const t = norm[toPosix(p)];
      return t !== undefined && t.length > MAX_BYTES ? undefined : t;
    },
    openError: (p) => (blocked.has(toPosix(p)) ? "EACCES" : undefined),
    oversize: (p) => {
      const t = norm[toPosix(p)];
      return t !== undefined && t.length > MAX_BYTES ? t.length : undefined;
    },
    list(dir) {
      const d = toPosix(dir);
      const prefix = d === "/" ? "/" : d + "/";
      const seen = new Map<string, boolean>();
      for (const k of Object.keys(norm)) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!name) continue;
        seen.set(name, (seen.get(name) ?? false) || slash !== -1);
      }
      if (seen.size === 0) return undefined;
      return [...seen].map(([name, isDir]) => ({ name, isDir }));
    },
  };
}

export const resolveAbs = (p: string): string => toPosix(nodePath.resolve(p));
