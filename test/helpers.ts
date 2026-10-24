import { recordBaseline } from "../src/checks/drift.ts";
import { memFs } from "../src/fsys.ts";
import { scan, type ScanResult } from "../src/scan.ts";
import { HOME, PROJECT, toFsMap } from "../eval/run.ts";

export { HOME, PROJECT };

/** Scan in-memory files. Keys start with ~/ (home) or ./ (project). */
export function scanFiles(files: Record<string, unknown>, before?: Record<string, unknown>): ScanResult {
  const base = { home: HOME, project: PROJECT, mode: "all" as const, managedDirs: [] };
  const baseline = before ? recordBaseline(scan({ ...base, fs: memFs(toFsMap(before)) }).model, "2026-01-01T00:00:00.000Z") : undefined;
  return scan({ ...base, fs: memFs(toFsMap(files)), baseline });
}

/** 1-based line of the first line containing needle. */
export function lineOf(text: string, needle: string): number {
  const i = text.split("\n").findIndex((l) => l.includes(needle));
  if (i === -1) throw new Error(`fixture has no line containing ${needle}`);
  return i + 1;
}
