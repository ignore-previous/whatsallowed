import type { HookHandler, Model } from "../model.ts";
import { get, strArr } from "../parse.ts";
import { type ExecMatch, findExec, isLoopback, parseUrl } from "../patterns.ts";
import type { Finding } from "../types.ts";
import { make, scopeWord } from "./util.ts";

export const EXEC_RULE: Record<ExecMatch["kind"], string> = { remote: "001", encoded: "002", revshell: "003" };
export const EXEC_TITLE: Record<ExecMatch["kind"], string> = {
  remote: "downloads code and runs it",
  encoded: "runs an encoded payload",
  revshell: "opens a reverse shell",
};
export const EXEC_WHY: Record<ExecMatch["kind"], string> = {
  remote: "Whoever controls that address decides what runs on your machine, and it can change at any time without the config changing.",
  encoded: "Encoding hides what the command does from anyone reading the config. Legitimate setups rarely need it.",
  revshell: "This gives someone on another machine an interactive shell on yours.",
};

const originWord = (h: HookHandler): string =>
  h.origin === "hook" ? "hook" : h.origin === "notify" ? "Codex notify command" : `${h.origin} command`;

function checkCommand(h: HookHandler): Finding[] {
  if (!h.command) return [];
  const hit = findExec(h.command);
  if (!hit) return [];
  return [
    make("HOOK", {
      rule: `HOOK-${EXEC_RULE[hit.kind]}`,
      severity: "high",
      title: `A ${originWord(h)} ${EXEC_TITLE[hit.kind]}`,
      file: h.file,
      line: h.doc.lineOf(h.path),
      match: hit.match,
      why: `This ${originWord(h)} in a ${scopeWord(h.scope)} ${hit.form}. ${EXEC_WHY[hit.kind]}`,
      fix: "Download and review the script, commit it to the repository or your home folder, and run the local copy.",
    }),
  ];
}

const SECRET_NAME = /(?:api_?key|apikey|token|secret|passw(?:or)?d|pwd|credential|bearer|auth|session|cookie|private)/i;
const VAR_REF = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
const LITERAL_AUTH = /^(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}$/i;

/** allowedHttpHookUrls patterns use * as a wildcard. */
function urlAllowed(url: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(url));
}

function checkHttp(h: HookHandler, userAllow: string[]): Finding[] {
  if (!h.url) return [];
  const u = parseUrl(h.url);
  if (!u || isLoopback(u.hostname)) return [];
  const out: Finding[] = [];
  const line = h.doc.lineOf(h.path);
  const plain = u.protocol === "http:";
  const userOwned = h.scope === "user" || h.scope === "managed";
  const allowed = userOwned && !plain && urlAllowed(h.url, userAllow);

  const credVars = new Set<string>();
  const literal: string[] = [];
  for (const [name, value] of Object.entries(h.headers)) {
    for (const m of value.matchAll(VAR_REF)) if (m[1] && SECRET_NAME.test(m[1])) credVars.add(m[1]);
    if (LITERAL_AUTH.test(value.trim()) || (SECRET_NAME.test(name) && !value.includes("$") && value.length >= 16)) literal.push(name);
  }
  for (const v of h.allowedEnvVars) if (SECRET_NAME.test(v)) credVars.add(v);

  if (credVars.size || literal.length) {
    out.push(
      make("HTTPHOOK", {
        rule: "HTTPHOOK-002",
        severity: allowed ? "medium" : "high",
        title: "An HTTP hook sends a credential to another host",
        file: h.file,
        line,
        match: `${u.host}${credVars.size ? ` with ${[...credVars].join(", ")}` : ""}${literal.length ? ` with a literal ${literal.join(", ")} header` : ""}`,
        why: "Each matching event posts your session data to this host together with the credential, which the host can then use or store.",
        fix: "Send hook data to a local collector, or remove the credential from the headers.",
      }),
    );
  }
  const shared = !userOwned;
  if (shared || plain) {
    out.push(
      make("HTTPHOOK", {
        rule: "HTTPHOOK-001",
        severity: shared ? "high" : "medium",
        title: shared ? `A hook from a ${scopeWord(h.scope)} posts your session to another host` : "An HTTP hook sends session data unencrypted",
        file: h.file,
        line,
        match: h.url,
        why: shared
          ? `Hook events include prompts, file paths and tool output. A ${scopeWord(h.scope)} decides where they go${plain ? ", here over plain http" : ""}.`
          : "Hook events include prompts and tool output, and plain http lets anyone on the network path read them.",
        fix: shared ? "Remove the hook, or set allowedHttpHookUrls in your user settings to limit where hooks may post." : "Use https.",
      }),
    );
  } else if (!allowed) {
    out.push(
      make("HTTPHOOK", {
        rule: "HTTPHOOK-001",
        severity: "info",
        title: "An HTTP hook posts session events to another host",
        file: h.file,
        line,
        match: h.url,
        why: "You set this up in your own settings. Listing the host in allowedHttpHookUrls stops a repository adding others.",
        fix: `Add "${u.origin}/*" to allowedHttpHookUrls in your user settings.`,
      }),
    );
  }
  return out;
}

export function checkHooks(m: Model): Finding[] {
  const userAllow = m.settings
    .filter((p) => p.file.scope === "user" || p.file.scope === "managed")
    .flatMap((p) => strArr(get(p.doc.value, "allowedHttpHookUrls")));
  return m.handlers.flatMap((h) => (h.type === "command" ? checkCommand(h) : checkHttp(h, userAllow)));
}
