---
name: whatsallowed
description: Check this project's and the user's Claude Code, Codex and Cursor config for risky settings (permission modes, broad allow rules, unprotected secrets files, hooks that download and run code, unpinned MCP servers, credentials in config). Use when the user asks to check, audit or review their agent setup, MCP servers, hooks or permissions.
---

# Check agent config

Run the bundled checker. It only reads files and, once installed, makes no network calls.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" --format json
```

For a short text report, omit `--format json`. Add `--details` for explanations, suggested changes, matched text, rule IDs and glossary. `--verbose` adds info notes and summary items; it can be combined with `--details`.

Add `--project-only` to check just this project, or `--user-only` for just the user's own config.

Then tell the user:

1. How many high and medium findings there are. If there are none, say so plainly, say briefly what was checked using the `summary` field (files read, and the counts per check), and add that this is a configuration check, not a security assessment.
2. For each high finding, then each medium one: the file and line, what it means in one sentence, and the fix from the `fix` field. Group repeats of the same rule.
3. Info findings only if the user asks for them.

Don't change any config file unless the user asks you to. If they do, show the change before making it. Keys and tokens the checker finds are masked; never try to read the full value. Other findings and the summary also pass through a masking step, which hides the password in an address, auth headers, `--token` style options and credential-looking `NAME=value` pairs. It works from patterns, so if anything in the output still looks like a password or token, don't repeat it to the user.

The tool's own accuracy figures are in `${CLAUDE_PLUGIN_ROOT}/docs/ACCURACY.md`. If the user asks how far to trust a result, point them there.
