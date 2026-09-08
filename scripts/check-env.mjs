/**
 * Environment preflight: `npm run check-env`
 *
 * Reports whether each variable is filled and structurally valid, and never
 * prints a value — the output is safe to paste into an issue or a chat window.
 *
 * Reads .env.local then .env, matching the precedence Next.js and
 * prisma.config.ts both use.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";

/** Routable = neither loopback nor link-local (fe80::). */
const hasRoutableIPv6 = Object.values(os.networkInterfaces())
  .flat()
  .some((i) => i && i.family === "IPv6" && !i.internal && !i.address.startsWith("fe80"));

const FILES = [".env.local", ".env"];

function parse(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = {};
const found = [];
// Later files must not override earlier ones — .env.local wins, as in Next.
for (const file of FILES) {
  if (!existsSync(file)) continue;
  found.push(file);
  for (const [k, v] of Object.entries(parse(file))) {
    if (!(k in env)) env[k] = v;
  }
}

if (found.length === 0) {
  console.error("No .env.local or .env found. Start with:  cp .env.example .env.local");
  process.exit(1);
}

const problems = [];
const notes = [];

/** Values copied straight out of .env.example, which are never valid. */
const TEMPLATE_VALUES = new Set([
  "sb_publishable_...",
  "https://<project-ref>.supabase.co",
  "claude-opus-5-placeholder",
]);

function check(name, { required = true, validate } = {}) {
  const raw = env[name];
  if (raw === undefined) {
    if (required) problems.push(`${name}: missing`);
    else notes.push(`${name}: not set (optional)`);
    return;
  }
  if (raw === "") {
    if (required) problems.push(`${name}: empty`);
    else notes.push(`${name}: empty (optional)`);
    return;
  }
  if (/[<>]/.test(raw) || TEMPLATE_VALUES.has(raw)) {
    problems.push(`${name}: still the .env.example placeholder`);
    return;
  }
  const failure = validate?.(raw, name);
  if (failure) problems.push(`${name}: ${failure}`);
  else console.log(`  ok    ${name}`);
}

/**
 * Names *why* a connection string will not parse. `new URL` throws one opaque
 * "Invalid URL" for every cause, so this narrows it to something actionable —
 * without echoing the string, which contains the password.
 */
function diagnoseUrl(raw) {
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    return "does not start with postgresql:// — paste the whole URI, not just the host, and not the `psql ...` command wrapped around it";
  }
  const rest = raw.slice(raw.indexOf("//") + 2);
  const at = rest.lastIndexOf("@");
  if (at === -1) return "has no @ between the password and the host";
  const userinfo = rest.slice(0, at);
  const colon = userinfo.indexOf(":");
  const password = colon === -1 ? "" : userinfo.slice(colon + 1);
  const offenders = ["#", "/", "?"].filter((c) => password.includes(c));
  if (offenders.length > 0) {
    return (
      `password contains ${offenders.join(" ")} — percent-encode it ` +
      "(# → %23, / → %2F, ? → %3F), or reset the database password to letters and digits only"
    );
  }
  return "not a parseable URL — the simplest fix is to reset the database password to letters and digits only, then rebuild the string";
}

function isPostgresUrl(expectedPort) {
  return (raw, name) => {
    // Supabase renders the password as [YOUR-PASSWORD]; square brackets are URL
    // syntax for IPv6 hosts and will not parse in the password position.
    if (/[[\]]/.test(raw)) {
      return "contains square brackets — replace Supabase's [YOUR-PASSWORD] placeholder, brackets included, with the real password";
    }
    if (/\s/.test(raw)) {
      return "contains a space or line break — it must be on one line, in quotes";
    }
    let url;
    try {
      url = new URL(raw);
    } catch {
      return diagnoseUrl(raw);
    }
    if (!url.protocol.startsWith("postgres")) {
      return `scheme is "${url.protocol}", expected postgresql:`;
    }
    if (!url.password) return "no password in the URL";
    // node-postgres defaults the database name to the *username* when the URL
    // carries no path. Against Supabase that surfaces at query time as
    // P1003 `Database "postgres.<ref>" does not exist`, which looks like a
    // missing database rather than a missing path segment.
    if (url.pathname === "" || url.pathname === "/") {
      return "has no database name — the URL must end with /postgres before the ?, or node-postgres uses the username as the database and every query fails with P1003";
    }
    if (url.pathname !== "/postgres") {
      notes.push(`${name}: database is "${url.pathname.slice(1)}", not "postgres" — unusual on Supabase`);
    }
    // The poolers authenticate as postgres.<project-ref>. A bare `postgres`
    // there fails at connect time with "Tenant or user not found", which reads
    // like a database problem rather than a typo.
    if (url.hostname.endsWith("pooler.supabase.com") && !url.username.includes(".")) {
      return 'pooler username must be "postgres.<project-ref>", not plain "postgres" — copy the pooler string from Supabase → Connect instead of editing the direct one';
    }
    // Supabase's direct host publishes an AAAA record and no A record. On an
    // IPv4-only network it does not resolve at all, and Prisma reports this as
    // P1001 "can't reach database server", which reads like an outage.
    if (/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname) && !hasRoutableIPv6) {
      return (
        "uses Supabase's direct host, which is IPv6-only, and this machine has no " +
        "routable IPv6 address — it can only fail with P1001. Switch to the pooler: " +
        "aws-N-<region>.pooler.supabase.com, port 6543 for DATABASE_URL and 5432 for DIRECT_URL"
      );
    }
    if (expectedPort && url.port && url.port !== expectedPort) {
      notes.push(
        `${name}: port ${url.port}, expected ${expectedPort} ` +
          `(${expectedPort === "6543" ? "the transaction pooler, for the app" : "5432, for migrations"})`,
      );
    }
    if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
      notes.push(`${name}: on the pooler without ?pgbouncer=true&connection_limit=1 appended`);
    }
    // One @ separates userinfo from host; a second means a literal @ was left
    // unencoded in the password, which parses but authenticates as the wrong one.
    if ((raw.match(/@/g) ?? []).length > 1) {
      notes.push(`${name}: more than one @ — a literal @ inside the password must be written %40`);
    }
    return null;
  };
}

console.log(`Reading: ${found.join(", ")}\n`);

check("DATABASE_URL", { validate: isPostgresUrl("6543") });
check("DIRECT_URL", { validate: isPostgresUrl("5432") });

check("NEXT_PUBLIC_SUPABASE_URL", {
  validate: (raw) => (raw.startsWith("https://") ? null : "should start with https://"),
});
check("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", {
  validate: (raw) =>
    raw.startsWith("sb_secret") || raw.startsWith("service_role")
      ? "this looks like the SERVICE ROLE key. Use the publishable key — the secret key must never reach the browser"
      : null,
});
check("NEXT_PUBLIC_SITE_URL");

check("MEDIA_MASTER_KEY", {
  validate: (raw) => {
    const bytes = Buffer.from(raw, "base64").length;
    return bytes === 32
      ? null
      : `decodes to ${bytes} bytes, must be exactly 32. Generate with: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`;
  },
});
check("CRON_SECRET", {
  validate: (raw) => (raw.length >= 16 ? null : "shorter than 16 characters; use something random"),
});

const driver = env.STORAGE_DRIVER ?? "archive";
check("STORAGE_DRIVER", {
  validate: (raw) => (raw === "archive" || raw === "disk" ? null : 'must be "archive" or "disk"'),
});
// IA keys only matter when the archive driver is actually selected.
check("IA_ACCESS_KEY", { required: driver === "archive" });
check("IA_SECRET_KEY", { required: driver === "archive" });
check("IA_ITEM_PREFIX", { required: false });

// Optional locally, where the three writable directories default to the working
// directory. On a host it has to point at a mounted volume: a container filesystem
// is wiped on every deploy, and the spool is the only copy of ciphertext the
// archive has not accepted yet.
check("DATA_DIR", {
  required: false,
  validate: (raw, name) => {
    if (!existsSync(raw)) {
      notes.push(
        `${name}: does not exist yet — it is created on first write, so check it ` +
          "against the volume's mount path rather than assuming it took",
      );
    }
    return null;
  },
});

check("ANTHROPIC_API_KEY", { required: false });
// A gateway in front of the API, if there is one. Two ways to set this and get
// silence rather than an error, so both are named.
check("ANTHROPIC_BASE_URL", {
  required: false,
  validate: (raw, name) => {
    if (!/^https?:\/\//i.test(raw)) return "should start with http:// or https://";
    if (/\/v1\/?$/.test(raw)) {
      return "ends in /v1 — the path is appended for you, so every call would ask for /v1/v1/... . Use the origin only";
    }
    if (!env.ANTHROPIC_API_KEY) {
      notes.push(
        `${name}: set without ANTHROPIC_API_KEY — the bot never builds a client, so nothing is sent here`,
      );
    }
    return null;
  },
});
check("BAKCHOD_MODEL", { required: false });

// A TURN relay is optional — without one, calls between two networks that STUN
// cannot pair simply fail to connect. Relays almost never allow anonymous
// allocations, so a URL with no credentials beside it is worth naming.
check("TURN_URL", {
  required: false,
  validate: (raw, name) => {
    if (!/^turns?:/i.test(raw)) return "should start with turn: or turns:";
    if (!env.TURN_USERNAME || !env.TURN_CREDENTIAL) {
      notes.push(
        `${name}: set without TURN_USERNAME and TURN_CREDENTIAL — most relays refuse the allocation`,
      );
    }
    return null;
  },
});
check("TURN_USERNAME", { required: false });
check("TURN_CREDENTIAL", { required: false });

if (notes.length > 0) {
  console.log("\nNotes:");
  for (const n of notes) console.log(`  - ${n}`);
}

if (problems.length > 0) {
  console.log("\nNot ready yet:");
  for (const p of problems) console.log(`  x ${p}`);
  console.log(`\n${problems.length} to fix. See the comments in .env.example.`);
  process.exit(1);
}

console.log("\nAll set. Next:  npx prisma migrate deploy && npm run dev");
