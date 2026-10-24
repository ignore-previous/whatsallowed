// Fake keys in the labelled cases are stored split, so no file in the repo holds a string in a real
// provider format (secret scanners, including GitHub push protection, would flag it). The marker sits
// straight after the provider prefix; loaders remove it before scanning or hashing.
export const SPLIT = "@@SPLIT@@";

export const assemble = (text) => text.replaceAll(SPLIT, "");

/** Real provider key formats, close to what public secret scanners look for. Each has its prefix as group 1. */
export const KEY_PATTERNS = [
  /(sk-ant-(?:api|admin|oat)\d{2}-)[A-Za-z0-9_-]{20,}/g,
  /(sk-ant-)[A-Za-z0-9_-]{24,}/g,
  /(sk-(?:proj|svcacct|admin)-)[A-Za-z0-9_-]{20,}/g,
  /\b(sk-)(?!ant-|proj-|svcacct-|admin-)[A-Za-z0-9]{32,}/g,
  /\b((?:AKIA|ASIA|ABIA|ACCA))[A-Z0-9]{16}/g,
  /\b(gh[pousr]_)[A-Za-z0-9]{30,}/g,
  /\b(github_pat_)[A-Za-z0-9_]{22,}/g,
  /\b(glpat-)[A-Za-z0-9_-]{20,}/g,
  /\b(xox[abposr]-)[A-Za-z0-9-]{10,}/g,
  /\b((?:sk|rk)_(?:live|test)_)[A-Za-z0-9]{16,}/g,
  /\b(AIza)[0-9A-Za-z_-]{35}/g,
  /\b(npm_)[A-Za-z0-9]{36}/g,
  /\b(hf_)[A-Za-z0-9]{30,}/g,
  /(-----BEGIN )(?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
];

/** Insert the marker after the prefix of every real-format key in the text. Idempotent. */
export function splitKeys(text) {
  let out = text;
  for (const re of KEY_PATTERNS) out = out.replace(re, (m, prefix) => prefix + SPLIT + m.slice(prefix.length));
  return out;
}

/** Real-format keys left in the text (after assembling nothing: the raw file as stored). */
export function findRealFormatKeys(text) {
  const hits = [];
  for (const re of KEY_PATTERNS) for (const m of text.matchAll(re)) hits.push(m[0].slice(0, 12) + "…");
  return hits;
}
