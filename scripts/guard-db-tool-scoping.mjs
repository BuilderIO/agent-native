#!/usr/bin/env node
/**
 * guard-db-tool-scoping.mjs
 *
 * The agent's raw DB tools (`db-query`, `db-exec`, `db-patch`) can only safely
 * expose tables with an explicit tenant scope (`owner_email` and/or `org_id`)
 * or a known framework-specific scoping rule. The runtime DB layer now fails
 * closed by shadowing unknown-scope tables with empty temp views, but this
 * guard keeps template schema drift visible in CI.
 *
 * If a new template table should be usable through raw DB tools, add
 * `owner_email`/`org_id` plus an additive migration. If it is a join table,
 * public-token table, cache, or implementation detail that should remain
 * hidden from raw DB tools, add it to INTENTIONAL_RAW_DB_DENYLIST below with
 * a short reviewer-readable reason.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  ".react-router",
  ".generated",
  "coverage",
]);

// Existing template tables intentionally hidden from raw DB tools because
// access is mediated through a scoped parent, custom action, public token, or
// cache pathway. Key format: "<template>:<sql_table_name>".
const INTENTIONAL_RAW_DB_DENYLIST = {
  "analytics:bigquery_cache": "provider cache, not a user-facing resource",
  "analytics:dashboard_views": "view telemetry, scoped by dashboard/action",
  "brain:brain_ingest_queue": "internal ingestion queue scoped by actions",
  "brain:brain_raw_captures": "raw imported content scoped through sources",
  "brain:brain_sync_runs": "provider sync bookkeeping scoped by sources",
  "calendar:booking_slug_redirects": "public redirect helper, no user data",
  "calls:accounts": "third-party/account metadata, accessed by actions",
  "calls:call_comments": "child rows scoped through calls",
  "calls:call_events": "audit/event rows scoped through calls",
  "calls:call_participants": "child rows scoped through calls",
  "calls:call_summaries": "child rows scoped through calls",
  "calls:call_tags": "child rows scoped through calls",
  "calls:call_viewers": "viewer link rows scoped through calls",
  "calls:invites": "invite-token rows scoped through workspace actions",
  "calls:recall_bots": "external bot bookkeeping scoped by actions",
  "calls:snippet_viewers": "viewer link rows scoped through snippets",
  "calls:space_members": "membership join rows scoped through spaces",
  "calls:spaces": "workspace child rows scoped through workspaces",
  "calls:tracker_definitions": "child rows scoped through calls/workspaces",
  "calls:tracker_hits": "child rows scoped through calls/workspaces",
  "calls:workspace_members": "membership join rows scoped through workspaces",
  "calls:zoom_connections": "integration rows accessed by actions",
  "clips:calendar_events": "mirrored calendar rows scoped through accounts",
  "clips:invites": "invite-token rows scoped through workspace actions",
  "clips:meeting_action_items": "child rows scoped through meetings",
  "clips:meeting_participants": "child rows scoped through meetings",
  "clips:organization_settings": "org-level settings accessed by actions",
  "clips:recording_comments": "child rows scoped through recordings",
  "clips:recording_ctas": "child rows scoped through recordings",
  "clips:recording_events": "audit/event rows scoped through recordings",
  "clips:recording_reactions": "child rows scoped through recordings",
  "clips:recording_tags": "child rows scoped through recordings",
  "clips:recording_viewers": "viewer link rows scoped through recordings",
  "clips:space_members": "membership join rows scoped through spaces",
  "clips:spaces": "workspace child rows scoped through workspaces",
  "clips:workspace_members": "membership join rows scoped through workspaces",
  "design:design_files": "child rows scoped through designs",
  "design:design_versions": "version rows scoped through designs",
  "forms:responses": "public submissions scoped through forms",
  "assets:asset_folders": "child rows scoped through libraries",
  "assets:image_assets": "child rows scoped through libraries/collections",
  "assets:image_collections": "child rows scoped through libraries",
  "assets:image_generation_presets": "child rows scoped through libraries",
  "assets:image_generation_sessions": "child rows scoped through libraries",
  "assets:image_generation_session_items":
    "child rows scoped through generation sessions/libraries",
  "mail:email_link_tracking": "tracking rows scoped through owning draft/job",
  "meeting-notes:companies": "directory/cache table accessed by actions",
  "meeting-notes:meeting_attendees": "child rows scoped through meetings",
  "meeting-notes:meeting_folders": "folder join rows scoped through meetings",
  "meeting-notes:meeting_notes": "child rows scoped through meetings",
  "meeting-notes:meeting_transcripts": "child rows scoped through meetings",
  "meeting-notes:people": "directory/cache table accessed by actions",
  "migration:migration_artifacts": "child rows scoped through migration runs",
  "migration:migration_tasks": "child rows scoped through migration runs",
  "migration:migration_verifier_results":
    "child rows scoped through migration runs",
  // Scheduling package re-exports (templates/scheduling). All child / join /
  // cache rows reachable only through a scoped parent (booking, user,
  // event-type, schedule, workflow, team) or via dedicated actions.
  "scheduling:api_keys": "credential-style rows accessed by actions",
  "scheduling:booking_attendees": "child rows scoped through bookings",
  "scheduling:booking_notes": "child rows scoped through bookings",
  "scheduling:booking_references": "child rows scoped through bookings",
  "scheduling:booking_seats": "child rows scoped through bookings",
  "scheduling:calendar_cache": "provider cache, not a user-facing resource",
  "scheduling:destination_calendars": "child rows scoped through users",
  "scheduling:event_type_host_groups": "child rows scoped through event types",
  "scheduling:event_type_slug_redirects":
    "public redirect helper, no user data",
  "scheduling:hashed_links":
    "public share-token rows scoped through event types",
  "scheduling:out_of_office_entries": "child rows scoped through users",
  "scheduling:routing_form_responses":
    "public submissions scoped through forms",
  "scheduling:schedule_availability": "child rows scoped through schedules",
  "scheduling:scheduled_reminders": "child rows scoped through workflows",
  "scheduling:selected_calendars": "child rows scoped through users",
  "scheduling:team_members": "membership join rows scoped through teams",
  "scheduling:travel_schedules": "child rows scoped through users",
  "scheduling:verified_emails": "credential-style rows accessed by actions",
  "scheduling:verified_numbers": "credential-style rows accessed by actions",
  "scheduling:webhook_deliveries": "audit/event rows scoped through webhooks",
  "scheduling:workflow_steps": "child rows scoped through workflows",
  "slides:deck_share_links": "public share-token rows scoped through decks",
  "slides:slide_comments": "child rows scoped through decks",
  "videos:folder_memberships": "membership join rows scoped through folders",
};

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function extractTableCalls(contents) {
  const out = [];
  const headerRegex =
    /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:[a-zA-Z_$][\w$]*Table|table)\s*\(\s*"([^"]+)"\s*,\s*\{/gm;
  let match;
  while ((match = headerRegex.exec(contents)) !== null) {
    const exportName = match[1];
    const sqlName = match[2];
    const start = headerRegex.lastIndex - 1;
    let depth = 0;
    let inStr = null;
    let bodyEnd = -1;
    for (let i = start; i < contents.length; i++) {
      const c = contents[i];
      const prev = contents[i - 1];
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd === -1) continue;
    out.push({
      exportName,
      sqlName,
      body: contents.slice(start + 1, bodyEnd),
    });
  }
  return out;
}

function templateNameFromSchemaPath(file) {
  const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
  const match = rel.match(/^templates\/([^/]+)\//);
  return match?.[1] ?? null;
}

function hasRawDbScope(tableBody) {
  return (
    /\.\.\.ownableColumns\s*\(/.test(tableBody) ||
    /\b[\w$]+\s*:\s*text\s*\(\s*["']owner_email["']/.test(tableBody) ||
    /\b[\w$]+\s*:\s*text\s*\(\s*["']org_id["']/.test(tableBody)
  );
}

/**
 * Resolve an `export * from "@agent-native/<pkg>/schema[/<sub>]"` (or relative)
 * specifier in the given source file to one or more on-disk schema files.
 * Returns an empty array when the import doesn't point at an in-repo package.
 */
async function resolveSchemaReExports(sourceFile) {
  const contents = readFileSync(sourceFile, "utf8");
  const re = /export\s+\*\s+from\s+["']([^"']+)["']/g;
  const out = [];
  let m;
  while ((m = re.exec(contents)) !== null) {
    const spec = m[1];
    const pkgMatch = spec.match(/^@agent-native\/([^/]+)(?:\/([^"']+))?$/);
    if (pkgMatch) {
      const pkg = pkgMatch[1];
      const sub = pkgMatch[2] ?? "schema";
      const pkgRoot = path.join(REPO_ROOT, "packages", pkg, "src", sub);
      // sub may be "schema" (a directory with index.ts + siblings) or
      // "schema/<file>"; both resolve to in-repo TS sources.
      try {
        const stat = await readdir(pkgRoot, { withFileTypes: true });
        for (const e of stat) {
          if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts"))
            out.push(path.join(pkgRoot, e.name));
        }
      } catch {
        const single = `${pkgRoot}.ts`;
        try {
          readFileSync(single);
          out.push(single);
        } catch {
          // not a file we can scan — silently skip
        }
      }
    }
  }
  return out;
}

const findings = [];
const seenAllowed = new Set();

for await (const file of walk(path.join(REPO_ROOT, "templates"))) {
  if (!file.endsWith("/server/db/schema.ts")) continue;
  const template = templateNameFromSchemaPath(file);
  if (!template) continue;

  // Scan the template's own schema.ts plus any package schemas it
  // re-exports. Without the re-export resolution, templates like
  // scheduling that ship their tables from @agent-native/scheduling/schema
  // bypass the guard entirely (the file looks empty of `table(...)` calls).
  const filesToScan = [file, ...(await resolveSchemaReExports(file))];
  for (const scanFile of filesToScan) {
    let contents;
    try {
      contents = readFileSync(scanFile, "utf8");
    } catch {
      continue;
    }
    const tables = extractTableCalls(contents);
    for (const table of tables) {
      if (hasRawDbScope(table.body)) continue;
      const key = `${template}:${table.sqlName}`;
      if (Object.hasOwn(INTENTIONAL_RAW_DB_DENYLIST, key)) {
        seenAllowed.add(key);
        continue;
      }
      findings.push({
        file: path.relative(REPO_ROOT, scanFile).replaceAll("\\", "/"),
        exportName: table.exportName,
        sqlName: table.sqlName,
        key,
      });
    }
  }
}

const staleAllowlist = Object.keys(INTENTIONAL_RAW_DB_DENYLIST).filter(
  (key) => !seenAllowed.has(key),
);

if (findings.length > 0 || staleAllowlist.length > 0) {
  if (findings.length > 0) {
    console.error("Template tables without raw-DB scope or denylist entry:");
    for (const f of findings) {
      console.error(`  - ${f.file}: ${f.exportName} -> ${f.sqlName}`);
      console.error(`    Add owner_email/org_id, or denylist ${f.key}`);
    }
  }
  if (staleAllowlist.length > 0) {
    console.error("Stale raw-DB denylist entries:");
    for (const key of staleAllowlist) {
      console.error(`  - ${key}`);
    }
  }
  process.exit(1);
}

console.log(
  `guard-db-tool-scoping: clean (${seenAllowed.size} intentionally denied template table(s))`,
);
