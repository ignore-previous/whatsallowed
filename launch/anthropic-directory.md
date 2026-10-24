# Anthropic plugin directory: draft answers

First check whether an individual account can submit, and what the current form asks. Answers below are for the usual questions.

- **Name:** What's Allowed
- **Repository:** https://github.com/ignore-previous/whatsallowed (public, MIT)
- **Manifest:** `.claude-plugin/plugin.json`; marketplace file `.claude-plugin/marketplace.json`; passes `claude plugin validate`.
- **What it does:** One skill that runs a bundled, read-only CLI to check Claude Code, Codex and Cursor config for risky settings, then explains the findings and fixes.
- **Components:** 1 skill (`skills/whatsallowed/SKILL.md`). No hooks, no MCP servers, no commands, no agents.
- **Data handling:** Reads config files on the user's machine. Writes only `~/.whatsallowed/baseline.json`, and only when the user runs `baseline`. Makes no network calls (enforced by `test/no-network.test.ts`), collects no telemetry and stores nothing elsewhere. Secrets are masked in all output.
- **Permissions it needs:** Bash, to run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs"`.
- **Third-party code:** jsonc-parser (MIT) and smol-toml (BSD-3), bundled; licences in THIRD_PARTY_LICENSES.txt.
- **Support:** GitHub issues; security reports via private advisories (SECURITY.md).
- **Limits stated to users:** config check, not a security assessment; accuracy and known misses in docs/ACCURACY.md; every label behind those figures came from an AI model, not a person.
