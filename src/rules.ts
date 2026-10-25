import type { CheckId, Severity } from "./types.ts";

export interface RuleInfo {
  id: string;
  check: CheckId;
  /** Highest severity the rule can raise; some rules lower it by scope. */
  severity: Severity;
  summary: string;
}

export const RULES: RuleInfo[] = [
  { id: "MODE-001", check: "MODE", severity: "high", summary: "User or managed settings start Claude Code in bypassPermissions mode." },
  { id: "MODE-003", check: "MODE", severity: "medium", summary: "A project or local file asks for bypassPermissions or auto mode, or to skip the bypass warning." },
  { id: "MODE-004", check: "MODE", severity: "info", summary: "User settings skip the bypass-mode warning." },
  { id: "MODE-005", check: "MODE", severity: "high", summary: "enableAllProjectMcpServers approves every project MCP server (high in a repository file, medium in user settings, info in local settings)." },
  { id: "MODE-006", check: "MODE", severity: "medium", summary: "A repository file pre-approves its own MCP servers with enabledMcpjsonServers." },
  { id: "MODE-007", check: "MODE", severity: "high", summary: "Codex sandbox_mode is danger-full-access (high with approval_policy never)." },
  { id: "MODE-008", check: "MODE", severity: "medium", summary: "Codex trusts a whole home folder or drive root." },
  { id: "ALLOW-001", check: "ALLOW", severity: "high", summary: "An allow rule approves every shell command (Bash, Bash(*), PowerShell)." },
  { id: "ALLOW-002", check: "ALLOW", severity: "medium", summary: "An allow rule approves a shell, interpreter, package runner, privilege, remote-access or download tool with any arguments." },
  { id: "ALLOW-003", check: "ALLOW", severity: "medium", summary: "WebFetch is allowed for every domain." },
  { id: "ALLOW-004", check: "ALLOW", severity: "medium", summary: "additionalDirectories includes the home folder or a filesystem root." },
  { id: "DENY-001", check: "DENY", severity: "medium", summary: "A secrets file in a Claude Code project has no Read deny rule covering it." },
  { id: "ENDPOINT-001", check: "ENDPOINT", severity: "high", summary: "A project or local settings file sets a base URL, proxy, TLS switch or NODE_OPTIONS. Medium in a local file or for a loopback address; info for a loopback address in a local file git ignores." },
  { id: "ENDPOINT-002", check: "ENDPOINT", severity: "high", summary: "A project or local settings file sets credentials or switches the model provider." },
  { id: "ENDPOINT-003", check: "ENDPOINT", severity: "high", summary: "A project or local settings file sets a credential helper command." },
  { id: "ENDPOINT-004", check: "ENDPOINT", severity: "info", summary: "A repository sets a status line command." },
  { id: "HOOK-001", check: "HOOK", severity: "high", summary: "A hook or helper command downloads code and runs it." },
  { id: "HOOK-002", check: "HOOK", severity: "high", summary: "A hook or helper command runs a base64 or encoded PowerShell payload." },
  { id: "HOOK-003", check: "HOOK", severity: "high", summary: "A hook or helper command opens a reverse shell." },
  { id: "HTTPHOOK-001", check: "HTTPHOOK", severity: "high", summary: "An HTTP hook posts to another host from a repository, local or plugin file (high), or over plain http from user settings (medium)." },
  { id: "HTTPHOOK-002", check: "HTTPHOOK", severity: "high", summary: "An HTTP hook sends a credential in its headers to another host." },
  { id: "MCP-001", check: "MCP", severity: "medium", summary: "An MCP server runs a package without an exact version." },
  { id: "MCP-002", check: "MCP", severity: "medium", summary: "An MCP server is launched through a shell string with metacharacters." },
  { id: "MCP-003", check: "MCP", severity: "high", summary: "An MCP server's launch command downloads code and runs it." },
  { id: "MCP-004", check: "MCP", severity: "medium", summary: "An MCP server binds to 0.0.0.0 or ::." },
  { id: "MCP-005", check: "MCP", severity: "medium", summary: "A Codex MCP server keeps an OAuth client secret in the config file." },
  { id: "MCP-006", check: "MCP", severity: "medium", summary: "An MCP server talks to a remote host over plain http." },
  { id: "MCP-007", check: "MCP", severity: "info", summary: "A repository connects to a remote https MCP server." },
  { id: "DRIFT-001", check: "DRIFT", severity: "medium", summary: "An MCP server's command, arguments, URL or env changed since the baseline." },
  { id: "DRIFT-002", check: "DRIFT", severity: "info", summary: "An MCP server is new since the baseline." },
  { id: "SECRET-001", check: "SECRET", severity: "high", summary: "A credential is written into an instruction file." },
  { id: "SECRET-002", check: "SECRET", severity: "high", summary: "A credential is stored in an MCP server's env or headers, or a settings env block (high in repository files, medium in your own)." },
  { id: "SKILL-001", check: "SKILL", severity: "high", summary: "A skill, plugin or hooks-folder script downloads code and runs it." },
  { id: "SKILL-002", check: "SKILL", severity: "high", summary: "A skill, plugin or hooks-folder script runs an encoded payload." },
  { id: "SKILL-003", check: "SKILL", severity: "high", summary: "A skill, plugin or hooks-folder script opens a reverse shell." },
  { id: "FILE-001", check: "FILE", severity: "high", summary: "A config file is over 1 MiB, so it wasn't read and nothing in it was checked (high in a repository, local or plugin file; medium in your own)." },
  { id: "FILE-002", check: "FILE", severity: "high", summary: "A config file exists but couldn't be opened (for example, no permission), so nothing in it was checked (high in a repository, local or plugin file; medium in your own)." },
];

export const ruleById = new Map(RULES.map((r) => [r.id, r]));
