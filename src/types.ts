export type Severity = "high" | "medium" | "info";

export type CheckId =
  | "MODE"
  | "ALLOW"
  | "DENY"
  | "ENDPOINT"
  | "HOOK"
  | "HTTPHOOK"
  | "MCP"
  | "DRIFT"
  | "SECRET"
  | "SKILL"
  | "FILE";

/** The checks that read settings and are scored by the eval. FILE only reports files that couldn't be read, so it has no accuracy figures. */
export const CHECK_IDS: Exclude<CheckId, "FILE">[] = [
  "MODE",
  "ALLOW",
  "DENY",
  "ENDPOINT",
  "HOOK",
  "HTTPHOOK",
  "MCP",
  "DRIFT",
  "SECRET",
  "SKILL",
];

export type Tool = "claude" | "codex" | "cursor" | "gemini" | "agents";

/** Who controls a file. "project" files arrive with a cloned repository. */
export type Scope = "managed" | "user" | "project" | "local" | "plugin";

export type FileKind =
  | "claude-settings"
  | "claude-json"
  | "mcp-json"
  | "codex-config"
  | "codex-hooks"
  | "cursor-mcp"
  | "plugin-hooks"
  | "plugin-manifest"
  | "instructions"
  | "script"
  | "secret-file";

export interface ConfigFile {
  /** Absolute path, forward slashes. */
  path: string;
  /** Path shown to the user: ~/... or ./... */
  display: string;
  tool: Tool;
  kind: FileKind;
  scope: Scope;
  /** File text. Undefined for secret files (only their presence matters). */
  text?: string;
  /** For ./.claude/settings.local.json: git ignores it, so it isn't shared with the repository. */
  gitIgnored?: boolean;
}

/** A config file the tool found but did not read: it is over the size limit, or it exists but could not be opened. */
export interface UncheckedFile extends ConfigFile {
  reason: "too-large" | "unopenable";
  /** Size on disk in bytes. Set when the reason is "too-large". */
  bytes?: number;
  /** Short error code from the failed open, such as EACCES. Set when the reason is "unopenable". */
  error?: string;
}

export interface Finding {
  rule: string;
  check: CheckId;
  severity: Severity;
  title: string;
  file: string;
  line: number;
  /** What was matched. Passwords and tokens are masked. */
  match: string;
  why: string;
  fix: string;
}

export interface ScanContext {
  home: string;
  project: string;
  files: ConfigFile[];
  /** Absolute paths of top-level and one-level-down project files, for the DENY check. */
  projectEntries: string[];
  baseline?: Baseline;
  notes: string[];
}

export interface Baseline {
  version: 1;
  created: string;
  /** Absolute paths of the config files recorded, including ones with no servers. */
  files: string[];
  /** "<absolute file path>#<server>" -> sha256 of the parts that decide what runs and where it connects. */
  servers: Record<string, string>;
}
