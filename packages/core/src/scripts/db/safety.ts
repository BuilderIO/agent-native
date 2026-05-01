import { fail } from "../utils.js";

// Credential and identity tables are deliberately off-limits to the generic
// agent DB tools. They contain OAuth tokens, encrypted API keys, sessions, or
// auth identity data; use the framework stores/actions instead.
const SENSITIVE_FRAMEWORK_TABLE_RE =
  /\b(app_secrets|oauth_tokens|user|users|session|sessions|account|accounts|verification|jwks|organization|member|invitation|org_members|org_invitations|pg_catalog|information_schema|pg_class|pg_proc|pg_namespace|pg_user|pg_roles|pg_authid|pg_shadow)\b/i;

function stripSqlNonIdentifiers(sql: string): string {
  let out = "";
  let state: "normal" | "single" | "line-comment" | "block-comment" = "normal";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === "line-comment") {
      if (ch === "\n") {
        out += " ";
        state = "normal";
      }
      continue;
    }

    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        i++;
        out += " ";
        state = "normal";
      }
      continue;
    }

    if (state === "single") {
      if (ch === "'" && next === "'") {
        i++;
      } else if (ch === "'") {
        out += " ";
        state = "normal";
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      i++;
      state = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      i++;
      state = "block-comment";
      continue;
    }
    if (ch === "'") {
      state = "single";
      continue;
    }
    out += ch;
  }

  return out;
}

export function assertNoSensitiveFrameworkTables(
  sql: string,
  operation: "read" | "write" | "patch",
): void {
  const cleanSql = stripSqlNonIdentifiers(sql);
  const match = cleanSql.match(SENSITIVE_FRAMEWORK_TABLE_RE);
  if (!match) return;

  const verb =
    operation === "read"
      ? "readable"
      : operation === "write"
        ? "writable"
        : "patchable";
  fail(
    `Sensitive framework table "${match[1]}" is not ${verb} through raw DB tools. Use the framework auth, secrets, or OAuth APIs instead.`,
  );
}
