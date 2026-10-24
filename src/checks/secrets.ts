import type { Model } from "../model.ts";
import { get, isObj, type PathSeg } from "../parse.ts";
import type { ConfigFile, Finding, Scope } from "../types.ts";
import type { Doc } from "../parse.ts";
import { make, mask } from "./util.ts";

interface Format {
  name: string;
  re: RegExp;
  /** Index of the random part's group for the entropy test; 0 = whole match. */
  minEntropy?: number;
}

/** Provider key formats. Order matters: specific prefixes before general ones. */
const FORMATS: Format[] = [
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9]{3,8}\d{0,3}-[A-Za-z0-9_-]{20,}/ },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{24,}/ },
  { name: "OpenAI API key", re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI API key", re: /\bsk-(?!ant-)[A-Za-z0-9]{32,}\b/ },
  { name: "AWS access key ID", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub token", re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: "private key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
];

const SECRET_KEY_NAME = /(?:api[_-]?key|apikey|access[_-]?key|secret|token|passw(?:or)?d|pwd|credential|auth(?:orization)?|bearer|private[_-]?key|client[_-]?secret|session[_-]?key)/i;

const PLACEHOLDER = /x{4,}|X{4,}|\*{3,}|\.{3}|…|<[^>]*>|\{\{|\$\{|^\$|your[_-]?|_here\b|here$|example|sample|changeme|change[_-]me|placeholder|dummy|redacted|replace[_-]?me|insert|todo|(.)\1{7,}|^0+$|1234567/i;

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export const isPlaceholder = (v: string): boolean => PLACEHOLDER.test(v);

export interface SecretHit {
  kind: string;
  value: string;
}

/** Find a provider-format credential in free text. */
export function findFormat(text: string): SecretHit | undefined {
  for (const fmt of FORMATS) {
    const m = fmt.re.exec(text);
    if (!m) continue;
    const v = m[0];
    if (fmt.name === "private key") return { kind: fmt.name, value: v };
    if (isPlaceholder(v)) continue;
    const tail = v.replace(/^[a-z]+[-_](?:[a-z]+[-_])?/i, "");
    if (entropy(tail) < 3.0) continue;
    return { kind: fmt.name, value: v };
  }
  return undefined;
}

/** A long random-looking value stored under a key or token name. */
export function looksRandomSecret(value: string): boolean {
  const v = value.trim().replace(/^(?:Bearer|Basic|Token)\s+/i, "");
  if (v.length < 20 || /\s/.test(v) || isPlaceholder(v)) return false;
  if (/^[a-z]+:\/\//i.test(v) || v.startsWith("/") || /^[A-Za-z]:[\\/]/.test(v)) return false;
  if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;
  return entropy(v) >= 3.5;
}

/** Check one key/value pair (env var or header). */
export function secretInValue(name: string, value: string): SecretHit | undefined {
  const hit = findFormat(value);
  if (hit) return hit;
  if (SECRET_KEY_NAME.test(name) && looksRandomSecret(value)) return { kind: `value of ${name}`, value: value.trim() };
  return undefined;
}

const sevFor = (scope: Scope): "high" | "medium" => (scope === "project" || scope === "plugin" ? "high" : "medium");

function finding(file: ConfigFile, line: number, hit: SecretHit, where: string, severity: "high" | "medium"): Finding {
  return make("SECRET", {
    rule: where === "instructions" ? "SECRET-001" : "SECRET-002",
    severity,
    title: where === "instructions" ? `A ${hit.kind} is written into an instruction file` : `A ${hit.kind} is stored in plain text in ${where}`,
    file,
    line,
    match: `${hit.kind}: ${mask(hit.value)}`,
    why:
      where === "instructions"
        ? "Instruction files are sent to the model with every request and are often committed and shared, so the key leaks to everyone who sees them."
        : "Anyone who can read this file, or a backup or dotfiles repo that copies it, gets the credential.",
    fix:
      where === "instructions"
        ? "Remove it, rotate the key, and tell the agent to read it from an environment variable instead."
        : "Rotate the key and reference it instead, for example ${API_KEY}, so the value stays in your environment.",
  });
}

function scanPairs(file: ConfigFile, doc: Doc, obj: unknown, path: PathSeg[], where: string, severity: "high" | "medium", out: Finding[]): void {
  if (!isObj(obj)) return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    const hit = secretInValue(k, v);
    if (hit) out.push(finding(file, doc.lineOf([...path, k]), hit, where, severity));
  }
}

function scanInstructions(file: ConfigFile): Finding[] {
  const out: Finding[] = [];
  const lines = (file.text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    let hit = findFormat(line);
    if (!hit) {
      const kv = /(?:^|[\s"'`])([A-Za-z_][A-Za-z0-9_.-]*)["'`]?\s*[:=]\s*["'`]?([^\s"'`]{20,})/.exec(line);
      if (kv?.[1] && kv[2] && SECRET_KEY_NAME.test(kv[1]) && looksRandomSecret(kv[2])) hit = { kind: `value of ${kv[1]}`, value: kv[2] };
      const bearer = /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/.exec(line);
      if (!hit && bearer?.[1] && looksRandomSecret(bearer[1])) hit = { kind: "bearer token", value: bearer[1] };
    }
    if (hit) out.push(finding(file, i + 1, hit, "instructions", "high"));
  }
  return out;
}

export function checkSecrets(m: Model): Finding[] {
  const out: Finding[] = [];
  for (const f of m.ctx.files) if (f.kind === "instructions") out.push(...scanInstructions(f));
  for (const s of m.servers) {
    const sev = sevFor(s.scope);
    for (const block of ["env", "headers", "http_headers"]) {
      scanPairs(s.file, s.doc, get(s.def, block), [...s.base, block], `an MCP server's ${block}`, sev, out);
    }
  }
  for (const p of m.settings) {
    scanPairs(p.file, p.doc, get(p.doc.value, "env"), ["env"], "a settings env block", sevFor(p.file.scope), out);
  }
  return out;
}
