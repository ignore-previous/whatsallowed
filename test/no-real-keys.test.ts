import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS helper without types
import { findRealFormatKeys, SPLIT as TOOLS_SPLIT } from "../eval/tools/keys.mjs";
import { SPLIT as RUN_SPLIT } from "../eval/run.ts";

describe("no real-format key strings in the repo", () => {
  it("eval/run.ts and eval/tools/keys.mjs use the same split marker", () => {
    expect(RUN_SPLIT).toBe(TOOLS_SPLIT);
  });

  it("no tracked or untracked-but-not-ignored file holds a string in a real provider key format", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !/\.(?:png|jpg|gif|ico|woff2?)$/i.test(f));
    const found: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(f, "utf8");
      } catch {
        continue; // listed by git but deleted in the working tree
      }
      for (const hit of findRealFormatKeys(text) as string[]) found.push(`${f}: ${hit}`);
    }
    expect(found).toEqual([]);
  });
});
