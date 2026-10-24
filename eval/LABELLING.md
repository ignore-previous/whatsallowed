# Labelling rule

How each case in the labelled set gets its label. Written 19 Oct 2026, before the test split was written and before any check was tuned. Changes to this file after the test split is frozen are listed at the end, with dates.

## What a label is

A case is a small set of config files on an imaginary machine: files in the user's home folder (`~/...`) and files in one project folder (`./...`). Each case lists the checks that **should raise an alert** (a high or medium finding) on it. An empty list means the case is benign: no check should raise an alert.

Label from what the config would do, using the facts in `docs/config-surface.md`, not from what you guess a tool would match. Ask: "If this machine ran Claude Code, Codex or Cursor with these files, would the setting let code or data leave the user's control without a prompt, or let a repository take control of something it shouldn't, or widen what the agent can do without asking in the way the check describes?" Use the per-check rules below. Broad capability on its own, or suspicious wording with no concrete effect, is **not** enough.

A case can be risky for more than one check. List every check it is risky for.

Who owns a file matters:
- **User files** (`~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`) are the user's own choices.
- **Repository files** (`./.claude/settings.json`, `./.mcp.json`, `./.codex/config.toml`, `./.cursor/mcp.json`, instruction files in `./`) come with a cloned repository and are written by someone else.
- **Local files** (`./.claude/settings.local.json`) are usually the user's own, but sit inside the project.

## Per-check rules

**MODE** is risky when any of these hold:
- A user file starts Claude Code in `bypassPermissions` mode (`permissions.defaultMode`).
- A repository or local file asks for `bypassPermissions` or `auto` as `defaultMode`, or sets `skipDangerousModePermissionPrompt` (current Claude Code ignores these from a repository, but a repository asking for them is a signal, and older versions applied `bypassPermissions`).
- `enableAllProjectMcpServers: true` in a repository file or in a user file. (In a local file it's what Claude Code writes when the user clicks "approve all": benign.)
- A repository file pre-approves its own `.mcp.json` servers with `enabledMcpjsonServers`.
- Codex `approval_policy = "never"` together with `sandbox_mode = "danger-full-access"` (in one file or across user and project files), or `danger-full-access` on its own.
- Codex marks the user's whole home folder, or a drive or filesystem root, as `trusted`.
Not risky: `acceptEdits`, `plan`, `default`, `dontAsk`, `auto` in a user file, `approval_policy = "never"` with `workspace-write` or `read-only`, trusting a specific project folder.

**ALLOW** is risky when a Claude Code `permissions.allow` list (any file) has:
- a rule that matches every command: `Bash`, `Bash(*)`, `Bash(:*)`, `PowerShell`, `PowerShell(*)`;
- a rule that lets a shell, interpreter, package runner, privilege tool, remote-access or download tool run with any arguments, such as `Bash(bash *)`, `Bash(python3:*)`, `Bash(node *)`, `Bash(npx *)`, `Bash(sudo *)`, `Bash(curl *)`, `Bash(wget *)`, `Bash(ssh *)`, `Bash(eval *)`, `Bash(rm *)`;
- `WebFetch` with no domain, or `WebFetch(domain:*)`;
- or when `permissions.additionalDirectories` includes the home folder or a filesystem or drive root.
Not risky: narrow rules such as `Bash(npm run test)`, `Bash(git status)`, `Bash(npm run *)`, `Bash(git diff *)`, `Bash(ls *)`, `WebFetch(domain:docs.example.com)`, project subfolders in `additionalDirectories`. Deny and ask lists are never risky for ALLOW.

**DENY** is risky when the project folder (top level or one folder down) holds a secrets file and the project uses Claude Code (it has a `./.claude/` folder, `./CLAUDE.md` or `./.mcp.json`), and no `Read` deny rule in any Claude Code settings file covers that file. Secrets files: `.env`, `.env.<anything>` (except `.env.example`, `.env.sample`, `.env.template`, `.env.dist`), `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`, `.npmrc` and `.pypirc` that contain a token. A deny rule covers a file if its gitignore-style pattern matches the file's path (for example `Read(./.env)`, `Read(.env*)`, `Read(**/.env)`, `Read(//**/.env)`, `Read(./**/*.pem)`).
Not risky: no secrets file present; only `.env.example`; a project with no Claude Code use; a covering deny rule in any scope.

**ENDPOINT** is risky when a repository or local Claude Code settings file's `env` block sets: a base URL (`ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL` or similar), a proxy (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, any case), a credential (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`, `AWS_*` keys), a provider switch (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`), TLS changes (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_EXTRA_CA_CERTS`), or `NODE_OPTIONS`; or when a repository or local file sets `apiKeyHelper`, `awsCredentialExport`, `awsAuthRefresh` or `otelHeadersHelper`.
Not risky: any of these in a **user** file (the user chose them, for example a company gateway or a local proxy); a base URL or proxy pointing at this machine (`localhost`, `127.0.0.1`, `::1`) in a local file that git ignores (added after freezing, see below); harmless `env` values in a repository file such as `BASH_DEFAULT_TIMEOUT_MS`, `MAX_THINKING_TOKENS`, `DISABLE_TELEMETRY`, `ANTHROPIC_MODEL`.

**HOOK** is risky when a hook or helper command (Claude Code `hooks` command handlers, `statusLine`, `apiKeyHelper` and the other helper commands; Codex hooks and `notify`), in any file, fetches content from the network and executes it (piped into a shell or interpreter, run through `eval`/`iex`, process substitution, or saved then run), decodes base64 or similar and executes the result, runs encoded PowerShell, or opens a reverse shell.
Not risky: hooks that run a local script, format files, run tests, post a desktop notification, call `curl` to send or fetch data without executing it (`curl ... | jq`), or check a URL's status.

**HTTPHOOK** is risky when a Claude Code `http` hook posts to a host other than the local machine (`localhost`, `127.0.0.1`, `::1`) and either it comes from a repository, local or plugin file, or it puts a credential into a header (an `allowedEnvVars` entry or `$VAR` whose name looks like a key, token or secret), or it uses plain `http://`. A user-file hook to an `https://` host the user also lists in their own `allowedHttpHookUrls` is benign.
Not risky: `http` hooks to localhost; user-file hooks to `https://` hosts with no credential headers.

**MCP** is risky when an MCP server definition (any tool, any file):
- runs a package through `npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `uvx` or `pipx run` without an exact version (`pkg@1.4.2` or `pkg==1.4.2` is pinned; no version, `@latest`, `@^1` or a tag is not);
- wraps the launch in a shell string with metacharacters (`;`, `&&`, `||`, `|`, backticks, `$(`) or downloads and runs code;
- binds or passes a host of `0.0.0.0` or `::`;
- points at a remote host over plain `http://` (not localhost);
- or stores a Codex `oauth.client_secret` in the file.
Not risky: pinned packages, local commands (`node ./server.js`, `docker run` of a pinned image, `uv run` inside the project), `cmd /c npx pkg@1.2.3` on Windows, remote `https://` servers, `${VAR}` references, localhost URLs.

**DRIFT** is risky when the case has a recorded baseline (`before`) and an MCP server definition that existed in the baseline has changed in a way that changes what runs or where it connects: a different command, arguments, package or version, URL, or `env` value. A pure formatting change, key reordering, an unchanged server, or a server that is new since the baseline is not risky for DRIFT. A case with no baseline is never risky for DRIFT.

**SECRET** is risky when a real-looking credential appears as a literal value in an instruction file (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/*`), or in an MCP server's `env`, `headers` or `http_headers`, or in a Claude Code settings `env` block. Real-looking means a provider key format (Anthropic `sk-ant-...`, OpenAI `sk-...`/`sk-proj-...`, AWS `AKIA...`, GitHub `ghp_`/`github_pat_`, Slack `xox?-`, Stripe `sk_live_`, Google `AIza...`, npm `npm_`, Hugging Face `hf_`), a private key block, or a long random-looking value under a key or token name.
Not risky: `${VAR}` or `$VAR` references, `env_http_headers`/`bearer_token_env_var` names, obvious placeholders (`sk-ant-xxxx`, `<your-key>`, `YOUR_TOKEN_HERE`, `changeme`, `...`), short or dictionary-word values, test keys documented as fake (`sk_test_` is still a credential for Stripe and counts as risky).

**SKILL** is risky when a script file (shell, PowerShell, Python, JavaScript or batch, not Markdown) inside a skill folder (`~/.claude/skills/`, `./.claude/skills/`), an installed plugin, or a hooks folder (`./.claude/hooks/`) fetches content from the network and executes it, decodes and executes an encoded payload, or opens a reverse shell. A commented-out line doesn't count.
Not risky: scripts that download a file without running it, call an API, or run local tools; installation instructions in `SKILL.md` or README prose.

## Process

- The dev split is written and labelled by the lead agent and used for tuning.
- The test split is written and labelled by separate helper agents that saw only this file, `docs/checks.md`, `docs/config-surface.md` and `eval/README.md`, never the source code. It is frozen by hash (`eval/test.lock`) before any rule is tuned against it.
- The maintainer labels a random 30-case sample of the test split blind (`eval/kappa/sheet.md`, made by `eval/tools/kappa-sheet.mjs`). Agreement (Cohen's kappa) is reported on the accuracy page.

## Changes after freezing

- 19 Oct 2026, after the first test run (`ENDPOINT`): a base URL or proxy (`ANTHROPIC_BASE_URL`, `HTTPS_PROXY` and the others in the first group) that points at this machine (`localhost`, `127.0.0.1`, `::1`) in `./.claude/settings.local.json` is **not risky** when git ignores that file (through `.gitignore`, `.claude/.gitignore`, `.git/info/exclude` or the global excludes file) and it isn't already tracked. The check reports it as an info note instead of a medium alert. Why: a run on the maintainer's own projects raised two medium alerts for their own local proxy, set in git-ignored local files. Such a file isn't shared through the repository, and a loopback address can only reach a program on the user's machine. Loopback addresses in repository files, remote addresses in local files, and local files git doesn't ignore stay risky. No case in the frozen test split has a loopback address in a local file, so no test label is affected, and the rerun gives the same figures.

