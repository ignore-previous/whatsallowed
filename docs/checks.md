# Checks

Each check looks for one kind of risky setting in agent config on your machine. A finding names the file, the line, the rule ID and why it matters. Findings come in three levels:

- **high:** the setting lets code or data leave your control with no prompt, or lets a repository take control of something it shouldn't.
- **medium:** the setting widens what the agent can do without asking, or is a common precursor to a problem. Worth a look.
- **info:** context, not an alert. Info notes don't change the exit code by default and aren't counted in the accuracy figures.

None of this is a security assessment. A clean result doesn't mean a setup is safe.

| Check | What it looks for | Tools |
|---|---|---|
| `MODE` | Permission modes and switches that remove prompts: Claude Code `bypassPermissions`, settings that auto-approve every project MCP server, Codex `approval_policy = "never"` with `danger-full-access`, trusting a whole home folder | Claude Code, Codex |
| `ALLOW` | Allow rules so broad they approve any command (`Bash`, `Bash(*)`), approve a shell or interpreter with any arguments (`Bash(python *)`, `Bash(curl *)`), allow fetching any domain, or add the home folder or a drive root as a working directory | Claude Code |
| `DENY` | A project holds `.env` files, private keys or similar, and no Claude Code `Read` deny rule covers them, so the agent can read them without asking | Claude Code |
| `ENDPOINT` | A repository's own settings file changes where your requests go or which credentials they use: `ANTHROPIC_BASE_URL`, proxies, API keys and tokens, provider switches, TLS switches, `NODE_OPTIONS`, or credential-helper commands | Claude Code |
| `HOOK` | Hook and helper commands that download and run code, decode base64 into a shell, run encoded PowerShell, or open a reverse shell | Claude Code, Codex |
| `HTTPHOOK` | HTTP hooks that post session events to a host other than your own machine, especially with credentials in headers | Claude Code |
| `MCP` | MCP server definitions that run a package without a pinned version, wrap a shell around the launch, download and run code, listen on every network interface, talk to a remote server over plain `http://`, or keep an OAuth client secret in the config | Claude Code, Codex, Cursor |
| `DRIFT` | An MCP server definition changed since you recorded a baseline with `whatsallowed baseline` | Claude Code, Codex, Cursor |
| `SECRET` | API keys, tokens and private keys written into instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, `.cursorrules`, Cursor rules) or into MCP and settings `env`/header blocks | All |
| `SKILL` | Scripts shipped in skills, plugins and hook folders that download and run code, decode base64 into a shell, or open a reverse shell | Claude Code, Codex |

Not a check of its own: `FILE-001` is raised when a config file is over 1 MiB. We don't read it, so nothing in it was checked, and the finding says so. A file we can only partly read, or can't read at all, gets a note that names it. See [THREAT_MODEL.md](THREAT_MODEL.md).

The inventory (`whatsallowed inventory`) lists every config file the tool found, with its tool and scope.

What the checks rely on, with links to the vendors' docs: [config-surface.md](config-surface.md).

<!-- rules:start -->
## Rules

Generated from `src/rules.ts`. The level shown is the usual one; some rules set it lower for your own files, as the summary says.

| Rule | Level | Summary |
|---|---|---|
| `MODE-001` | high | User or managed settings start Claude Code in bypassPermissions mode. |
| `MODE-003` | medium | A project or local file asks for bypassPermissions or auto mode, or to skip the bypass warning. |
| `MODE-004` | info | User settings skip the bypass-mode warning. |
| `MODE-005` | high | enableAllProjectMcpServers approves every project MCP server (high in a repository file, medium in user settings, info in local settings). |
| `MODE-006` | medium | A repository file pre-approves its own MCP servers with enabledMcpjsonServers. |
| `MODE-007` | high | Codex sandbox_mode is danger-full-access (high with approval_policy never). |
| `MODE-008` | medium | Codex trusts a whole home folder or drive root. |
| `ALLOW-001` | high | An allow rule approves every shell command (Bash, Bash(*), PowerShell). |
| `ALLOW-002` | medium | An allow rule approves a shell, interpreter, package runner, privilege, remote-access or download tool with any arguments. |
| `ALLOW-003` | medium | WebFetch is allowed for every domain. |
| `ALLOW-004` | medium | additionalDirectories includes the home folder or a filesystem root. |
| `DENY-001` | medium | A secrets file in a Claude Code project has no Read deny rule covering it. |
| `ENDPOINT-001` | high | A project or local settings file sets a base URL, proxy, TLS switch or NODE_OPTIONS. Medium in a local file or for a loopback address; info for a loopback address in a local file git ignores. |
| `ENDPOINT-002` | high | A project or local settings file sets credentials or switches the model provider. |
| `ENDPOINT-003` | high | A project or local settings file sets a credential helper command. |
| `ENDPOINT-004` | info | A repository sets a status line command. |
| `HOOK-001` | high | A hook or helper command downloads code and runs it. |
| `HOOK-002` | high | A hook or helper command runs a base64 or encoded PowerShell payload. |
| `HOOK-003` | high | A hook or helper command opens a reverse shell. |
| `HTTPHOOK-001` | high | An HTTP hook posts to another host from a repository, local or plugin file (high), or over plain http from user settings (medium). |
| `HTTPHOOK-002` | high | An HTTP hook sends a credential in its headers to another host. |
| `MCP-001` | medium | An MCP server runs a package without an exact version. |
| `MCP-002` | medium | An MCP server is launched through a shell string with metacharacters. |
| `MCP-003` | high | An MCP server's launch command downloads code and runs it. |
| `MCP-004` | medium | An MCP server binds to 0.0.0.0 or ::. |
| `MCP-005` | medium | A Codex MCP server keeps an OAuth client secret in the config file. |
| `MCP-006` | medium | An MCP server talks to a remote host over plain http. |
| `MCP-007` | info | A repository connects to a remote https MCP server. |
| `DRIFT-001` | medium | An MCP server's command, arguments, URL or env changed since the baseline. |
| `DRIFT-002` | info | An MCP server is new since the baseline. |
| `SECRET-001` | high | A credential is written into an instruction file. |
| `SECRET-002` | high | A credential is stored in an MCP server's env or headers, or a settings env block (high in repository files, medium in your own). |
| `SKILL-001` | high | A skill, plugin or hooks-folder script downloads code and runs it. |
| `SKILL-002` | high | A skill, plugin or hooks-folder script runs an encoded payload. |
| `SKILL-003` | high | A skill, plugin or hooks-folder script opens a reverse shell. |
| `FILE-001` | high | A config file is over 1 MiB, so it wasn't read and nothing in it was checked (high in a repository, local or plugin file; medium in your own). |
