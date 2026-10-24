# Threat model

What whatsallowed is for, what it assumes and where it stops. It is a configuration check, not a security assessment.

## What it protects

The person running a coding agent (Claude Code, Codex CLI, Cursor) on their own machine: their files, their credentials, and the commands the agent can run without asking.

## The threats it looks for

| Threat | Example | Checks |
|---|---|---|
| A repository you clone takes more control than you expect | `.claude/settings.json` sets `ANTHROPIC_BASE_URL`, pre-approves its own MCP servers, or adds an `http` hook that posts your session to its server | ENDPOINT, MODE, HTTPHOOK, MCP |
| Config that removes prompts across the board | `bypassPermissions` by default, `Bash(*)` allowed, Codex `never` + `danger-full-access` | MODE, ALLOW |
| Secrets in reach of the agent | `.env` with no `Read` deny rule; an API key pasted into `CLAUDE.md` | DENY, SECRET |
| Code fetched and run at start-up | a hook, MCP launch command or skill script that pipes `curl` into a shell, runs base64 or encoded PowerShell, or opens a reverse shell | HOOK, MCP, SKILL |
| Supply-chain drift | an MCP server run with `npx pkg` and no version, or a server definition that changed since you last looked | MCP, DRIFT |

## Assumptions

- The tool runs as you and reads only what you can read. It writes only the baseline file, and only when you run `baseline`.
- The config files on disk are what the agent will use. Settings that come from a server, an enterprise console or the command line aren't visible to it.
- Your own user files reflect your choices. The same setting is often rated lower in a user file than in a repository file, because a repository is someone else's code.

## What it can't see

- **Run time.** It doesn't start MCP servers, list their tools or watch what they do. A pinned, unchanged server can still behave badly. The baseline covers config only, not tool lists.
- **Prose.** Hidden or malicious instructions in `CLAUDE.md`, skills or tool descriptions (prompt injection) are out of scope.
- **Scripts a hook calls.** A hook that runs `./scripts/setup.sh` isn't followed into that script unless it sits in a skill, plugin or hooks folder.
- **Obfuscation.** The patterns catch common forms. Someone set on hiding a download-and-run can do it.
- **Every file name.** The DENY check knows common secrets files (`.env*`, `*.pem`, `*.key`, SSH keys, `credentials.json`, `.npmrc` and `.pypirc` with tokens) at the top level and one folder down.
- **Other tools.** Only Claude Code, Codex CLI and Cursor's MCP config are read. Cursor's run-mode settings aren't stored in a file it can read.
- **Vendor changes.** Agents change their config often. A key the docs add tomorrow won't be checked until a rule is written for it.

## The tool's own risk

- **No network.** It has no network code, and a test runs every command with network and process APIs replaced by tripwires.
- **No telemetry.** Nothing is collected or sent.
- **Keys and tokens are masked.** When the SECRET or ENDPOINT checks find a key or token, output shows a prefix and a length, never the full value, in text, JSON and SARIF alike. Other findings quote the setting they matched, so a password or token written inside an address or command (in `ANTHROPIC_BASE_URL`, an HTTP hook URL or an MCP package address, for example) can appear in full in a finding's match and fix text. Read the output before you upload it to CI or paste it anywhere.
- **Read-only.** It never changes your config. A test ([test/no-writes.test.ts](test/no-writes.test.ts)) runs full scans on a sample home and project and checks that no file or folder was created, changed or removed anywhere in that tree.
- **Two runtime dependencies**, both parsers: `jsonc-parser` and `smol-toml`, pinned to exact versions. The npm package ships one bundled file.
- **Paths in output.** Text and JSON output name files in your home folder (`~/...`). Think about that before you paste output in public.

## Reporting a problem

See [SECURITY.md](../SECURITY.md).
