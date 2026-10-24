import * as fs from "node:fs";
import * as nodePath from "node:path";

export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** The file-system calls the scanner needs. Read-only. */
export interface Fs {
  readText(path: string): string | undefined;
  list(dir: string): DirEntry[] | undefined;
}

const MAX_BYTES = 1024 * 1024;

export const toPosix = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "") || "/";

export const join = (...parts: string[]): string =>
  toPosix(parts.join("/").replace(/\/+/g, "/"));

export const nodeFs: Fs = {
  readText(path) {
    try {
      const st = fs.statSync(path);
      if (!st.isFile() || st.size > MAX_BYTES) return undefined;
      return fs.readFileSync(path, "utf8");
    } catch {
      return undefined;
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
export function memFs(files: Record<string, string>): Fs {
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) norm[toPosix(k)] = v;
  return {
    readText: (p) => norm[toPosix(p)],
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
