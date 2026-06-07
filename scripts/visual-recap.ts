#!/usr/bin/env node
/**
 * PR "visual recap" generator — the reverse-plan engine.
 *
 * Turns a unified git diff into a structured Agent-Native Plan (an MDX folder),
 * publishes it to the hosted plan app via the HTTP action surface, sets org
 * visibility, and prints `{ planId, url, path }` (or a `{ suppressed }` object)
 * as JSON on stdout for the workflow to consume.
 *
 * GROUNDED-BY-CONSTRUCTION: every block is derived from the actual diff text we
 * were handed. We never invent file names, schema fields, or endpoints — the
 * blocks describe exactly what the diff contains, so the recap cannot lie.
 *
 * No third-party deps: Node 22 built-ins + global fetch only.
 *
 * Required args:
 *   --diff <path>     File containing the unified `git diff` output.
 *   --pr <number>     PR number (for the title).
 *   --app-url <url>   Hosted plan app base, e.g. https://plan.agent-native.com
 *   --token <token>   Bearer token minted by `agent-native connect`.
 * Optional args:
 *   --stat <path>     File containing `git diff --stat` (for the summary).
 *   --head <sha>      Head commit SHA (stamped in the summary).
 *   --huge            Diff exceeded the size cap; emit a summarized variant.
 *   --prev-plan-id <id>  Existing hosted plan to REPLACE (so a re-push updates
 *                        the same plan instead of creating a new one).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/* -------------------------------------------------------------------------- */
/* Tiny manual arg parser (no dep)                                            */
/* -------------------------------------------------------------------------- */

/** @returns {Record<string, string | boolean>} */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Output helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Print one JSON object on stdout and exit 0. This is the script's contract. */
function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(0);
}

/** Fatal: print a JSON error and exit non-zero so the workflow can branch. */
function fail(reason, extra = {}) {
  process.stdout.write(`${JSON.stringify({ error: reason, ...extra })}\n`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Secret redaction — abort if the diff looks like it leaks credentials       */
/* -------------------------------------------------------------------------- */

/**
 * If the diff contains anything that looks like a real secret, we refuse to
 * build a recap at all (rather than risk echoing it into a public-ish plan).
 * These patterns intentionally err toward caution. We scan added, removed, and
 * context lines so deleting a real secret does not publish it in a split diff.
 */
const SECRET_PATTERNS = [
  // Common provider key prefixes.
  /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  // Bearer / Authorization header values with an actual token.
  /authorization\s*[:=]\s*['"]?bearer\s+[A-Za-z0-9._-]{12,}/i,
  // Private key blocks.
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  // `KEY=...`, `TOKEN=...`, `SECRET=...`, `PASSWORD=...` assigned a real-looking
  // value (long, non-placeholder). Placeholders like <your-key> / xxxx / ***
  // / example are allowed.
  /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[:=]\s*['"]?(?!.*(?:your|example|placeholder|changeme|xxxx|\*\*\*|<|\$\{|process\.env|env\.|REDACTED))[A-Za-z0-9/_+=.-]{16,}/i,
];

/** A single source line (file path or +/context body) that trips a pattern. */
export function lineLooksSecret(line) {
  return SECRET_PATTERNS.some((re) => re.test(line));
}

export function diffContainsSecret(diffText) {
  for (const line of diffText.split("\n")) {
    // Scan every line shape the recap can emit into a block. Removed (-) lines
    // matter too: deleting a real secret must not publish it in the split diff.
    if (
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ") ||
      line.startsWith("+++") ||
      line.startsWith("---")
    ) {
      if (lineLooksSecret(line)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* MDX encoding — mirror packages/core .../blocks/mdx.ts `prop()` exactly      */
/* so the plan.mdx we emit round-trips through the hosted parser unchanged.    */
/* -------------------------------------------------------------------------- */

function escapeAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function jsonExpression(value) {
  return JSON.stringify(value, null, 2);
}

/** Encode a single MDX attribute. Byte-compatible with core's `prop()`. */
function prop(name, value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean")
    return value ? ` ${name}` : ` ${name}={false}`;
  if (typeof value === "number") return ` ${name}={${value}}`;
  if (typeof value === "string") {
    if (/^[\w .:/@#,+()[\]-]+$/.test(value) && value.length < 140) {
      return ` ${name}="${escapeAttr(value)}"`;
    }
    return ` ${name}={${jsonExpression(value)}}`;
  }
  return ` ${name}={${jsonExpression(value)}}`;
}

/* -------------------------------------------------------------------------- */
/* Block builders — emit the exact MDX tags the hosted parser registers        */
/* (see packages/core/src/client/blocks/library/*.config.ts + plan-mdx.ts).    */
/* -------------------------------------------------------------------------- */

let blockSeq = 0;
function blockId(prefix) {
  blockSeq += 1;
  return `${prefix}-${blockSeq}`;
}

/** <RichText> markdown prose </RichText> */
function richText(markdown, title) {
  const id = blockId("rt");
  return `<RichText${prop("id", id)}${prop("title", title)}>\n\n${markdown.trim()}\n\n</RichText>`;
}

/** <FileTree title entries={[...]} /> */
function fileTree(title, entries) {
  const id = blockId("tree");
  return `<FileTree${prop("id", id)}${prop("title", title)}${prop("entries", entries)} />`;
}

/** <Diff filename language mode before after /> */
function diffBlock({ filename, language, mode, before, after }) {
  const id = blockId("diff");
  return `<Diff${prop("id", id)}${prop("filename", filename)}${prop("language", language)}${prop("mode", mode)}${prop("before", before)}${prop("after", after)} />`;
}

/** <DataModel entities={[...]} relations={[...]} /> */
function dataModel(entities, relations, title) {
  const id = blockId("dm");
  return `<DataModel${prop("id", id)}${prop("title", title)}${prop("entities", entities)}${prop("relations", relations)} />`;
}

function nestedBlockMdx(block) {
  if (block.type === "rich-text") {
    return String(block.data?.markdown ?? "").trim();
  }
  if (block.type === "data-model") {
    return dataModel(
      block.data?.entities ?? [],
      block.data?.relations,
      block.title,
    );
  }
  return richText(
    "Unsupported nested recap block. Review the generated source.",
    "Unsupported nested block",
  );
}

/** Readable <Columns><Column>…markdown/blocks…</Column></Columns>. */
function columnsBlock(title, columns) {
  const id = blockId("cols");
  const body = columns
    .map((column) => {
      const childMdx = (column.blocks ?? []).map(nestedBlockMdx).join("\n\n");
      const contentId =
        column.blocks?.length === 1 && column.blocks[0]?.type === "rich-text"
          ? column.blocks[0].id
          : undefined;
      return `<Column${prop("id", column.id)}${prop("label", column.label)}${prop("contentId", contentId)}>\n\n${childMdx.trim()}\n\n</Column>`;
    })
    .join("\n\n");
  return `<Columns${prop("id", id)}${prop("title", title)}>\n${body}\n</Columns>`;
}

function nestedRichTextBlock(markdown, title) {
  return {
    id: blockId("rt-child"),
    type: "rich-text",
    ...(title ? { title } : {}),
    data: { markdown },
  };
}

function nestedDataModelBlock(entities, relations, title) {
  return {
    id: blockId("dm-child"),
    type: "data-model",
    ...(title ? { title } : {}),
    data: {
      entities,
      ...(relations?.length ? { relations } : {}),
    },
  };
}

/** <Endpoint method path summary> description </Endpoint> */
function endpoint({ method, path, summary, description }) {
  const id = blockId("ep");
  const body = (description ?? "").trim();
  const open = `<Endpoint${prop("id", id)}${prop("method", method)}${prop("path", path)}${prop("summary", summary)}>`;
  return `${open}\n\n${body}\n\n</Endpoint>`;
}

/* -------------------------------------------------------------------------- */
/* Diff parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} ParsedFile
 * @property {string} path         The "after" path (or "before" for deletes).
 * @property {string} oldPath
 * @property {"added"|"modified"|"removed"|"renamed"} change
 * @property {number} added        Count of added lines.
 * @property {number} removed      Count of removed lines.
 * @property {string[]} beforeLines  Removed + context lines (the "before" side).
 * @property {string[]} afterLines   Added + context lines (the "after" side).
 * @property {boolean} binary
 */

/**
 * Parse a unified `git diff` into per-file records. We reconstruct rough
 * before/after bodies from the hunks (context + -/+ lines) so the Diff block
 * has real content. This is best-effort but always grounded in the diff text.
 * @param {string} diffText
 * @returns {ParsedFile[]}
 */
export function parseDiff(diffText) {
  /** @type {ParsedFile[]} */
  const files = [];
  /** @type {ParsedFile|null} */
  let current = null;

  const lines = diffText.split("\n");
  const push = () => {
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      push();
      // diff --git a/oldpath b/newpath
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = m ? m[1] : "";
      const newPath = m ? m[2] : "";
      current = {
        path: newPath || oldPath,
        oldPath,
        change: "modified",
        added: 0,
        removed: 0,
        beforeLines: [],
        afterLines: [],
        binary: false,
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith("new file mode")) current.change = "added";
    else if (line.startsWith("deleted file mode")) current.change = "removed";
    else if (line.startsWith("rename from ")) {
      current.change = "renamed";
      current.oldPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length).trim();
    } else if (
      line.startsWith("Binary files") ||
      line.startsWith("GIT binary patch")
    ) {
      current.binary = true;
    } else if (line.startsWith("--- ")) {
      const p = line.slice(4).replace(/^a\//, "").trim();
      if (p && p !== "/dev/null") current.oldPath = p;
    } else if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "").trim();
      if (p && p !== "/dev/null") current.path = p;
    } else if (line.startsWith("@@")) {
      // Hunk header — keep both sides aligned with a blank separator marker.
      if (current.beforeLines.length) current.beforeLines.push("");
      if (current.afterLines.length) current.afterLines.push("");
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
      current.afterLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
      current.beforeLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      const body = line.slice(1);
      current.beforeLines.push(body);
      current.afterLines.push(body);
    }
  }
  push();
  return files;
}

/** Map a file path to a syntax-highlight language hint. */
function languageFor(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    md: "md",
    mdx: "mdx",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    sh: "bash",
    py: "python",
    go: "go",
    rs: "rust",
  };
  return map[ext];
}

const SCHEMA_RE =
  /(?:^|\/)(?:schema[^/]*\.(?:ts|tsx)|.*\.sql)$|\/migrations?\//i;
const ACTION_RE = /\/actions\//i;
const ROUTE_RE = /\/(?:routes?|server|api)\/.*\.(?:ts|tsx)$/i;
const TEST_PATH_RE =
  /(?:^|\/)(?:__tests__|tests?)\/|[.-](?:spec|test)\.[cm]?[tj]sx?$/i;
const UI_PATH_RE =
  /(?:^|\/)(?:app|pages?|routes?|components?|src\/client|client|ui|blocks|styles?)\/.*\.(?:tsx|jsx|css|scss|sass)$/i;

/**
 * Derive lightweight DataModel entities from schema-ish text.
 * We look for Drizzle `pgTable("name", { col: ... })` / `sqliteTable(...)` and
 * SQL `CREATE TABLE name (col type, ...)`. Best-effort, grounded in the text.
 * @returns {{entities: any[], relations: any[]}}
 */
function deriveDataModelFromText(text) {
  /** @type {any[]} */
  const entities = [];

  // Drizzle: export const xs = pgTable("xs", { id: ..., name: ... })
  const drizzleRe =
    /(?:pg|sqlite|mysql)Table\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let m;
  while ((m = drizzleRe.exec(text)) && entities.length < 12) {
    const name = m[1];
    const fieldsBlock = m[2];
    const fields = [];
    const fieldRe = /([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)\(/g;
    let fm;
    while ((fm = fieldRe.exec(fieldsBlock)) && fields.length < 40) {
      const fieldName = fm[1];
      const builder = fm[2];
      const isPk = /\.primaryKey\(/.test(
        fieldsBlock.slice(fm.index, fm.index + 200),
      );
      fields.push({
        name: fieldName,
        type: builder,
        ...(isPk ? { pk: true } : {}),
      });
    }
    if (fields.length) {
      entities.push({ id: name, name, fields });
    }
  }

  // SQL: CREATE TABLE name ( ... )
  const sqlRe =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["'`]?([A-Za-z0-9_]+)["'`]?\s*\(([\s\S]*?)\);/gi;
  while ((m = sqlRe.exec(text)) && entities.length < 12) {
    const name = m[1];
    const cols = m[2]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 40);
    const fields = [];
    for (const col of cols) {
      const cm = col.match(/^["'`]?([A-Za-z0-9_]+)["'`]?\s+([A-Za-z0-9_()]+)/);
      if (!cm) continue;
      fields.push({
        name: cm[1],
        type: cm[2],
        ...(/PRIMARY KEY/i.test(col) ? { pk: true } : {}),
      });
    }
    if (fields.length && !entities.some((e) => e.id === name)) {
      entities.push({ id: name, name, fields });
    }
  }

  return { entities, relations: [] };
}

/** Derive lightweight DataModel entities from a schema-ish file's after-body. */
function deriveDataModel(file) {
  return deriveDataModelFromText(file.afterLines.join("\n"));
}

function fieldSignature(field) {
  return [
    field.type ?? "",
    field.pk ? "pk" : "",
    field.fk ? `fk:${field.fk}` : "",
    field.nullable ? "nullable" : "",
    field.default ? `default:${field.default}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function inlineCode(value) {
  return `\`${String(value).replace(/`/g, "'").slice(0, 160)}\``;
}

function basename(path) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function compactPathLabel(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 4) return path;
  return `${parts.slice(0, 2).join("/")}/…/${parts.slice(-2).join("/")}`;
}

function isUiImpactFile(file) {
  return (
    !file.binary && !TEST_PATH_RE.test(file.path) && UI_PATH_RE.test(file.path)
  );
}

function uiFileNote(file, side) {
  if (side === "before") {
    return file.removed > 0
      ? `${file.removed} removed/context lines`
      : "previous UI state";
  }
  return file.added > 0 ? `${file.added} added/context lines` : "updated UI";
}

function uiTaskRows(files, side) {
  return files
    .map((file) => {
      const title = compactPathLabel(file.path);
      return `          <TaskRow${prop("title", title)}${prop("note", uiFileNote(file, side))} />`;
    })
    .join("\n");
}

function buildUiImpactCanvasMdx(files) {
  const uiFiles = files.filter(isUiImpactFile).slice(0, 6);
  if (!uiFiles.length) return undefined;
  const primary = uiFiles[0];
  const primaryName = basename(primary.path);
  const beforeRows = uiTaskRows(uiFiles, "before");
  const afterRows = uiTaskRows(uiFiles, "after");

  return [
    "{/* Canvas source. */}",
    "",
    '<DesignBoard title="UI impact review" version={2}>',
    '<Section id="section-ui-impact" title="UI impact" subtitle="Generated because this diff touches rendered UI/client surfaces. The artboards are a review scaffold grounded in changed UI files; replace with a more specific mockup when the UI behavior is known.">',
    '<Artboard id="ui-impact-before" label="Before UI surface" surface="desktop" order={1}>',
    '<Screen surface="desktop" caption="Before UI state inferred from removed/context lines in changed UI files.">',
    "  <FrameScreen>",
    '    <BrowserBar title="Before" />',
    "    <Main>",
    `      <Title${prop("text", primaryName)} />`,
    '      <Text value="Existing UI before this diff" color="muted" />',
    "      <Box dashed>",
    beforeRows,
    "      </Box>",
    "      <Divider />",
    "      <Lines n={6} widths={[95, 88, 92, 76, 84, 64]} />",
    "    </Main>",
    "  </FrameScreen>",
    "</Screen>",
    "</Artboard>",
    "",
    '<Artboard id="ui-impact-after" label="After UI surface" surface="desktop" order={2}>',
    '<Screen surface="desktop" caption="After UI state inferred from added/context lines in changed UI files.">',
    "  <FrameScreen>",
    '    <BrowserBar title="After" />',
    "    <Main>",
    `      <Title${prop("text", primaryName)} />`,
    '      <Text value="Updated UI after this diff" color="muted" />',
    "      <Box>",
    afterRows,
    "      </Box>",
    "      <Divider />",
    "      <Row>",
    '        <Pill label="review UI" tone="accent" />',
    '        <Pill label="compare before/after" />',
    "      </Row>",
    "      <Lines n={4} widths={[88, 78, 82, 58]} />",
    "    </Main>",
    "  </FrameScreen>",
    "</Screen>",
    "</Artboard>",
    "</Section>",
    "",
    '<Annotation id="ann-ui-impact-grounding" title="UI-impacting diff" targetId="ui-impact-after" placement="bottom">',
    "",
    "This canvas is included because the diff touched rendered UI files. Treat it as the visual-review starting point; replace it with a more exact screen mockup when the behavior is specific.",
    "",
    "</Annotation>",
    "</DesignBoard>",
  ].join("\n");
}

function formatCompatibilityChanges(changes) {
  return changes
    .slice(0, 40)
    .map((change) => {
      const impact = change.impact ? ` (${change.impact})` : "";
      const before = change.before
        ? ` Before: ${inlineCode(change.before)}.`
        : "";
      const after = change.after ? ` After: ${inlineCode(change.after)}.` : "";
      const note = change.note ? ` ${change.note}` : "";
      return `- **${change.path}**: ${change.change}${impact}.${before}${after}${note}`;
    })
    .join("\n");
}

function deriveSchemaCompatibilityChanges(beforeModel, afterModel) {
  const changes = [];
  const beforeEntities = new Map(beforeModel.entities.map((e) => [e.id, e]));
  const afterEntities = new Map(afterModel.entities.map((e) => [e.id, e]));

  for (const [entityId, beforeEntity] of beforeEntities) {
    if (!afterEntities.has(entityId)) {
      changes.push({
        area: "schema",
        path: `${beforeEntity.name}`,
        change: "removed",
        impact: "breaking",
        before: `${beforeEntity.fields.length} fields`,
        note: "Entity no longer appears in the changed schema text.",
      });
    }
  }

  for (const [entityId, afterEntity] of afterEntities) {
    const beforeEntity = beforeEntities.get(entityId);
    if (!beforeEntity) {
      changes.push({
        area: "schema",
        path: `${afterEntity.name}`,
        change: "added",
        impact: "non-breaking",
        after: `${afterEntity.fields.length} fields`,
      });
      continue;
    }

    const beforeFields = new Map(beforeEntity.fields.map((f) => [f.name, f]));
    const afterFields = new Map(afterEntity.fields.map((f) => [f.name, f]));
    for (const [fieldName, beforeField] of beforeFields) {
      if (!afterFields.has(fieldName)) {
        changes.push({
          area: "schema",
          path: `${afterEntity.name}.${fieldName}`,
          change: "removed",
          impact: "breaking",
          before: fieldSignature(beforeField),
        });
      }
    }
    for (const [fieldName, afterField] of afterFields) {
      const beforeField = beforeFields.get(fieldName);
      if (!beforeField) {
        changes.push({
          area: "schema",
          path: `${afterEntity.name}.${fieldName}`,
          change: "added",
          impact: "non-breaking",
          after: fieldSignature(afterField),
        });
        continue;
      }
      const beforeSig = fieldSignature(beforeField);
      const afterSig = fieldSignature(afterField);
      if (beforeSig !== afterSig) {
        changes.push({
          area: "schema",
          path: `${afterEntity.name}.${fieldName}`,
          change: "changed",
          impact: "risky",
          before: beforeSig,
          after: afterSig,
        });
      }
    }
  }

  return changes.slice(0, 80);
}

/**
 * Derive API endpoints from an action/route file's after-body. Grounded:
 * - `http: { method: "GET" }` on a defineAction → an Endpoint named for the file.
 * - `defineEventHandler` / route registration paths.
 * @returns {any[]}
 */
function deriveEndpoints(file, lines = file.afterLines) {
  const text = lines.join("\n");
  /** @type {any[]} */
  const endpoints = [];

  if (ACTION_RE.test(file.path)) {
    const actionId = (file.path.split("/").pop() || "action").replace(
      /\.(ts|tsx)$/,
      "",
    );
    const methodMatch = text.match(
      /http\s*:\s*\{[^}]*method\s*:\s*["'`](\w+)["'`]/,
    );
    const method = methodMatch ? methodMatch[1].toUpperCase() : "POST";
    const descMatch = text.match(
      /description\s*:\s*\n?\s*["'`]([^"'`]{0,300})/,
    );
    endpoints.push({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
        ? method
        : "POST",
      path: `/_agent-native/actions/${actionId}`,
      summary: `Action: ${actionId} (${file.change})`,
      description: descMatch ? descMatch[1].trim() : undefined,
    });
  }

  // Generic route handlers.
  const routeRe =
    /(?:router|app)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
  let m;
  while ((m = routeRe.exec(text)) && endpoints.length < 8) {
    endpoints.push({
      method: m[1].toUpperCase(),
      path: m[2],
      summary: `Route handler (${file.change})`,
    });
  }

  return endpoints;
}

/* -------------------------------------------------------------------------- */
/* Plan assembly                                                              */
/* -------------------------------------------------------------------------- */

const CHANGE_VERB = {
  added: "Added",
  modified: "Changed",
  removed: "Removed",
  renamed: "Renamed",
};

/** Cap a multiline string to a line budget so a single block stays scannable. */
function capLines(lines, max) {
  if (lines.length <= max) return lines.join("\n");
  return `${lines.slice(0, max).join("\n")}\n… (${lines.length - max} more lines)`;
}

export function buildPlanMdx({ pr, headSha, statText, files, huge }) {
  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);
  const schemaFiles = files.filter((f) => SCHEMA_RE.test(f.path));
  const actionFiles = files.filter(
    (f) => ACTION_RE.test(f.path) || ROUTE_RE.test(f.path),
  );
  const uiFiles = files.filter(isUiImpactFile);
  const canvasMdx = buildUiImpactCanvasMdx(files);

  const blocks = [];

  // File-tree block (always) — grounded change map.
  const treeEntries = files.slice(0, 200).map((f) => ({
    path: f.path,
    change: f.change,
    note:
      `${CHANGE_VERB[f.change]} (+${f.added} / -${f.removed})` +
      (f.binary ? " · binary" : ""),
  }));
  blocks.push(fileTree("Files touched", treeEntries));

  // Data model block(s) from schema files.
  for (const file of schemaFiles.slice(0, 4)) {
    const beforeModel = deriveDataModelFromText(file.beforeLines.join("\n"));
    const afterModel = deriveDataModelFromText(file.afterLines.join("\n"));
    if (beforeModel.entities.length || afterModel.entities.length) {
      blocks.push(
        richText(
          `Schema change in \`${file.path}\` (${CHANGE_VERB[file.change].toLowerCase()}).`,
        ),
      );
      const schemaCompatibilityChanges = deriveSchemaCompatibilityChanges(
        beforeModel,
        afterModel,
      );
      if (beforeModel.entities.length && afterModel.entities.length) {
        blocks.push(
          columnsBlock("Schema shape", [
            {
              id: blockId("col"),
              label: "Before",
              blocks: [
                nestedDataModelBlock(
                  beforeModel.entities,
                  beforeModel.relations,
                  "Before",
                ),
              ],
            },
            {
              id: blockId("col"),
              label: "After",
              blocks: [
                nestedDataModelBlock(
                  afterModel.entities,
                  afterModel.relations,
                  "After",
                ),
              ],
            },
          ]),
        );
      }
      if (schemaCompatibilityChanges.length) {
        blocks.push(
          richText(
            formatCompatibilityChanges(schemaCompatibilityChanges),
            `Schema compatibility: ${file.path}`,
          ),
        );
      }
      if (afterModel.entities.length) {
        blocks.push(
          dataModel(
            afterModel.entities,
            afterModel.relations.length ? afterModel.relations : undefined,
          ),
        );
      }
    } else if (file.beforeLines.length || file.afterLines.length) {
      blocks.push(
        columnsBlock("Schema text", [
          {
            id: blockId("col"),
            label: "Before",
            blocks: [
              nestedRichTextBlock(
                ["```", capLines(file.beforeLines, 80), "```"].join("\n"),
              ),
            ],
          },
          {
            id: blockId("col"),
            label: "After",
            blocks: [
              nestedRichTextBlock(
                ["```", capLines(file.afterLines, 80), "```"].join("\n"),
              ),
            ],
          },
        ]),
      );
    }
  }

  // API endpoint block(s) from action/route files.
  const endpointBlocks = [];
  const endpointCompatibilityChanges = [];
  for (const file of actionFiles.slice(0, 8)) {
    for (const ep of deriveEndpoints(file).slice(0, 2)) {
      endpointBlocks.push(endpoint(ep));
    }
    const contractEndpoints = deriveEndpoints(
      file,
      file.change === "removed" ? file.beforeLines : file.afterLines,
    );
    for (const ep of contractEndpoints.slice(0, 4)) {
      endpointCompatibilityChanges.push({
        area: "api",
        path: `${ep.method} ${ep.path}`,
        change:
          file.change === "added"
            ? "added"
            : file.change === "removed"
              ? "removed"
              : "changed",
        impact:
          file.change === "added"
            ? "non-breaking"
            : file.change === "removed"
              ? "breaking"
              : "risky",
        ...(file.change === "removed"
          ? { before: ep.summary }
          : { after: ep.summary }),
      });
    }
  }
  if (endpointBlocks.length) {
    blocks.push(
      richText("Action / route surface touched by this PR.", "Endpoints"),
    );
    blocks.push(...endpointBlocks.slice(0, 12));
  }
  if (endpointCompatibilityChanges.length) {
    blocks.push(
      richText(
        formatCompatibilityChanges(endpointCompatibilityChanges),
        "API compatibility",
      ),
    );
  }

  // Diff (split) blocks for the highest-churn files.
  const DIFF_CAP = huge ? 4 : 8;
  const LINE_CAP = huge ? 60 : 140;
  const byChurn = [...files]
    .filter((f) => !f.binary && (f.beforeLines.length || f.afterLines.length))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))
    .slice(0, DIFF_CAP);

  if (byChurn.length) {
    blocks.push(
      richText(
        "Highest-churn files, shown side-by-side (before → after).",
        "Key diffs",
      ),
    );
    for (const file of byChurn) {
      blocks.push(
        diffBlock({
          filename: file.path,
          language: languageFor(file.path),
          mode: "split",
          before: capLines(file.beforeLines, LINE_CAP),
          after: capLines(file.afterLines, LINE_CAP),
        }),
      );
    }
  }

  // Optional stat summary as a trailing rich-text block.
  if (statText && statText.trim()) {
    blocks.push(
      richText(
        ["```", statText.trim().slice(0, 4000), "```"].join("\n"),
        "Diffstat",
      ),
    );
  }

  const title = `Visual recap — PR #${pr}`;
  const brief = `A reverse plan generated from the PR diff. ${files.length} files, +${totalAdded}/-${totalRemoved}.`;

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `brief: ${JSON.stringify(brief)}`,
    "---",
    "",
    "",
  ].join("\n");

  const planMdx = frontmatter + blocks.join("\n\n") + "\n";
  return {
    planMdx,
    ...(canvasMdx ? { canvasMdx } : {}),
    title,
    brief,
    summary: {
      files: files.length,
      added: totalAdded,
      removed: totalRemoved,
      schemaFiles: schemaFiles.length,
      actionFiles: actionFiles.length,
      uiFiles: uiFiles.length,
      huge: Boolean(huge),
    },
  };
}

export function buildVisualRecapPlan({
  diffText,
  pr = "?",
  headSha = "",
  statText = "",
  huge = false,
}) {
  if (!diffText.trim()) {
    return { skipped: true, reason: "empty diff" };
  }

  if (diffContainsSecret(diffText)) {
    return { suppressed: true, reason: "potential secret in diff" };
  }

  const files = parseDiff(diffText);
  if (!files.length) {
    return { skipped: true, reason: "no parseable files in diff" };
  }

  return {
    ...buildPlanMdx({
      pr,
      headSha,
      statText,
      files,
      huge,
    }),
    files,
  };
}

/* -------------------------------------------------------------------------- */
/* Hosted publish                                                            */
/* -------------------------------------------------------------------------- */

async function publish({
  appUrl,
  token,
  planMdx,
  canvasMdx,
  title,
  brief,
  prevPlanId,
}) {
  const base = appUrl.replace(/\/+$/, "");
  const importRes = await fetch(
    `${base}/_agent-native/actions/create-visual-recap`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...(prevPlanId ? { planId: prevPlanId } : {}),
        title,
        brief,
        source: "imported",
        status: "review",
        mdx: {
          "plan.mdx": planMdx,
          ...(canvasMdx ? { "canvas.mdx": canvasMdx } : {}),
        },
      }),
    },
  );

  if (!importRes.ok) {
    const detail = await importRes.text().catch(() => "");
    throw new Error(
      `create-visual-recap failed (${importRes.status} ${importRes.statusText}). ${detail.slice(0, 500)}`.trim(),
    );
  }

  const result = /** @type {any} */ await importRes.json().catch(() => null);
  const planId = result?.planId ?? result?.plan?.id;
  if (!planId) {
    throw new Error(
      "create-visual-recap returned 200 but no planId in the response.",
    );
  }
  const path = result?.path ?? result?.url ?? `/plans/${planId}`;
  const url = String(path).startsWith("http")
    ? String(path)
    : `${base}${String(path).startsWith("/") ? "" : "/"}${path}`;

  // Org visibility — login-gated, not public (this is a private repo).
  const visRes = await fetch(
    `${base}/_agent-native/actions/set-resource-visibility`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        resourceType: "plan",
        resourceId: planId,
        visibility: "org",
      }),
    },
  );
  let visibility = "org";
  if (!visRes.ok) {
    const detail = await visRes.text().catch(() => "");
    // Don't hard-fail the whole recap if only visibility flipped wrong — the
    // link still works for the owner; surface it so the comment can note it.
    visibility = `org-failed:${visRes.status}`;
    process.stderr.write(
      `set-resource-visibility failed (${visRes.status}). ${detail.slice(0, 300)}\n`,
    );
  }

  return { planId, url, path: String(path), visibility };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const diffPath = typeof args.diff === "string" ? args.diff : null;
  const appUrl = typeof args["app-url"] === "string" ? args["app-url"] : null;
  const token = typeof args.token === "string" ? args.token : null;
  const pr = typeof args.pr === "string" ? args.pr : "?";
  const headSha = typeof args.head === "string" ? args.head : "";
  const huge = args.huge === true || args.huge === "true";
  const prevPlanId =
    typeof args["prev-plan-id"] === "string" && args["prev-plan-id"].length > 2
      ? args["prev-plan-id"]
      : undefined;
  const statPath = typeof args.stat === "string" ? args.stat : null;

  if (!diffPath) return fail("missing --diff");
  if (!appUrl) return fail("missing --app-url");
  if (!token) return fail("missing --token");

  let diffText = "";
  try {
    diffText = readFileSync(diffPath, "utf8");
  } catch (err) {
    return fail(`could not read diff file: ${err?.message ?? err}`);
  }

  let statText = "";
  if (statPath) {
    try {
      statText = readFileSync(statPath, "utf8");
    } catch {
      statText = "";
    }
  }

  const generated = buildVisualRecapPlan({
    diffText,
    pr,
    headSha,
    statText,
    huge,
  });
  if ("suppressed" in generated || "skipped" in generated) {
    return emit(generated);
  }
  const { planMdx, canvasMdx, title, brief, summary } = generated;

  try {
    const published = await publish({
      appUrl,
      token,
      planMdx,
      canvasMdx,
      title,
      brief,
      prevPlanId,
    });
    return emit({
      planId: published.planId,
      url: published.url,
      path: published.path,
      visibility: published.visibility,
      summary,
      huge: Boolean(huge),
    });
  } catch (err) {
    return fail(`publish failed: ${err?.message ?? err}`, { summary });
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(
    entry && import.meta.url === pathToFileURL(resolve(entry)).href,
  );
}

if (isDirectRun()) {
  main().catch((err) => fail(`unexpected error: ${err?.message ?? err}`));
}
