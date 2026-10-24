# Config surface (checked 19 Oct 2026)

What each check relies on, from the vendors' own docs. Re-check these when a vendor ships a breaking release. Claude Code docs were read at v2.1.302.

## Claude Code

Sources: [settings](https://code.claude.com/docs/en/settings), [settings reference](https://code.claude.com/docs/en/settings-reference), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp).

Settings files, highest precedence first: managed (`managed-settings.json`, MDM, console), `--settings`, `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`. `~/.claude.json` is Claude Code's own file and holds user-scope MCP servers (top-level `mcpServers`) and local-scope ones (`projects.<path>.mcpServers`). Project MCP servers live in `.mcp.json` at the project root. Plugins can ship `.mcp.json`, `hooks/hooks.json` and skills.

Facts the checks depend on:

- `permissions.defaultMode` values: `default` (alias `manual`), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. **`auto` and `bypassPermissions` don't take effect from project or local settings** (since v2.1.257; before that, `bypassPermissions` worked from any file).
- `permissions.disableBypassPermissionsMode` and `disableAutoMode` (top level, or under `permissions`) take the string `"disable"`.
- `skipDangerousModePermissionPrompt` applies from user, local or managed settings, not from the shared project file.
- `enableAllProjectMcpServers: true` approves every `.mcp.json` server without a prompt. In an untrusted folder it's ignored in the shared project file; after trust it applies.
- Project `permissions.allow` rules and `additionalDirectories` apply only after the workspace trust dialog.
- Project and local `env` values apply after workspace trust. The docs list variables a repo can't set (config dirs, OS dirs, OpenTelemetry exporters, process wrapper and others). `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_CUSTOM_HEADERS` aren't on that list, so a repo can set them.
- `apiKeyHelper`, `otelHeadersHelper`, `awsCredentialExport`, `awsAuthRefresh` and `statusLine` are commands, and apply from any file.
- `Bash` and `Bash(*)` match every command. `Bash(x:*)` equals `Bash(x *)`. The docs say argument-constraining Bash patterns are fragile.
- Read deny rules use gitignore syntax: `./` or no prefix is relative to the project (for project files), `/` is relative to the settings file's source, `~/` is home, `//` is the filesystem root.
- Hooks: event → matcher groups → handlers. Handler types `command`, `http`, `mcp_tool`, `prompt`, `agent`. `http` hooks POST the event JSON to `url`. `allowedHttpHookUrls` limits them when set.

## Codex CLI

Source: [config reference](https://learn.chatgpt.com/docs/config-file/config-reference).

- User `~/.codex/config.toml`; project `.codex/config.toml`, read only for trusted projects (`projects.<path>.trust_level = "trusted"`).
- **Ignored in project config:** `openai_base_url`, `chatgpt_base_url`, `model_provider`, `model_providers`, `notify`, `profile`, `profiles`, `otel` and others. So no endpoint check for Codex project files.
- `approval_policy`: `on-request`, `never`, or `{ granular = {...} }`. `sandbox_mode`: `read-only`, `workspace-write`, `danger-full-access`.
- `mcp_servers.<id>`: `command`, `args`, `env`, `url`, `http_headers`, `env_http_headers`, `bearer_token_env_var`, `oauth.client_secret` (stored in plain text in the config).
- Hooks: `[hooks]` table with the same schema as `hooks.json`; command handlers run.

## Cursor

Sources: [MCP](https://cursor.com/docs/mcp), [run modes](https://cursor.com/docs/agent/security/run-modes).

- MCP: `.cursor/mcp.json` (project) and `~/.cursor/mcp.json` (global).
- Run modes (Auto-review, Allowlist, Run Everything) are chosen in the app's settings UI. The docs give no file for the chosen mode, so this tool can't check it. `permissions.json` holds plain-English guidance for the Auto-review classifier only.
- Rules: `.cursorrules` and `.cursor/rules/*.mdc` (scanned for secrets only).

**Coverage decision:** Cursor checks are MCP-only (plus secrets in rules files) until Cursor documents a file for run modes.
