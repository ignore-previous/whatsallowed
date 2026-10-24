import type { Model } from "../model.ts";
import { findExecInScript } from "../patterns.ts";
import type { Finding } from "../types.ts";
import { EXEC_RULE, EXEC_TITLE, EXEC_WHY } from "./hooks.ts";
import { make, scopeWord } from "./util.ts";

const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_SCRIPTS = 2000;

export function checkSkills(m: Model): Finding[] {
  const out: Finding[] = [];
  const scripts = m.ctx.files.filter((f) => f.kind === "script" && f.text !== undefined && !/\.min\.[cm]?js$/i.test(f.path));
  if (scripts.length > MAX_SCRIPTS) m.ctx.notes.push(`Found ${scripts.length} skill and plugin scripts; checked the first ${MAX_SCRIPTS}.`);
  for (const file of scripts.slice(0, MAX_SCRIPTS)) {
    const text = file.text ?? "";
    if (text.length > MAX_SCRIPT_BYTES) {
      m.ctx.notes.push(`${file.display} is over 512 KB, skipped.`);
      continue;
    }
    for (const hit of findExecInScript(text).slice(0, 3)) {
      out.push(
        make("SKILL", {
          rule: `SKILL-${EXEC_RULE[hit.kind]}`,
          severity: "high",
          title: `A script in a ${file.scope === "plugin" ? "plugin" : "skill or hooks folder"} ${EXEC_TITLE[hit.kind]}`,
          file,
          line: hit.line,
          match: hit.match,
          why: `This script (${scopeWord(file.scope)}) ${hit.form}. ${EXEC_WHY[hit.kind]}`,
          fix: "Remove the skill or plugin, or replace the line with a pinned, reviewed local copy of what it downloads.",
        }),
      );
    }
  }
  return out;
}
