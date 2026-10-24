import { HELPER_KEYS, type Model, type Parsed, stringMap } from "../model.ts";
import { get, isObj } from "../parse.ts";
import { isLoopback, parseUrl } from "../patterns.ts";
import type { Finding } from "../types.ts";
import { make, mask } from "./util.ts";

const f = (x: Parameters<typeof make>[1]): Finding => make("ENDPOINT", x);

const ROUTE = /^(?:ANTHROPIC_(?:[A-Z]+_)?BASE_URL|CLAUDE_CODE_(?:[A-Z]+_)?BASE_URL|(?:HTTPS?|ALL)_PROXY)$/i;
const CREDENTIAL = /^(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_CUSTOM_HEADERS|ANTHROPIC_FOUNDRY_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|AWS_BEARER_TOKEN_BEDROCK|AWS_\w*(?:KEY|SECRET|TOKEN|PROFILE|CREDENTIAL)\w*|GOOGLE_APPLICATION_CREDENTIALS)$/i;
const PROVIDER = /^CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)$/i;

const truthy = (v: string): boolean => !/^(?:0|false|no|off|)$/i.test(v.trim());

function hostOf(value: string): string | undefined {
  const u = parseUrl(value) ?? parseUrl(`http://${value}`);
  return u?.hostname;
}

function checkFile(p: Parsed): Finding[] {
  const { scope } = p.file;
  if (scope !== "project" && scope !== "local") return [];
  const out: Finding[] = [];
  const local = scope === "local";
  const where = local ? "Your local project settings" : "The repository's settings";
  const env = stringMap(get(p.doc.value, "env"));
  const rawEnv = get(p.doc.value, "env");
  if (isObj(rawEnv)) {
    for (const [k, v] of Object.entries(rawEnv)) if (typeof v === "number" || typeof v === "boolean") env[k] = String(v);
  }
  for (const [key, value] of Object.entries(env)) {
    const line = p.doc.lineOf(["env", key]);
    if (ROUTE.test(key)) {
      const host = hostOf(value);
      const loop = host !== undefined && isLoopback(host);
      const proxy = /proxy/i.test(key);
      // A loopback address in a local file git ignores is the user's own local proxy or gateway.
      const ownLoopback = loop && local && p.file.gitIgnored === true;
      out.push(
        f({
          rule: "ENDPOINT-001",
          severity: ownLoopback ? "info" : loop || local ? "medium" : "high",
          title: ownLoopback
            ? `Your local project settings send requests to ${proxy ? "a proxy" : "an address"} on this machine`
            : proxy
              ? `${where} send your traffic through a proxy`
              : `${where} change where your requests go`,
          file: p.file,
          line,
          match: `${key}=${value}`,
          why: ownLoopback
            ? "This file is git-ignored and the address is on this machine, so it's most likely your own local proxy. Noted in case you didn't set it."
            : proxy
            ? "Every request Claude Code makes, including your prompts and code, passes through this proxy once you trust the folder."
            : "Your prompts, code and credentials are sent to this address instead of the provider you chose, once you trust the folder.",
          fix: ownLoopback
            ? "Nothing to do if you set it. Otherwise remove it from .claude/settings.local.json."
            : "Remove it from the project file. Set endpoints in your own user settings if you need them.",
        }),
      );
    } else if ((key === "NODE_TLS_REJECT_UNAUTHORIZED" && value.trim() === "0") || key === "NODE_EXTRA_CA_CERTS" || key === "NODE_OPTIONS") {
      out.push(
        f({
          rule: "ENDPOINT-001",
          severity: local ? "medium" : "high",
          title: key === "NODE_OPTIONS" ? `${where} change how Claude Code's runtime starts` : `${where} weaken TLS checks`,
          file: p.file,
          line,
          match: `${key}=${value}`,
          why:
            key === "NODE_OPTIONS"
              ? "NODE_OPTIONS can load extra code into Claude Code and the tools it starts."
              : "This lets a third party read or change encrypted traffic without a certificate error.",
          fix: "Remove it from the project file.",
        }),
      );
    } else if (CREDENTIAL.test(key) || (PROVIDER.test(key) && truthy(value))) {
      const cred = CREDENTIAL.test(key);
      out.push(
        f({
          rule: "ENDPOINT-002",
          severity: local ? "medium" : "high",
          title: cred ? `${where} set which credentials Claude Code uses` : `${where} switch your model provider`,
          file: p.file,
          line,
          match: cred ? `${key}=${mask(value)}` : `${key}=${value}`,
          masked: cred,
          why: cred
            ? "A repository that supplies credentials or auth headers decides which account your requests are billed to and logged under."
            : "Requests go to a different cloud provider and account than the one you set up.",
          fix: "Remove it from the project file and keep credentials in your own environment or user settings.",
        }),
      );
    }
  }
  for (const key of HELPER_KEYS) {
    const cmd = get(p.doc.value, key);
    if (typeof cmd !== "string" || !cmd.trim()) continue;
    out.push(
      f({
        rule: "ENDPOINT-003",
        severity: local ? "medium" : "high",
        title: `${where} set a credential helper command`,
        file: p.file,
        line: p.doc.lineOf([key]),
        match: `${key}: ${cmd}`,
        why: `${key} runs a command to produce your credentials or auth headers, so the project controls what runs and what gets sent.`,
        fix: "Remove it from the project file. Set helpers in your own user settings.",
      }),
    );
  }
  const sl = get(p.doc.value, "statusLine");
  if (!local && isObj(sl) && typeof sl.command === "string") {
    out.push(
      f({
        rule: "ENDPOINT-004",
        severity: "info",
        title: "The repository sets a status line command",
        file: p.file,
        line: p.doc.lineOf(["statusLine"]),
        match: `statusLine: ${sl.command}`,
        why: "This command runs often in the background once you trust the folder. Check what it does.",
        fix: "Remove it if you don't recognise it.",
      }),
    );
  }
  return out;
}

export function checkEndpoint(m: Model): Finding[] {
  return m.settings.flatMap(checkFile);
}
