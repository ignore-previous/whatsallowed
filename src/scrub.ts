// Hides anything that could be a credential before text is shown or saved: rules, commands, addresses and
// the match and fix lines of findings.

/** Longest text shown for a rule, package or command; longer ones are cut. */
export const MAX_SHOWN = 300;

/** Words in a name that mark it as holding a credential. Other NAME=value pairs (CC=gcc, NODE_ENV=test) stay readable. */
const CREDENTIAL_WORD = "token|secret|passw|pwd|passphrase|(?<!by)pass|key|auth|cred|bearer|cookie|session|signature|jwt|private|dsn|salt|otp|webhook|(?<![a-z])pat(?![a-z])";

/** A quoted value (cut off or not) or a bare one. Every repeat is bounded or stops at a character the pattern can't skip. */
const VALUE = String.raw`"[^"]{0,200}"?|'[^']{0,200}'?|[^\s'")]+`;

// Case-sensitive on purpose: -P is a port (mysql) or a prompt (sshpass), and the password -p can come after it.
const LOGIN_P = new RegExp(String.raw`(\s-p(?:=|\s{0,5}))(?:${VALUE})`, "g");
const SSHPASS_P = new RegExp(String.raw`(\bsshpass\b[^|;&\n]{0,60}?\s-p(?:=|\s{0,5}))(?:${VALUE})`, "g");
// A lookbehind, so every attached -pPASSWORD after the command name is hidden, not only the first. A bare
// "-p" (mysql asks for the password) or "-p word" (the word is a database name) is not a password.
const MYSQL_P = new RegExp(String.raw`(?<=\b(?:mysql|mysqldump|mysqladmin|mysqlimport|mysqlcheck|mariadb|mariadb-dump)\b[^|;&\n]{0,500}\s-p)(?!\s)(?:${VALUE})`, "g");

// Options whose name contains a credential word but whose next word is not a secret: flags that take no value
// (--password-stdin, --passWithNoTests) and --author. Anything not listed here is still hidden.
const LONG_FLAG = new RegExp(
  String.raw`(?!--?(?:[A-Za-z-]{0,60}-stdin|authors?|passthrough|pass-through|passwithnotests|pass-with-no-tests)(?![A-Za-z-]))(--?[A-Za-z-]{0,30}(?:token|key|secret|passw(?:or)?d|pass|auth)[A-Za-z-]{0,30})([=\s]\s{0,5})([^\s'")*]+)`,
  "gi",
);
// Only credential-like names match. A value that is not hidden is left unconsumed, so a credential inside it is still found.
const ASSIGNMENT = new RegExp(String.raw`(^|[\s('"?&:;,])((?=[A-Za-z0-9_]{0,63}?(?:${CREDENTIAL_WORD}))[A-Za-z_][A-Za-z0-9_]{0,63})=("[^"]{0,200}"?|'[^']{0,200}'?|[^\s'")&]+)`, "gi");

const TOKEN_SHAPES = new RegExp(
  [
    "sk-[A-Za-z0-9_-]{16,}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "xox[abprs]-[A-Za-z0-9-]{10,}",
    "(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{30,}",
    "glpat-[A-Za-z0-9_-]{20,}",
    "(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "npm_[A-Za-z0-9]{30,}",
    "hf_[A-Za-z0-9]{30,}",
    String.raw`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
  ].join("|"),
  "g",
);

/**
 * Hide anything in a rule, command or finding that could be a credential: values of NAME=value assignments
 * where the name looks like a credential (quoted or not, and query parameters), Bearer and Basic tokens, auth
 * and API-key header values, values of --token/--key/--password style flags (except ones that take no value, such as --password-stdin), the password after a login's -p,
 * sshpass -p or any attached mysql -pPASSWORD, user:password after -u or --user, keys in well-known token
 * formats, and the user and password part of an address.
 */
export function scrub(text: string, limit = MAX_SHOWN): string {
  // Long text is cut first, and every repeat in the patterns below is bounded, so a hostile rule can't make
  // the scan slow.
  const t = text.length > limit ? `${text.slice(0, limit)}…` : text;
  return t
    .replace(/\b(Authorization|Proxy-Authorization|[A-Za-z-]{0,30}Api-Key|X-[A-Za-z-]{0,30}Token)(\s{0,5}:\s{0,5})[^'")]+/gi, "$1$2•••")
    .replace(/\b(Bearer|Basic)\s{1,5}[^\s'")]+/gi, "$1 •••")
    .replace(ASSIGNMENT, "$1$2=•••")
    .replace(LONG_FLAG, "$1$2•••")
    // Commands where -p is a password: "docker login -p pw", "sshpass -p pw", "mysql -ppw". Elsewhere -p is
    // something else (npx -p pkg, mkdir -p dir), so it is left alone.
    .replace(/\blogin\b[^|;&\n]{0,150}/gi, (seg) => seg.replace(LOGIN_P, "$1•••"))
    .replace(SSHPASS_P, "$1•••")
    .replace(MYSQL_P, "•••")
    .replace(/((?:^|\s)(?:-u|--user)[=\s]\s{0,5}[^\s:'"]{1,100}:)[^\s'")]+/g, "$1•••")
    .replace(/(\/\/)[^/\s@]{1,200}@/g, "$1•••@")
    // An address cut off by the length limit before its "@" may still be holding a password.
    .replace(/(\/\/)[^/\s@]{1,200}…$/, "$1•••…")
    .replace(TOKEN_SHAPES, "•••");
}
