// The per-check summary printed after the findings: what each check looked at, how much it found,
// the broadest setting where one is meaningful, and one plain sentence on what that means for you.
// Facts only, stated against the rule. Never "fine" or "safe".
import { classifyAllowRule } from "./checks/allow.ts";
import { projectUsesClaude, secretFilesToGuard } from "./checks/deny.ts";
import { removedSinceBaseline } from "./checks/drift.ts";
import { findRunner, shellWords, unwrap } from "./checks/mcp.ts";
import type { ScanMode } from "./discover.ts";
import type { HookHandler, McpServer, Model } from "./model.ts";
import { TOOL_NAME } from "./name.ts";
import { get, isObj, str, strArr } from "./parse.ts";
import { isLoopback, parseUrl } from "./patterns.ts";
import type { CheckId, Finding, Severity } from "./types.ts";

export interface CheckSummary {
  check: CheckId;
  /** False when the check couldn't run: DRIFT with no baseline, DENY in a project with no Claude Code files. */
  checked: boolean;
  /** How many things of this kind were found: rules, servers, hooks, files or values. */
  count: number;
  findings: Record<Severity, number>;
  /** The single broadest setting, where "broadest" has a clear meaning (MODE, ALLOW). */
  broadest?: string;
  /** One line of facts. */
  text: string;
  /** What it means for you, in plain words. */
  meaning: string;
  /** The command to run when the check couldn't run. */
  fix?: string;
  /** Everything counted, for --verbose and JSON. Never contains secret values or full commands. */
  items: string[];
}

export interface Summary {
  scope: ScanMode;
  files: { total: number; claude: number; codex: number; cursor: number; other: number };
  checks: CheckSummary[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Hide anything in a rule that could be a credential: values of NAME=value assignments (quoted or not, and
 * query parameters), Bearer and Basic tokens, auth and API-key header values, values of --token/--key/--password
 * style flags, user:password after -u or --user, and the user and password part of an address.
 */
export function scrub(text: string): string {
  return text
    .replace(/\b(Authorization|Proxy-Authorization|[A-Za-z-]*Api-Key|X-[A-Za-z-]*Token)(\s*:\s*)[^'")]+/gi, "$1$2•••")
    .replace(/\b(Bearer|Basic)\s+[^\s'")]+/gi, "$1 •••")
    .replace(/(^|[\s('"?&])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s'")&]+)/g, "$1$2=•••")
    .replace(/(--?[A-Za-z-]*(?:token|key|secret|passw(?:or)?d|pass|auth)[A-Za-z-]*)([=\s]\s*)([^\s'")*]+)/gi, "$1$2•••")
    .replace(/((?:^|\s)(?:-u|--user)[=\s]\s*[^\s:'"]+:)[^\s'")]+/g, "$1•••")
    .replace(/(\/\/)[^/\s@]+@/g, "$1•••@");
}

// ---- MODE ----

/** Claude Code permission modes, least to most permissive. */
const CLAUDE_MODES = ["plan", "dontAsk", "default", "acceptEdits", "auto", "bypassPermissions"];
const CLAUDE_MEANING: Record<string, string> = {
  plan: "Claude Code can read files but not change them or run commands.",
  dontAsk: "Claude Code refuses anything not already allowed, instead of asking you.",
  default: "Claude Code asks before running commands or editing files.",
  acceptEdits: "Claude Code edits files without asking, but asks before running commands.",
  auto: "Claude Code approves most actions itself and asks you only about ones it judges risky.",
  bypassPermissions: "Claude Code runs commands and edits files without asking you.",
};
const CODEX_SANDBOX = ["read-only", "workspace-write", "danger-full-access"];
const SANDBOX_MEANING: Record<string, string> = {
  "read-only": "Codex commands can read files but not change them",
  "workspace-write": "Codex commands can change files only inside the project",
  "danger-full-access": "Codex commands have full access to your disk and network",
};
const CODEX_APPROVAL = ["untrusted", "on-request", "on-failure", "never"];
const APPROVAL_MEANING: Record<string, string> = {
  untrusted: "and Codex asks before running anything not on its trusted list.",
  "on-request": "and Codex asks before going outside the sandbox.",
  "on-failure": "and Codex asks only when a command fails in the sandbox.",
  never: "and Codex never asks first.",
};

const rankIn = (list: string[], v: string): number => list.indexOf(v);

function modeSummary(m: Model, findings: Finding[]): CheckSummary {
  const items: string[] = [];
  let claude: string | undefined;
  let ignoredModes = 0;
  for (const p of m.settings) {
    const mode = str(get(p.doc.value, "permissions", "defaultMode")) ?? str(get(p.doc.value, "defaultMode"));
    if (!mode) continue;
    // Claude Code ignores bypassPermissions and auto when a project file asks for them.
    const ignored = (mode === "bypassPermissions" || mode === "auto") && (p.file.scope === "project" || p.file.scope === "local");
    items.push(`Claude Code defaultMode "${mode}" (${p.file.display})${ignored ? ", ignored in a project file" : ""}`);
    if (ignored) ignoredModes++;
    if (!ignored && rankIn(CLAUDE_MODES, mode) > rankIn(CLAUDE_MODES, claude ?? "")) claude = mode;
  }
  let sandbox: string | undefined;
  let approval: string | undefined;
  const codexSetting = (v: unknown, where: string): void => {
    const s = str(get(v, "sandbox_mode"));
    const a = str(get(v, "approval_policy"));
    if (s) {
      items.push(`Codex sandbox_mode "${s}" (${where})`);
      if (rankIn(CODEX_SANDBOX, s) > rankIn(CODEX_SANDBOX, sandbox ?? "")) sandbox = s;
    }
    if (a) {
      items.push(`Codex approval_policy "${a}" (${where})`);
      if (rankIn(CODEX_APPROVAL, a) > rankIn(CODEX_APPROVAL, approval ?? "")) approval = a;
    }
  };
  for (const p of m.codex) {
    codexSetting(p.doc.value, p.file.display);
    const profiles = get(p.doc.value, "profiles");
    if (isObj(profiles) && p.file.scope === "user") {
      for (const [name, prof] of Object.entries(profiles)) codexSetting(prof, `${p.file.display}, profile ${name}`);
    }
  }
  const broad: string[] = [];
  const meaning: string[] = [];
  if (claude) {
    broad.push(`Claude Code "${claude}"`);
    meaning.push(CLAUDE_MEANING[claude] ?? `Claude Code uses the "${claude}" mode.`);
  }
  if (sandbox || approval) {
    broad.push(`Codex ${[sandbox && `"${sandbox}"`, approval && `approval "${approval}"`].filter(Boolean).join(" with ")}`);
    const s = sandbox ? SANDBOX_MEANING[sandbox] : undefined;
    const a = approval ? APPROVAL_MEANING[approval] : undefined;
    if (s && a) meaning.push(`${s}, ${a}`);
    else if (s) meaning.push(`${s}.`);
    else if (a) meaning.push(cap(a.replace(/^and /, "")));
  }
  if (!items.length) {
    return base("MODE", findings, {
      count: 0,
      text: "No permission mode set in the files checked.",
      meaning: "Claude Code and Codex use their default modes. Claude Code's default asks before running commands or editing files.",
      items,
    });
  }
  return base("MODE", findings, {
    count: items.length,
    broadest: broad.join("; ") || undefined,
    text: `${plural(items.length, "mode setting", "mode settings")}.${broad.length ? ` Broadest: ${broad.join("; ")}.` : ""}`,
    meaning:
      meaning.join(" ") ||
      (ignoredModes === items.length
        ? "Claude Code ignores these modes in project files, so your own setting or its default applies."
        : "This check doesn't recognise the mode values set here, so it can't say what they do."),
    items,
  });
}

// ---- ALLOW ----

const WEBFETCH_ANY = /^WebFetch(?:\(\s*(?:domain:\s*\*|\*)?\s*\))?$/i;

function allowRank(rule: string): number {
  const v = classifyAllowRule(rule);
  if (v?.rule === "ALLOW-001") return 5;
  if (v?.rule === "ALLOW-002") return 4;
  if (WEBFETCH_ANY.test(rule.trim())) return 3;
  if (/^(?:Bash|PowerShell)\(.*\*.*\)$/is.test(rule.trim())) return 2;
  if (/^(?:Bash|PowerShell)\b/i.test(rule.trim())) return 1;
  return 0;
}

function allowSummary(m: Model, findings: Finding[]): CheckSummary {
  const items: string[] = [];
  let broadest: string | undefined;
  let best = -1;
  let dirs = 0;
  for (const p of m.settings) {
    for (const rule of strArr(get(p.doc.value, "permissions", "allow"))) {
      items.push(`${scrub(rule)} (${p.file.display})`);
      const r = allowRank(rule);
      if (r > best) ((best = r), (broadest = scrub(rule)));
    }
    dirs += strArr(get(p.doc.value, "permissions", "additionalDirectories")).length;
  }
  const rules = items.length;
  const extra = dirs ? ` Extra folders it can work in: ${dirs}.` : "";
  if (!rules) {
    return base("ALLOW", findings, {
      count: 0,
      text: `No allow rules.${extra}`,
      meaning: "Claude Code asks before anything your permission mode doesn't already allow.",
      items,
    });
  }
  const wide = findings.filter((f) => f.rule === "ALLOW-001" || f.rule === "ALLOW-002" || f.rule === "ALLOW-003").length;
  return base("ALLOW", findings, {
    count: rules,
    broadest,
    text: `${plural(rules, "allow rule", "allow rules")}. Broadest: ${broadest}.${extra}`,
    meaning: `Claude Code does what these match without asking. ${
      wide
        ? `${plural(wide, "rule approves", "rules approve")} every command, a powerful program with any arguments, or any web address.`
        : "None approves every command, a powerful program with any arguments, or any web address."
    }`,
    items,
  });
}

// ---- DENY ----

function denySummary(m: Model, findings: Finding[]): CheckSummary {
  const items: string[] = [];
  for (const p of m.settings) for (const rule of strArr(get(p.doc.value, "permissions", "deny"))) items.push(`${scrub(rule)} (${p.file.display})`);
  const rules = plural(items.length, "deny rule", "deny rules");
  if (!projectUsesClaude(m)) {
    return base("DENY", findings, {
      checked: false,
      count: items.length,
      text: `${cap(rules)}. Secrets files weren't checked: this project has no Claude Code files.`,
      meaning: "Deny rules stop Claude Code reading the files or running the commands they match.",
      items,
    });
  }
  const secrets = secretFilesToGuard(m);
  const open = findings.filter((f) => f.rule === "DENY-001").length;
  const where = "in the top two folder levels of this project";
  const fileText = !secrets.length
    ? `No .env, key or credentials files ${where}.`
    : secrets.length === 1
      ? `The 1 secrets file ${where} ${open ? "isn't" : "is"} covered by a deny rule.`
      : open
        ? `${open} of ${secrets.length} secrets files ${where} ${open === 1 ? "isn't" : "aren't"} covered by a deny rule.`
        : `All ${secrets.length} secrets files ${where} are covered by a deny rule.`;
  return base("DENY", findings, {
    count: items.length,
    text: `${cap(rules)}. ${fileText}`,
    meaning: "Deny rules stop Claude Code reading the files or running the commands they match.",
    items: [...items, ...secrets.map((f) => `secrets file ${f.display}`)],
  });
}

// ---- ENDPOINT ----

function endpointSummary(m: Model, findings: Finding[]): CheckSummary {
  const files = m.settings.filter((p) => p.file.scope === "project" || p.file.scope === "local");
  // Only the setting name: the value can be a key or token.
  const items = findings.map((f) => `${f.match.split(/[=:]/)[0] ?? f.match} (${f.file})`);
  if (!files.length) {
    return base("ENDPOINT", findings, {
      count: 0,
      text: "No project settings files to check.",
      meaning: "This check reads only settings that come with a project, not your own user settings.",
      items,
    });
  }
  const n = plural(files.length, "project settings file", "project settings files");
  // A repository status line (ENDPOINT-004) runs a command but doesn't redirect requests; HOOK counts it.
  const redirects = findings.filter((f) => f.rule !== "ENDPOINT-004").length;
  return base("ENDPOINT", findings, {
    count: files.length,
    text: redirects
      ? `${n}. ${plural(redirects, "setting changes", "settings change")} where your requests go or which credentials they use.`
      : `${n}. None changes where your requests go or which credentials they use.`,
    meaning: redirects
      ? "A project setting can send your prompts and code somewhere other than the provider you chose."
      : "Your prompts and code go where your own settings send them.",
    items,
  });
}

// ---- HOOK and HTTPHOOK ----

/** The program a command runs, without its path, arguments or any NAME=value assignments in front of it. */
const program = (h: HookHandler): string => {
  // Strip a leading env and the assignments before splitting into words, so a quoted value with spaces
  // can't leave part of itself behind as the "program".
  let rest = (h.command ?? "").trimStart();
  const env = /^(?:\S*[\\/])?env(?=\s|$)/.exec(rest);
  if (env) rest = rest.slice(env[0].length).trimStart();
  for (let m; (m = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s"'])*/.exec(rest)); ) rest = rest.slice(m[0].length).trimStart();
  const w = shellWords(rest)[0];
  if (!w) return env ? "env" : "(shell command)";
  if (env && w.startsWith("-")) return "env";
  return w.split(/[\\/]/).pop() || w;
};

function hookSummary(m: Model, findings: Finding[]): CheckSummary {
  const cmds = m.handlers.filter((h) => h.type === "command" && h.command);
  const items = cmds.map((h) => `${h.origin} in ${h.file.display}: ${program(h)}`);
  if (!cmds.length) {
    return base("HOOK", findings, {
      count: 0,
      text: "No hooks, status line or helper commands.",
      meaning: "Nothing in these files runs by itself when your agent acts.",
      items,
    });
  }
  const by = (o: (h: HookHandler) => boolean): number => cmds.filter(o).length;
  const parts = [
    [by((h) => h.origin === "hook"), "hook", "hooks"],
    [by((h) => h.origin === "statusLine"), "status line", "status lines"],
    [by((h) => h.origin === "notify"), "Codex notify command", "Codex notify commands"],
    [by((h) => h.origin !== "hook" && h.origin !== "statusLine" && h.origin !== "notify"), "credential helper", "credential helpers"],
  ] as const;
  const shared = by((h) => h.scope === "project" || h.scope === "plugin");
  return base("HOOK", findings, {
    count: cmds.length,
    text: `${plural(cmds.length, "command that runs by itself", "commands that run by themselves")}: ${parts
      .filter(([n]) => n > 0)
      .map(([n, one, many]) => plural(n, one, many))
      .join(", ")}.${shared ? ` ${shared} ${shared === 1 ? "comes" : "come"} from a repository or plugin.` : ""}`,
    meaning: `These run without asking you when events happen. ${
      findings.length
        ? `${plural(findings.length, "downloads and runs code, runs an encoded payload or opens a reverse shell", "download and run code, run an encoded payload or open a reverse shell")}.`
        : "None downloads and runs code, runs an encoded payload or opens a reverse shell."
    }`,
    items,
  });
}

function httpHookSummary(m: Model, findings: Finding[]): CheckSummary {
  const http = m.handlers.filter((h) => h.type === "http" && h.url);
  // Host only: a URL can carry a token in its query.
  const hostOf = (h: HookHandler): string => parseUrl(h.url ?? "")?.host ?? "(unreadable address)";
  const items = http.map((h) => `${hostOf(h)} (${h.file.display})`);
  if (!http.length) {
    return base("HTTPHOOK", findings, {
      count: 0,
      text: "No HTTP hooks.",
      meaning: "No hook sends details of your sessions to a web address.",
      items,
    });
  }
  const remote = [...new Set(http.filter((h) => !isLoopback(parseUrl(h.url ?? "")?.hostname ?? "")).map(hostOf))];
  return base("HTTPHOOK", findings, {
    count: http.length,
    text: `${plural(http.length, "HTTP hook", "HTTP hooks")}. ${
      remote.length ? `Hosts off this machine: ${remote.slice(0, 3).join(", ")}${remote.length > 3 ? `, and ${remote.length - 3} more` : ""}.` : "All post to this machine."
    }`,
    meaning: "Each one sends details of what your agent does, such as prompts and tool output, to its address.",
    items,
  });
}

// ---- MCP and DRIFT ----

const TOOL_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", gemini: "Gemini", agents: "shared" };

function launchOf(s: McpServer): string[] {
  const command = s.def.command;
  const args = strArr(s.def.args);
  const argv0 = Array.isArray(command) ? strArr(command) : typeof command === "string" ? (args.length ? [command] : shellWords(command)) : [];
  return unwrap([...argv0, ...args]).argv;
}

function mcpSummary(m: Model, findings: Finding[]): CheckSummary {
  const servers = m.servers;
  if (!servers.length) {
    return base("MCP", findings, {
      count: 0,
      text: "No MCP servers.",
      meaning: "Your agent has no extra tools or services from MCP servers in these files.",
      items: [],
    });
  }
  let remote = 0;
  let packages = 0;
  let unpinned = 0;
  const items = servers.map((s) => {
    const url = str(s.def.url) ?? str(s.def.serverUrl) ?? str(s.def.httpUrl);
    const where = `${TOOL_LABEL[s.tool] ?? s.tool}, ${s.file.display}`;
    if (url && s.def.command === undefined) {
      remote++;
      return `"${s.name}" (${where}): remote, ${parseUrl(url)?.host ?? "unreadable address"}`;
    }
    const r = findRunner(launchOf(s));
    if (r) {
      packages++;
      if (!r.pinned) unpinned++;
      // A package given as an address can carry a token or password: show only its host.
      const pkg = /^[a-z][a-z0-9+.-]*:\/\//i.test(r.pkg) ? `package at ${parseUrl(r.pkg.replace(/^[a-z0-9.-]+\+/i, ""))?.host ?? "an unreadable address"}` : scrub(r.pkg);
      return `"${s.name}" (${where}): ${r.runner} ${pkg}`;
    }
    return `"${s.name}" (${where}): local program`;
  });
  const local = servers.length - remote;
  const tools = Object.entries(
    servers.reduce<Record<string, number>>((acc, s) => ((acc[TOOL_LABEL[s.tool] ?? s.tool] = (acc[TOOL_LABEL[s.tool] ?? s.tool] ?? 0) + 1), acc), {}),
  )
    .map(([t, n]) => `${t} ${n}`)
    .join(", ");
  const pins = !packages
    ? ""
    : unpinned
      ? packages === 1
        ? " The downloaded package isn't pinned to an exact version."
        : ` ${unpinned} of ${packages} downloaded packages ${unpinned === 1 ? "isn't" : "aren't"} pinned to an exact version.`
      : ` ${packages === 1 ? "The downloaded package is" : `All ${packages} downloaded packages are`} pinned to an exact version.`;
  return base("MCP", findings, {
    count: servers.length,
    text: `${plural(servers.length, "MCP server", "MCP servers")} (${tools}): ${local} started on this machine, ${remote} remote.${pins}`,
    meaning: "Your agent can call these servers' tools while it works, with your access.",
    items,
  });
}

function driftSummary(m: Model, findings: Finding[]): CheckSummary {
  const b = m.ctx.baseline;
  if (!b) {
    if (!m.servers.length) {
      return base("DRIFT", findings, { count: 0, text: "No MCP servers, so there is nothing to compare.", meaning: "A baseline is only useful once you have MCP servers.", items: [] });
    }
    return base("DRIFT", findings, {
      checked: false,
      count: 0,
      text: "Not checked yet: no baseline recorded.",
      meaning: "A baseline saves your MCP server settings so later scans can spot one whose command or address changed.",
      fix: `npx ${TOOL_NAME} baseline`,
      items: [],
    });
  }
  const changed = findings.filter((f) => f.rule === "DRIFT-001");
  const added = findings.filter((f) => f.rule === "DRIFT-002");
  const removed = removedSinceBaseline(m);
  const items = [
    ...changed.map((f) => `changed: "${f.match}" (${f.file})`),
    ...added.map((f) => `new: "${f.match}" (${f.file})`),
    ...removed.map((k) => `removed: "${k.slice(k.lastIndexOf("#") + 1)}"`),
  ];
  return base("DRIFT", findings, {
    count: Object.keys(b.servers).length,
    text: `Baseline of ${b.created.slice(0, 10)}, ${plural(Object.keys(b.servers).length, "server", "servers")}: ${changed.length} changed, ${added.length} new, ${removed.length} removed since then.`,
    meaning: changed.length
      ? "A server that changed may now run different code or connect somewhere else."
      : "No recorded server's command, arguments, address or environment has changed.",
    items,
  });
}

// ---- SECRET and SKILL ----

function secretSummary(m: Model, findings: Finding[]): CheckSummary {
  const docs = m.ctx.files.filter((f) => f.kind === "instructions");
  const count = (v: unknown): number => (isObj(v) ? Object.values(v).filter((x) => typeof x === "string").length : 0);
  let values = 0;
  for (const s of m.servers) for (const block of ["env", "headers", "http_headers"]) values += count(get(s.def, block));
  for (const p of m.settings) values += count(get(p.doc.value, "env"));
  const items = docs.map((f) => f.display);
  return base("SECRET", findings, {
    count: docs.length + values,
    text: `Looked for keys and tokens in ${plural(docs.length, "instruction file", "instruction files")} and ${plural(values, "settings or MCP value", "settings and MCP values")}.`,
    meaning: findings.length
      ? `${plural(findings.length, "key or token is", "keys or tokens are")} written in plain text. Anyone who can read the file can use ${findings.length === 1 ? "it" : "them"}.`
      : "None holds a key or token in plain text that this check recognises.",
    items,
  });
}

function skillSummary(m: Model, findings: Finding[]): CheckSummary {
  const scripts = m.ctx.files.filter((f) => f.kind === "script" && f.text !== undefined && !/\.min\.[cm]?js$/i.test(f.path));
  const plugin = scripts.filter((f) => f.scope === "plugin").length;
  if (!scripts.length) {
    return base("SKILL", findings, {
      count: 0,
      text: "No skill, plugin or hooks-folder scripts.",
      meaning: "No skill, plugin or hooks folder in the folders checked brings its own scripts.",
      items: [],
    });
  }
  return base("SKILL", findings, {
    count: scripts.length,
    text: `${plural(scripts.length, "skill, plugin or hooks-folder script", "skill, plugin and hooks-folder scripts")}${plugin ? `, ${plugin} of them from plugins` : ""}.`,
    meaning: `Your agent can run these when it uses a skill or plugin, or when a hook fires. ${
      findings.length
        ? `${plural(findings.length, "line downloads and runs code, runs an encoded payload or opens a reverse shell", "lines download and run code, run an encoded payload or open a reverse shell")}.`
        : "None downloads and runs code, runs an encoded payload or opens a reverse shell."
    }`,
    items: scripts.map((f) => f.display),
  });
}

// ---- assembly ----

function base(
  check: CheckId,
  all: Finding[],
  s: Omit<CheckSummary, "check" | "findings" | "checked"> & { checked?: boolean },
): CheckSummary {
  const findings = { high: 0, medium: 0, info: 0 };
  for (const f of all) findings[f.severity]++;
  return { check, checked: s.checked ?? true, count: s.count, findings, broadest: s.broadest, text: s.text, meaning: s.meaning, fix: s.fix, items: s.items };
}

const BUILDERS: Record<CheckId, (m: Model, f: Finding[]) => CheckSummary> = {
  MODE: modeSummary,
  ALLOW: allowSummary,
  DENY: denySummary,
  ENDPOINT: endpointSummary,
  HOOK: hookSummary,
  HTTPHOOK: httpHookSummary,
  MCP: mcpSummary,
  DRIFT: driftSummary,
  SECRET: secretSummary,
  SKILL: skillSummary,
};

export function summarize(r: { mode: ScanMode; files: Model["ctx"]["files"]; findings: Finding[]; model: Model }): Summary {
  const byTool = (t: string): number => r.files.filter((f) => f.tool === t).length;
  const claude = byTool("claude");
  const codex = byTool("codex");
  const cursor = byTool("cursor");
  return {
    scope: r.mode,
    files: { total: r.files.length, claude, codex, cursor, other: r.files.length - claude - codex - cursor },
    checks: (Object.keys(BUILDERS) as CheckId[]).map((id) => BUILDERS[id](r.model, r.findings.filter((f) => f.check === id))),
  };
}
