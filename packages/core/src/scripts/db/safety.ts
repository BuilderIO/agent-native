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

const ACCESS_CONTROL_TABLE_TOKENS = new Set([
  "acl",
  "access",
  "admin",
  "admins",
  "grant",
  "grants",
  "invitation",
  "invitations",
  "invite",
  "invites",
  "member",
  "members",
  "permission",
  "permissions",
  "privilege",
  "privileges",
  "role",
  "roles",
  "user",
  "users",
]);

const ACCESS_CONTROL_COLUMN_TOKENS = new Set([
  "access",
  "access_level",
  "acl",
  "admin",
  "admins",
  "grant",
  "grants",
  "is_admin",
  "is_owner",
  "member",
  "members",
  "owner",
  "owner_email",
  "permission",
  "permissions",
  "privilege",
  "privileges",
  "role",
  "roles",
]);

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/^["'`\[]/, "")
    .replace(/["'`\]]$/, "")
    .toLowerCase();
}

function identifierTokens(identifier: string): Set<string> {
  const normalized = normalizeIdentifier(identifier);
  const tokens = new Set<string>([normalized]);
  for (const token of normalized.split(/[^a-z0-9]+/).filter(Boolean)) {
    tokens.add(token);
  }
  return tokens;
}

function hasSensitiveToken(
  identifier: string,
  sensitiveTokens: Set<string>,
): string | null {
  for (const token of identifierTokens(identifier)) {
    if (sensitiveTokens.has(token)) return token;
  }
  return null;
}

function tableNameFromWriteSql(sql: string): string | null {
  const match = sql.match(
    /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+((?:"[^"]+"|'[^']+'|`[^`]+`|[\w]+)(?:\s*\.\s*(?:"[^"]+"|'[^']+'|`[^`]+`|[\w]+))?)/i,
  );
  if (!match) return null;
  return normalizeIdentifier(match[1].split(".").pop() ?? match[1]);
}

function splitColumnList(columns: string): string[] {
  return columns
    .split(",")
    .map((column) => normalizeIdentifier(column))
    .filter(Boolean);
}

function insertColumnsFromSql(sql: string): string[] {
  const match = sql.match(
    /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE(?:\s+OR\s+\w+)?\s+INTO)\s+(?:"[^"]+"|'[^']+'|`[^`]+`|[\w]+)(?:\s*\.\s*(?:"[^"]+"|'[^']+'|`[^`]+`|[\w]+))?\s*\(([^)]+)\)/i,
  );
  return match ? splitColumnList(match[1]) : [];
}

function updateColumnsFromSql(sql: string): string[] {
  const setMatch = /\bSET\b/i.exec(sql);
  if (!setMatch) return [];
  const tail = sql.slice(setMatch.index + setMatch[0].length);
  const endMatch = /\b(?:WHERE|RETURNING)\b/i.exec(tail);
  const setClause = endMatch ? tail.slice(0, endMatch.index) : tail;
  const columns: string[] = [];
  const columnRe =
    /(?:^|,)\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = columnRe.exec(setClause)) !== null) {
    columns.push(
      normalizeIdentifier(match[1] ?? match[2] ?? match[3] ?? match[4]),
    );
  }
  return columns;
}

function writeColumnsFromSql(sql: string): string[] {
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith("UPDATE")) return updateColumnsFromSql(sql);
  if (upper.startsWith("INSERT") || upper.startsWith("REPLACE")) {
    return insertColumnsFromSql(sql);
  }
  return [];
}

export function assertNoRawDbAccessControlWrite(sql: string): void {
  const tableName = tableNameFromWriteSql(sql);
  if (tableName) {
    const tableToken = hasSensitiveToken(
      tableName,
      ACCESS_CONTROL_TABLE_TOKENS,
    );
    if (tableToken) {
      fail(
        `Sensitive identity/access-control table "${tableName}" is not writable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
      );
    }
  }

  for (const column of writeColumnsFromSql(sql)) {
    const columnToken = hasSensitiveToken(column, ACCESS_CONTROL_COLUMN_TOKENS);
    if (!columnToken) continue;
    fail(
      `Sensitive identity/access-control column "${column}" is not writable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
    );
  }
}

export function assertNoRawDbAccessControlPatchTarget(
  table: string,
  column: string,
): void {
  const tableName = normalizeIdentifier(table);
  if (hasSensitiveToken(tableName, ACCESS_CONTROL_TABLE_TOKENS)) {
    fail(
      `Sensitive identity/access-control table "${tableName}" is not patchable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
    );
  }
  const columnName = normalizeIdentifier(column);
  if (hasSensitiveToken(columnName, ACCESS_CONTROL_COLUMN_TOKENS)) {
    fail(
      `Sensitive identity/access-control column "${columnName}" is not patchable through raw DB tools. Use a dedicated app action or implement the permission change in reviewed code.`,
    );
  }
}
