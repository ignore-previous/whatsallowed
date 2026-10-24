import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS helper without types
import { parseSheet } from "../eval/tools/kappa-import.mjs";
// @ts-expect-error plain JS helper without types
import { pickCases } from "../eval/tools/kappa-sheet.mjs";

// The sheet may already be filled in by the time this runs, so blank every answer first.
const sheet = readFileSync("eval/kappa/sheet.md", "utf8").replace(/^Risky for:.*$/gm, "Risky for: ");
const ids: string[] = pickCases();

describe("blind labelling sheet", () => {
  it("covers 30 distinct cases and shows no case ID or label", () => {
    expect(new Set(ids).size).toBe(30);
    for (const id of ids) expect(sheet).not.toContain(id);
    expect(sheet.match(/^### Case \d+ of 30$/gm)).toHaveLength(30);
    expect(sheet.match(/^Risky for: $/gm)).toHaveLength(30);
  });

  it("an empty sheet reports every case as unanswered and writes no labels", () => {
    const { labels, problems } = parseSheet(sheet, ids);
    expect(problems).toHaveLength(30);
    expect(Object.keys(labels)).toHaveLength(0);
  });

  it("reads a dummy fill: checks in any case and order, 'none', and extra punctuation", () => {
    const answers = ["none", "hook, mcp", "SKILL", "Mode / Allow", "`secret`.", "none"];
    let i = 0;
    const filled = sheet.replace(/^Risky for: $/gm, () => `Risky for: ${answers[i++ % answers.length]}`);
    const { labels, problems } = parseSheet(filled, ids);
    expect(problems).toEqual([]);
    expect(labels[ids[0]!]).toEqual([]);
    expect(labels[ids[1]!]).toEqual(["HOOK", "MCP"]);
    expect(labels[ids[2]!]).toEqual(["SKILL"]);
    expect(labels[ids[3]!]).toEqual(["MODE", "ALLOW"]);
    expect(labels[ids[4]!]).toEqual(["SECRET"]);
    expect(Object.keys(labels)).toHaveLength(30);
  });

  it("names a misspelt check and a blank answer by case number", () => {
    let i = 0;
    const filled = sheet.replace(/^Risky for: $/gm, () => (++i === 3 ? "Risky for: hookk" : i === 4 ? "Risky for: " : "Risky for: none"));
    const { problems } = parseSheet(filled, ids);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("Case 3");
    expect(problems[0]).toContain("HOOKK");
    expect(problems[1]).toContain("Case 4");
  });
});
