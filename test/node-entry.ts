// Which CLI entry points this Node can run, and the flags each needs.
// Node 20 can't run TypeScript source, so there only the built bundle (what npm users get) is tested.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const canStripTypes = process.allowedNodeEnvironmentFlags.has("--experimental-strip-types");

export function cliEntries(repo: string): string[] {
  const src = join(repo, "src/cli.ts");
  const dist = join(repo, "dist/cli.mjs");
  return [...(canStripTypes ? [src] : []), dist].filter((p) => existsSync(p));
}

export const nodeFlags = (entry: string): string[] =>
  entry.endsWith(".ts") ? ["--experimental-strip-types", "--no-warnings"] : ["--no-warnings"];
