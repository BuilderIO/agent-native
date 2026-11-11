import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createDbExec, type DbExec } from "../packages/core/src/db/client.js";
import { CANONICAL_IDENTITY_SSO_HUB_URL } from "../packages/core/src/server/identity-sso-store.js";
import {
  buildBackfillPlan,
  HUB_APP,
  rosterHash,
  type AppSnapshot,
  type BackfillPlan,
} from "./federation-backfill-plan.js";

const APPS = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "clips",
  "content",
  "design",
  "dispatch",
  "forms",
  "mail",
  "plan",
  "slides",
] as const;

const FLAG_SETTING = "feature-flag:organization.cross-app-federation";
const FLAG_INDEX_SETTING =
  "feature-flag-rollout-index:organization.cross-app-federation";
const FLAG_ORG_OVERRIDE = "o:%:feature-flag:organization.cross-app-federation";
const MANIFEST_DIR = path.resolve(
  import.meta.dirname,
  "../.tmp/federation-backfill",
);

const USAGE = `Links workspaces to the identity hub's shared workspace id.

Each app database comes from <APP>_DATABASE_URL (${APPS.join(", ")}).
Write commands are dry runs unless --apply is given. Output is counts and ids only.

  plan   [--out <file>]
  apply  [--apply] [--allow-flag-on]
  verify
  undo   --manifest <file> [--apply] [--confirm-delete] [--allow-flag-on]
  flag   --mode on|off|emails [--emails a@x.com,b@y.com] [--apply] [--allow-org-overrides | --disable-org-overrides]`;

// Only messages written in this script are printed; driver errors can carry
// connection details and are replaced with a generic line.
class ScriptError extends Error {}

type Databases = Map<string, DbExec>;

const HUB_BATCH = 200;
const LINK_BATCH = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function groupByApp<T extends { app: string }>(
  items: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const list = grouped.get(item.app) ?? [];
    list.push(item);
    grouped.set(item.app, list);
  }
  return grouped;
}

function progress(step: string, done: number, total: number): void {
  console.log(JSON.stringify({ progress: step, done, of: total }));
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function openDatabases(): Promise<Databases> {
  const missing = APPS.filter(
    (app) => !process.env[`${app.toUpperCase()}_DATABASE_URL`]?.trim(),
  );
  if (missing.length > 0) {
    throw new ScriptError(
      `Missing database settings: ${missing.map((app) => `${app.toUpperCase()}_DATABASE_URL`).join(", ")}`,
    );
  }
  const databases: Databases = new Map();
  try {
    for (const app of APPS) {
      const url =
        process.env[`${app.toUpperCase()}_DATABASE_URL`]?.trim() ?? "";
      if (!/^postgres(?:ql)?:\/\//i.test(url)) {
        throw new ScriptError(`${app} needs an explicit PostgreSQL database.`);
      }
      databases.set(app, await createDbExec({ url }));
    }
  } catch (error) {
    await closeDatabases(databases);
    throw error;
  }
  return databases;
}

async function closeDatabases(databases: Databases): Promise<void> {
  for (const exec of databases.values()) await exec.close?.();
}

function requireDb(databases: Databases, app: string): DbExec {
  const exec = databases.get(app);
  if (!exec) throw new ScriptError(`No database for ${app}.`);
  return exec;
}

async function readSnapshot(app: string, exec: DbExec): Promise<AppSnapshot> {
  const orgs = await exec.execute({
    sql: `SELECT id, name, allowed_domain, identity_authority, identity_id, created_at FROM organizations`,
  });
  const members = await exec.execute({
    sql: `SELECT org_id, LOWER(email) AS email, role FROM org_members WHERE federation_removal_pending_at IS NULL`,
  });
  return {
    app,
    orgs: orgs.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      allowedDomain:
        row.allowed_domain == null ? null : String(row.allowed_domain),
      identityAuthority:
        row.identity_authority == null ? null : String(row.identity_authority),
      identityId: row.identity_id == null ? null : String(row.identity_id),
      createdAt: Number(row.created_at ?? 0),
    })),
    members: members.rows.map((row) => ({
      orgId: String(row.org_id),
      email: String(row.email),
      role: String(row.role),
    })),
  };
}

async function readSnapshots(databases: Databases): Promise<AppSnapshot[]> {
  const snapshots: AppSnapshot[] = [];
  for (const app of APPS) {
    snapshots.push(await readSnapshot(app, requireDb(databases, app)));
  }
  return snapshots;
}

interface FlagOverride {
  key: string;
  active: boolean;
  raw: Record<string, unknown>;
}

interface FlagState {
  globalActive: boolean;
  overrides: FlagOverride[];
}

function parseFlagRules(value: unknown): {
  raw: Record<string, unknown>;
  active: boolean;
} {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
  const percentage = typeof raw.percentage === "number" ? raw.percentage : 0;
  const active =
    raw.mode === "on" ||
    (raw.mode === "rules" &&
      (count(raw.emails) > 0 || count(raw.orgIds) > 0 || percentage > 0));
  return { raw, active };
}

// A rollout is live when the global rule is on or targets anyone, or when any
// workspace carries its own active rule; that one beats the global value.
async function readFlagState(exec: DbExec): Promise<FlagState> {
  const global = await exec.execute({
    sql: `SELECT value FROM settings WHERE key = ?`,
    args: [FLAG_SETTING],
  });
  const globalRow = global.rows.length > 0 ? global.rows[0] : undefined;
  const overrideRows = await exec.execute({
    sql: `SELECT key, value FROM settings WHERE key LIKE ?`,
    args: [FLAG_ORG_OVERRIDE],
  });
  return {
    globalActive: globalRow
      ? parseFlagRules(JSON.parse(String(globalRow.value))).active
      : false,
    overrides: overrideRows.rows.map((row) => {
      const parsed = parseFlagRules(JSON.parse(String(row.value)));
      return { key: String(row.key), active: parsed.active, raw: parsed.raw };
    }),
  };
}

function describePlan(plan: BackfillPlan) {
  return {
    authority: plan.authority,
    counts: plan.counts,
    sameTeamAcrossApps: plan.sameTeamAcrossApps.length,
  };
}

function writeManifest(name: string, body: unknown): string {
  mkdirSync(MANIFEST_DIR, { recursive: true });
  const file = path.join(MANIFEST_DIR, name);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

async function runPlan(databases: Databases, args: readonly string[]) {
  const plan = buildBackfillPlan(await readSnapshots(databases), {
    authority: CANONICAL_IDENTITY_SSO_HUB_URL,
  });
  console.log(JSON.stringify(describePlan(plan)));
  const out = flagValue(args, "--out");
  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          ...describePlan(plan),
          hubCreates: plan.hubCreates.map((org) => ({
            id: org.id,
            memberCount: org.members.length,
          })),
          appLinks: plan.appLinks,
          skipped: plan.skipped,
          sameTeamAcrossApps: plan.sameTeamAcrossApps,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Wrote ids-only plan to ${out}`);
  }
}

async function runApply(databases: Databases, args: readonly string[]) {
  const apply = args.includes("--apply");
  const plan = buildBackfillPlan(await readSnapshots(databases), {
    authority: CANONICAL_IDENTITY_SSO_HUB_URL,
  });
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      ...describePlan(plan),
    }),
  );
  if (!apply) return;
  if (!args.includes("--allow-flag-on")) {
    for (const [app, exec] of databases) {
      const state = await readFlagState(exec);
      if (state.globalActive || state.overrides.some((o) => o.active)) {
        throw new ScriptError(
          `The federation flag is already active in ${app} (on, or a rollout for some emails or workspaces); links would go live as they are written. Pass --allow-flag-on only if that is intended.`,
        );
      }
    }
  }

  const startedAt = new Date().toISOString();
  // Neon restores to a timestamp only while it is inside the project's history
  // window, which differs per project.
  console.log(JSON.stringify({ restorePoint: startedAt }));
  const hubCreated: Array<{
    id: string;
    memberCount: number;
    rosterHash: string;
  }> = [];
  const appLinked: Array<{ app: string; orgId: string; canonicalId: string }> =
    [];
  const appLinkSkipped: Array<{ app: string; orgId: string }> = [];
  const hub = requireDb(databases, HUB_APP);
  try {
    const hubBatches = chunk(plan.hubCreates, HUB_BATCH);
    for (const batch of hubBatches) {
      if (!hub.transaction) {
        throw new ScriptError(
          "The hub database does not support transactions.",
        );
      }
      const now = Date.now();
      await hub.transaction(async (tx) => {
        // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
        const inserted = await tx.execute({
          sql: `INSERT INTO organizations (id, name, created_by, created_at, a2a_secret, identity_authority, identity_id, icon_json, icon_revision, federation_roster_initialized_at) VALUES ${batch.map(() => "(?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)").join(", ")} ON CONFLICT (id) DO NOTHING`,
          args: batch.flatMap((org) => [
            org.id,
            org.name || org.createdBy,
            org.createdBy,
            org.createdAt || now,
            randomBytes(32).toString("base64url"),
            plan.authority,
            org.id,
            now,
          ]),
        });
        if (inserted.rowsAffected !== batch.length) {
          throw new ScriptError(
            "A hub organization with one of these ids already exists.",
          );
        }
        const members = batch.flatMap((org) =>
          org.members.map((member) => ({ orgId: org.id, member })),
        );
        // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
        await tx.execute({
          sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ${members.map(() => "(?, ?, ?, ?, ?)").join(", ")} ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
          args: members.flatMap(({ orgId, member }) => [
            randomBytes(16).toString("base64url"),
            orgId,
            member.email,
            member.role,
            now,
          ]),
        });
      });
      for (const org of batch) {
        hubCreated.push({
          id: org.id,
          memberCount: org.members.length,
          rosterHash: rosterHash(org.members),
        });
      }
      progress("hub", hubCreated.length, plan.hubCreates.length);
    }
    const linksByApp = groupByApp(plan.appLinks);
    let linksDone = 0;
    for (const [app, links] of linksByApp) {
      const exec = requireDb(databases, app);
      for (const batch of chunk(links, LINK_BATCH)) {
        // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
        const result = await exec.execute({
          sql: `UPDATE organizations AS o SET identity_authority = ?, identity_id = v.canonical_id, federation_roster_initialized_at = ? FROM (VALUES ${batch.map(() => "(?::text, ?::text)").join(", ")}) AS v(org_id, canonical_id) WHERE o.id = v.org_id AND o.identity_authority IS NULL AND o.identity_id IS NULL RETURNING o.id`,
          args: [
            plan.authority,
            Date.now(),
            ...batch.flatMap((link) => [link.orgId, link.canonicalId]),
          ],
        });
        const updated = new Set(result.rows.map((row) => String(row.id)));
        for (const link of batch) {
          if (updated.has(link.orgId)) appLinked.push(link);
          else appLinkSkipped.push({ app: link.app, orgId: link.orgId });
        }
        linksDone += batch.length;
        progress("links", linksDone, plan.appLinks.length);
      }
    }
  } finally {
    const file = writeManifest(
      `applied-${startedAt.replace(/[:.]/g, "-")}.json`,
      {
        startedAt,
        authority: plan.authority,
        hubCreated,
        appLinked,
        appLinkSkipped,
      },
    );
    console.log(
      JSON.stringify({
        hubCreated: hubCreated.length,
        appLinked: appLinked.length,
        appLinkSkipped: appLinkSkipped.length,
        manifest: file,
      }),
    );
  }
}

async function runVerify(databases: Databases) {
  const snapshots = await readSnapshots(databases);
  const hub = snapshots.find((snapshot) => snapshot.app === HUB_APP);
  if (!hub) throw new ScriptError("The hub snapshot is required.");
  const rostersOf = (members: AppSnapshot["members"]) => {
    const rosters = new Map<string, Map<string, string>>();
    for (const member of members) {
      const roster = rosters.get(member.orgId) ?? new Map<string, string>();
      roster.set(member.email, member.role);
      rosters.set(member.orgId, roster);
    }
    return rosters;
  };
  const sameRoster = (a: Map<string, string>, b: Map<string, string>) =>
    a.size === b.size && [...a].every(([email, role]) => b.get(email) === role);
  const hubRosters = rostersOf(hub.members);
  const hubOrgIds = new Set(hub.orgs.map((org) => org.id));

  const problems: Array<{
    app: string;
    orgId: string;
    canonicalId: string;
    problem: "missing-in-hub" | "roster-differs";
  }> = [];
  let linked = 0;
  for (const snapshot of snapshots) {
    const localRosters = rostersOf(snapshot.members);
    for (const org of snapshot.orgs) {
      if (
        org.identityAuthority !== CANONICAL_IDENTITY_SSO_HUB_URL ||
        !org.identityId
      ) {
        continue;
      }
      linked += 1;
      const canonicalId = org.identityId;
      const hubRoster = hubRosters.get(canonicalId);
      if (!hubOrgIds.has(canonicalId) || !hubRoster) {
        problems.push({
          app: snapshot.app,
          orgId: org.id,
          canonicalId,
          problem: "missing-in-hub",
        });
        continue;
      }
      const local = localRosters.get(org.id) ?? new Map<string, string>();
      if (!sameRoster(local, hubRoster)) {
        problems.push({
          app: snapshot.app,
          orgId: org.id,
          canonicalId,
          problem: "roster-differs",
        });
      }
    }
  }
  console.log(JSON.stringify({ linked, problems: problems.length }));
  for (const problem of problems) console.log(JSON.stringify(problem));
  if (problems.length > 0) process.exitCode = 1;
}

interface Manifest {
  authority: string;
  // Manifests written before the roster hash existed cannot prove a roster is
  // unchanged, so their hub rows are kept.
  hubCreated: Array<{ id: string; memberCount: number; rosterHash?: string }>;
  appLinked: Array<{ app: string; orgId: string; canonicalId: string }>;
}

class RosterChangedDuringUndo extends Error {}

async function runUndo(databases: Databases, args: readonly string[]) {
  const file = flagValue(args, "--manifest");
  if (!file) throw new ScriptError("Pass --manifest <file>.");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  const apply = args.includes("--apply");
  const confirmDelete = args.includes("--confirm-delete");
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      appLinked: manifest.appLinked.length,
      hubCreated: manifest.hubCreated.length,
    }),
  );
  if (!apply) return;
  if (manifest.hubCreated.length > 0 && !confirmDelete) {
    throw new ScriptError(
      "Undoing hub rows deletes them; pass --confirm-delete.",
    );
  }
  if (!args.includes("--allow-flag-on")) {
    for (const [app, exec] of databases) {
      const state = await readFlagState(exec);
      if (state.globalActive || state.overrides.some((o) => o.active)) {
        throw new ScriptError(
          `The federation flag is active in ${app}; undoing links while they are live can strand workspaces. Turn it off first (flag --mode off), or pass --allow-flag-on only if that is intended.`,
        );
      }
    }
  }

  // Hub rows first: the set of rows that turn out to be changed decides which
  // app links must stay, so a changed hub row never loses its workspaces.
  const hub = requireDb(databases, HUB_APP);
  let hubDeleted = 0;
  let hubGone = 0;
  const keptHubIds = new Set<string>();
  for (const batch of chunk(manifest.hubCreated, HUB_BATCH)) {
    if (!hub.transaction) {
      throw new ScriptError("The hub database does not support transactions.");
    }
    try {
      // Every check runs inside the transaction on locked rows, and the
      // delete itself returns what it removed, so a roster that changed
      // between the check and the delete rolls the whole batch back.
      const outcome = await hub.transaction(async (tx) => {
        const ids = batch.map((created) => created.id);
        // org_members has no foreign key to organizations, so block member
        // writes until this transaction ends: nothing can be inserted between
        // the roster check and the deletes and be left orphaned.
        await tx.execute({
          sql: `LOCK TABLE org_members IN SHARE ROW EXCLUSIVE MODE`,
        });
        // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
        const present = await tx.execute({
          sql: `SELECT id, identity_authority, identity_id FROM organizations WHERE id IN (${ids.map(() => "?").join(", ")}) FOR UPDATE`,
          args: ids,
        });
        const presentIds = new Set(present.rows.map((row) => String(row.id)));
        const ownedIds = present.rows
          .filter(
            (row) =>
              String(row.identity_authority ?? "") === manifest.authority &&
              String(row.identity_id ?? "") === String(row.id),
          )
          .map((row) => String(row.id));
        const rosters = new Map<
          string,
          Array<{ email: string; role: string }>
        >();
        if (ownedIds.length > 0) {
          // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
          const members = await tx.execute({
            sql: `SELECT org_id, LOWER(email) AS email, role FROM org_members WHERE org_id IN (${ownedIds.map(() => "?").join(", ")}) FOR UPDATE`,
            args: ownedIds,
          });
          for (const row of members.rows) {
            const list = rosters.get(String(row.org_id)) ?? [];
            list.push({ email: String(row.email), role: String(row.role) });
            rosters.set(String(row.org_id), list);
          }
        }
        const deletable = batch.filter(
          (created) =>
            ownedIds.includes(created.id) &&
            created.rosterHash !== undefined &&
            rosterHash(rosters.get(created.id) ?? []) === created.rosterHash,
        );
        const deletableIds = deletable.map((created) => created.id);
        let deleted = 0;
        if (deletableIds.length > 0) {
          // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
          const removed = await tx.execute({
            sql: `DELETE FROM org_members WHERE org_id IN (${deletableIds.map(() => "?").join(", ")}) RETURNING org_id, LOWER(email) AS email, role`,
            args: deletableIds,
          });
          const removedByOrg = new Map<
            string,
            Array<{ email: string; role: string }>
          >();
          for (const row of removed.rows) {
            const list = removedByOrg.get(String(row.org_id)) ?? [];
            list.push({ email: String(row.email), role: String(row.role) });
            removedByOrg.set(String(row.org_id), list);
          }
          for (const created of deletable) {
            if (
              rosterHash(removedByOrg.get(created.id) ?? []) !==
              created.rosterHash
            ) {
              throw new RosterChangedDuringUndo();
            }
          }
          // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
          const orgs = await tx.execute({
            sql: `DELETE FROM organizations WHERE id IN (${deletableIds.map(() => "?").join(", ")}) AND identity_authority = ? AND identity_id = id`,
            args: [...deletableIds, manifest.authority],
          });
          deleted = orgs.rowsAffected;
        }
        return {
          deleted,
          // Rows an earlier, interrupted undo already deleted are gone, not
          // kept: their app links still have to be unlinked on the retry.
          gone: batch.filter((created) => !presentIds.has(created.id)).length,
          kept: batch
            .filter(
              (created) =>
                presentIds.has(created.id) &&
                !deletableIds.includes(created.id),
            )
            .map((created) => created.id),
        };
      });
      hubDeleted += outcome.deleted;
      hubGone += outcome.gone;
      for (const id of outcome.kept) keptHubIds.add(id);
    } catch (error) {
      if (!(error instanceof RosterChangedDuringUndo)) throw error;
      for (const created of batch) keptHubIds.add(created.id);
    }
    progress("hub-delete", hubDeleted, manifest.hubCreated.length);
  }

  const toUnlink = manifest.appLinked.filter(
    (link) => !keptHubIds.has(link.canonicalId),
  );
  let unlinked = 0;
  for (const [app, links] of groupByApp(toUnlink)) {
    const exec = requireDb(databases, app);
    for (const batch of chunk(links, LINK_BATCH)) {
      // raw-sql-ok: the interpolated parts are `?` placeholder lists built from array lengths; every value is a bound argument
      const result = await exec.execute({
        sql: `UPDATE organizations AS o SET identity_authority = NULL, identity_id = NULL, federation_roster_initialized_at = NULL FROM (VALUES ${batch.map(() => "(?::text, ?::text)").join(", ")}) AS v(org_id, canonical_id) WHERE o.id = v.org_id AND o.identity_authority = ? AND o.identity_id = v.canonical_id`,
        args: [
          ...batch.flatMap((link) => [link.orgId, link.canonicalId]),
          manifest.authority,
        ],
      });
      unlinked += result.rowsAffected;
      progress("unlink", unlinked, toUnlink.length);
    }
  }
  console.log(
    JSON.stringify({
      unlinked,
      appLinksKept: manifest.appLinked.length - toUnlink.length,
      hubDeleted,
      hubAlreadyGone: hubGone,
      hubKeptBecauseChanged: keptHubIds.size,
    }),
  );
}

async function runFlag(databases: Databases, args: readonly string[]) {
  const mode = flagValue(args, "--mode");
  if (mode !== "on" && mode !== "off" && mode !== "emails") {
    throw new ScriptError("Pass --mode on|off|emails.");
  }
  const emails =
    mode === "emails"
      ? (flagValue(args, "--emails") ?? "")
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      : [];
  if (mode === "emails" && emails.length === 0) {
    throw new ScriptError("Pass --emails a@x.com,b@y.com.");
  }
  const apply = args.includes("--apply");

  const states = new Map<string, FlagState>();
  for (const [app, exec] of databases) {
    states.set(app, await readFlagState(exec));
  }
  const overrides: Record<string, { total: number; active: number }> = {};
  for (const [app, state] of states) {
    if (state.overrides.length > 0) {
      overrides[app] = {
        total: state.overrides.length,
        active: state.overrides.filter((o) => o.active).length,
      };
    }
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      flag: mode,
      emails: emails.length,
      workspaceOverrides: overrides,
    }),
  );
  if (mode === "off") {
    const anyActive = Object.values(overrides).some((o) => o.active > 0);
    if (anyActive && !args.includes("--disable-org-overrides")) {
      throw new ScriptError(
        "Some workspaces carry an active rule of their own, which beats the global one, so turning the flag off would leave federation on for them. Review them, then pass --disable-org-overrides to switch those off too.",
      );
    }
  } else if (
    Object.keys(overrides).length > 0 &&
    !args.includes("--allow-org-overrides")
  ) {
    throw new ScriptError(
      "Some workspaces carry their own rule for this flag, which beats the global one. Review them, then pass --allow-org-overrides.",
    );
  }
  if (!apply) return;

  const now = Date.now();
  const rules = {
    version: 1,
    mode: mode === "on" ? "on" : mode === "emails" ? "rules" : "off",
    emails,
    orgIds: [] as string[],
    percentage: 0,
    updatedAt: now,
    updatedBy: "federation-backfill",
  };
  const active = mode !== "off";
  const upsert = `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`;
  for (const [app, exec] of databases) {
    const current = await exec.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: [FLAG_INDEX_SETTING],
    });
    const row = current.rows.length > 0 ? current.rows[0] : undefined;
    const parsed: unknown = row ? JSON.parse(String(row.value)) : null;
    const keptOrgIds =
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { orgIds?: unknown }).orgIds)
        ? (parsed as { orgIds: unknown[] }).orgIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
    await exec.execute({
      sql: upsert,
      args: [FLAG_SETTING, JSON.stringify(rules), now],
    });
    if (mode === "off") {
      for (const override of states.get(app)?.overrides ?? []) {
        if (!override.active) continue;
        await exec.execute({
          sql: upsert,
          args: [
            override.key,
            JSON.stringify({
              ...override.raw,
              mode: "off",
              updatedAt: now,
              updatedBy: "federation-backfill",
            }),
            now,
          ],
        });
      }
    }
    await exec.execute({
      sql: upsert,
      args: [
        FLAG_INDEX_SETTING,
        JSON.stringify({
          version: 1,
          global: active,
          orgIds: mode === "off" ? [] : keptOrgIds,
        }),
        now,
      ],
    });
  }
  console.log(JSON.stringify({ written: databases.size, flag: mode }));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log(USAGE);
    return;
  }
  let databases: Databases | undefined;
  try {
    databases = await openDatabases();
    if (command === "plan") await runPlan(databases, args);
    else if (command === "apply") await runApply(databases, args);
    else if (command === "verify") await runVerify(databases);
    else if (command === "undo") await runUndo(databases, args);
    else if (command === "flag") await runFlag(databases, args);
    else throw new ScriptError(`Unknown command ${command}.\n${USAGE}`);
  } catch (error) {
    console.error(
      error instanceof ScriptError
        ? error.message
        : "Federation backfill failed; no successful result was confirmed. Database details are suppressed.",
    );
    process.exitCode = 1;
  } finally {
    try {
      if (databases) await closeDatabases(databases);
    } catch {
      console.error("Database connection cleanup failed.");
      process.exitCode = 1;
    }
  }
}

await main();
