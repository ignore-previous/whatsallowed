import { toPosix } from "../fsys.ts";
import type { Model, Parsed } from "../model.ts";
import { get, isObj, str, strArr } from "../parse.ts";
import type { Finding } from "../types.ts";
import { make } from "./util.ts";

const f = (x: Parameters<typeof make>[1]): Finding => make("MODE", x);

function claudeMode(p: Parsed): Finding[] {
  const out: Finding[] = [];
  const v = p.doc.value;
  const { scope } = p.file;
  const mode = str(get(v, "permissions", "defaultMode")) ?? str(get(v, "defaultMode"));
  const modePath = str(get(v, "permissions", "defaultMode")) ? ["permissions", "defaultMode"] : ["defaultMode"];
  if (mode === "bypassPermissions" && (scope === "user" || scope === "managed")) {
    out.push(
      f({
        rule: "MODE-001",
        severity: "high",
        title: "Claude Code starts with every permission prompt switched off",
        file: p.file,
        line: p.doc.lineOf(modePath),
        match: `defaultMode: "${mode}"`,
        why: "bypassPermissions lets Claude Code run commands, edit files and fetch URLs with no prompt, in every project you open.",
        fix: 'Use "acceptEdits" or "default", and start bypass mode only for a single session in a sandbox.',
      }),
    );
  }
  if ((mode === "bypassPermissions" || mode === "auto") && (scope === "project" || scope === "local")) {
    out.push(
      f({
        rule: "MODE-003",
        severity: "medium",
        title: `A project file asks for "${mode}" mode`,
        file: p.file,
        line: p.doc.lineOf(modePath),
        match: `defaultMode: "${mode}"`,
        why: `Current Claude Code ignores this mode from project files, but a project asking for it is a warning sign, and older versions applied bypassPermissions.`,
        fix: "Remove defaultMode from the project file. Choose a mode in your own user settings instead.",
      }),
    );
  }
  if (get(v, "skipDangerousModePermissionPrompt") === true) {
    if (scope === "project" || scope === "local") {
      out.push(
        f({
          rule: "MODE-003",
          severity: "medium",
          title: "A project file tries to skip the bypass-mode warning",
          file: p.file,
          line: p.doc.lineOf(["skipDangerousModePermissionPrompt"]),
          match: "skipDangerousModePermissionPrompt: true",
          why: "This switch is only honoured from user, local or managed settings. A repository setting it is a signal that it wants prompts gone.",
          fix: "Remove the key from the project file.",
        }),
      );
    } else if (scope === "user") {
      out.push(
        f({
          rule: "MODE-004",
          severity: "info",
          title: "The bypass-mode warning is switched off",
          file: p.file,
          line: p.doc.lineOf(["skipDangerousModePermissionPrompt"]),
          match: "skipDangerousModePermissionPrompt: true",
          why: "Claude Code won't warn you before entering bypass mode.",
          fix: 'If you never use bypass mode, set "permissions.disableBypassPermissionsMode": "disable".',
        }),
      );
    }
  }
  if (get(v, "enableAllProjectMcpServers") === true) {
    const sev = scope === "project" ? "high" : scope === "local" ? "info" : "medium";
    out.push(
      f({
        rule: "MODE-005",
        severity: sev,
        title:
          scope === "project"
            ? "The repository approves its own MCP servers"
            : scope === "local"
              ? "All of this project's MCP servers were approved"
              : "Every project's MCP servers are approved without asking",
        file: p.file,
        line: p.doc.lineOf(["enableAllProjectMcpServers"]),
        match: "enableAllProjectMcpServers: true",
        why:
          scope === "project"
            ? "Once you trust the folder, every server in .mcp.json starts without a prompt, including ones added in a later commit."
            : scope === "local"
              ? 'Claude Code writes this when you click "approve all". Servers added to .mcp.json later also start without a prompt.'
              : "Any repository you open can start the MCP servers in its .mcp.json without asking you first.",
        fix: "Remove the key and approve servers one by one, or list them in enabledMcpjsonServers in your local settings.",
      }),
    );
  }
  const enabled = strArr(get(v, "enabledMcpjsonServers"));
  if (enabled.length && scope === "project") {
    out.push(
      f({
        rule: "MODE-006",
        severity: "medium",
        title: "The repository pre-approves its own MCP servers",
        file: p.file,
        line: p.doc.lineOf(["enabledMcpjsonServers"]),
        match: `enabledMcpjsonServers: ${JSON.stringify(enabled).slice(0, 80)}`,
        why: "The repository approves servers it defines itself, so they can start without you choosing them.",
        fix: "Remove the key from the shared file. Each person approves servers in their own local settings.",
      }),
    );
  }
  return out;
}

function isHomeOrRoot(path: string, home: string): boolean {
  // Home written as a variable: %USERPROFILE%, $env:USERPROFILE, ${HOME}, %HOMEDRIVE%%HOMEPATH%.
  const p = toPosix(path.trim().replace(/^["']|["']$/g, ""))
    .toLowerCase()
    .replace(/^(?:%userprofile%|%homedrive%%homepath%|%home%|\$env:userprofile|\$env:home|\$\{home\}|\$home|\$\{env:userprofile\})(?=\/|$)/, "~")
    .replace(/\/+$/, "");
  const h = toPosix(home).toLowerCase().replace(/\/+$/, "");
  if (!path.trim()) return false;
  return p === "~" || p === "/" || p === "" || p === h || /^[a-z]:\/?$/.test(p) || /^\/\/?$/.test(p) || /^\/(mnt\/)?[a-z]$/.test(p) || /^\/users\/?$|^\/home\/?$|^[a-z]:\/users\/?$/.test(p);
}

function codexMode(m: Model): Finding[] {
  const out: Finding[] = [];
  // approval_policy = "never" anywhere at top level (user or project) applies to the session.
  const neverAnywhere = m.codex.some((p) => get(p.doc.value, "approval_policy") === "never");
  for (const p of m.codex) {
    const v = p.doc.value;
    const sandboxes: Array<{ path: string[]; never: boolean }> = [];
    if (get(v, "sandbox_mode") === "danger-full-access") sandboxes.push({ path: ["sandbox_mode"], never: neverAnywhere });
    const profiles = get(v, "profiles");
    if (isObj(profiles) && p.file.scope === "user") {
      for (const [name, prof] of Object.entries(profiles)) {
        if (get(prof, "sandbox_mode") === "danger-full-access") {
          const never = get(prof, "approval_policy") === "never" || (get(prof, "approval_policy") === undefined && neverAnywhere);
          sandboxes.push({ path: ["profiles", name, "sandbox_mode"], never });
        }
      }
    }
    for (const s of sandboxes) {
      out.push(
        f({
          rule: "MODE-007",
          severity: s.never ? "high" : "medium",
          title: s.never ? "Codex runs anything, anywhere, without asking" : "Codex has no sandbox",
          file: p.file,
          line: p.doc.lineOf(s.path),
          match: s.never ? 'sandbox_mode = "danger-full-access", approval_policy = "never"' : 'sandbox_mode = "danger-full-access"',
          why: s.never
            ? "Commands run with full disk and network access and Codex never stops to ask."
            : "Commands run with full disk and network access. Only the approval prompt stands between the agent and your machine.",
          fix: 'Use sandbox_mode = "workspace-write" and keep approval_policy = "on-request".',
        }),
      );
    }
    const projects = get(v, "projects");
    if (isObj(projects)) {
      for (const [path, entry] of Object.entries(projects)) {
        if (get(entry, "trust_level") === "trusted" && isHomeOrRoot(path, m.ctx.home)) {
          out.push(
            f({
              rule: "MODE-008",
              severity: "medium",
              title: "Codex trusts a whole home folder or drive",
              file: p.file,
              line: p.doc.lineOf(["projects", path, "trust_level"]),
              match: `[projects."${path}"] trust_level = "trusted"`,
              why: "Every repository under this folder is trusted, so their own .codex/config.toml files load without a prompt.",
              fix: "Trust specific project folders instead.",
            }),
          );
        }
      }
    }
  }
  return out;
}

export function checkMode(m: Model): Finding[] {
  return [...m.settings.flatMap(claudeMode), ...codexMode(m)];
}

export { isHomeOrRoot };
