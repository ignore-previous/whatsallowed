import * as fs from "node:fs";
import * as path from "node:path";
import { isObj } from "./parse.ts";
import type { Baseline } from "./types.ts";

export function readBaseline(file: string): Baseline | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const v: unknown = JSON.parse(text);
  if (!isObj(v) || v.version !== 1 || !isObj(v.servers) || !Array.isArray(v.files)) {
    throw new Error(`${file} isn't a baseline file this version understands`);
  }
  return v as unknown as Baseline;
}

/** Write the baseline. Refuses to overwrite unless reset is set. Returns false if it refused. */
export function writeBaseline(file: string, b: Baseline, reset: boolean): boolean {
  if (fs.existsSync(file) && !reset) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(b, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return true;
}
