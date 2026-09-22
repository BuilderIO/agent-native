import { randomBytes, randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hashTrashScopeToken } from "../server/lib/content-trash-purge.js";
import type { ContentTrashPurgePlanResponse } from "../shared/content-trash.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import { resolveTrashPurgeProvenance } from "./_content-trash-purge-scope.js";
import {
  contentTrashFilterFields,
  contentTrashPredicates,
  validateContentTrashDateRange,
} from "./_content-trash-query.js";
import { inspectPermanentDeleteRelationships } from "./delete-document.js";

export const contentTrashFiltersSchema = z
  .object(contentTrashFilterFields)
  .superRefine(validateContentTrashDateRange);

const inputSchema = z
  .object({
    mode: z.enum(["selection", "matching", "scope"]),
    documentIds: z.array(z.string().min(1).max(200)).max(10_000).optional(),
    filters: contentTrashFiltersSchema.optional(),
    spaceId: z.string().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "selection" && !value.documentIds?.length) {
      ctx.addIssue({
        code: "custom",
        message: "documentIds are required for selection",
      });
    }
    if (value.mode === "matching" && !value.filters) {
      ctx.addIssue({
        code: "custom",
        message: "filters are required for matching",
      });
    }
  });

export default defineAction({
  description:
    "Freeze and review an exact permanent-deletion plan for selected, matching, or scoped Trash. Scope mode intentionally ignores browsing filters.",
  schema: inputSchema,
  run: async (args): Promise<ContentTrashPurgePlanResponse> => {
    const actorEmail = getRequestUserEmail();
    if (!actorEmail) {
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    const db = getDb();
    const normalizedActorEmail = actorEmail.toLowerCase();
    const memberships = await listContentOrganizationMemberships(actorEmail);
    const document = schema.documents;
    const database = schema.contentDatabases;
    const host = alias(document, "purge_host");
    const parent = alias(document, "purge_parent");
    const space = schema.contentSpaces;
    const canonicalDatabaseId = sql<string>`(select min(${database.id}) from ${database} where ${database.documentId} = ${document.id})`;
    const { authority, deletedAt } = contentTrashPredicates(
      document,
      database,
      accessFilter(document, schema.documentShares, undefined, "admin"),
      accessFilter(document, schema.documentShares),
      accessFilter(host, schema.documentShares, undefined, "editor"),
    );
    const originalParent = sql<string>`coalesce(${document.trashParentId}, ${document.parentId})`;
    const filters = args.mode === "matching" ? args.filters : undefined;
    const selected = await db
      .select({
        id: document.id,
        rootId: document.trashRootId,
        title: document.title,
        ownerEmail: document.ownerEmail,
        parentId: document.parentId,
        spaceId: document.spaceId,
        trashedAt: document.trashedAt,
        effectiveDeletedAt: deletedAt,
        sourceMode: document.sourceMode,
        databaseId: database.id,
        databaseDeletedAt: database.deletedAt,
        systemRole: database.systemRole,
      })
      .from(document)
      .leftJoin(database, eq(database.id, canonicalDatabaseId))
      .leftJoin(host, eq(host.id, database.ownerDocumentId))
      .leftJoin(
        parent,
        and(
          eq(parent.id, originalParent),
          accessFilter(parent, schema.documentShares),
        ),
      )
      .leftJoin(
        space,
        and(
          eq(space.id, document.spaceId),
          isNull(space.archivedAt),
          or(
            and(
              isNull(space.orgId),
              sql`lower(${space.ownerEmail}) = ${normalizedActorEmail}`,
            ),
            memberships.length
              ? inArray(
                  space.orgId,
                  memberships.map((item) => item.orgId),
                )
              : sql`false`,
          ),
        ),
      )
      .where(
        and(
          isNotNull(deletedAt),
          authority,
          args.mode === "selection"
            ? inArray(document.id, [...new Set(args.documentIds ?? [])])
            : undefined,
          args.mode === "scope" && args.spaceId
            ? eq(space.id, args.spaceId)
            : undefined,
          args.mode === "matching" && filters?.spaceId
            ? eq(space.id, filters.spaceId)
            : undefined,
          filters?.query
            ? sql`lower(${document.title}) like ${`%${filters.query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`
            : undefined,
          filters?.kind === "page"
            ? isNull(database.id)
            : filters?.kind === "database"
              ? isNotNull(database.id)
              : undefined,
          filters?.parentId ? eq(parent.id, filters.parentId) : undefined,
          filters?.actor ? eq(document.trashedBy, filters.actor) : undefined,
          filters?.createdBy
            ? sql`lower(${document.createdBy}) = ${filters.createdBy.toLowerCase()}`
            : undefined,
          filters?.updatedBy
            ? sql`lower(${document.updatedBy}) = ${filters.updatedBy.toLowerCase()}`
            : undefined,
          filters?.deletedFrom
            ? sql`${deletedAt} >= ${filters.deletedFrom}`
            : undefined,
          filters?.deletedTo
            ? sql`${deletedAt} <= ${filters.deletedTo}`
            : undefined,
        ),
      );
    if (
      args.mode === "selection" &&
      selected.length !== new Set(args.documentIds ?? []).size
    ) {
      fail("One or more selected Trash items are unavailable", {
        errorCode: "scope_changed",
        statusCode: 409,
      });
    }

    if (selected.length === 0) {
      fail("No manageable Trash items matched this scope", {
        errorCode: "empty_scope",
        statusCode: 409,
      });
    }

    const candidateRoots = new Set(
      selected.map((item) => item.rootId ?? item.id),
    );
    const availableDocument = alias(document, "purge_available_document");
    const availableDatabase = alias(database, "purge_available_database");
    const availableHost = alias(document, "purge_available_host");
    const availableCanonicalDatabaseId = sql<string>`(select min(${database.id}) from ${database} where ${database.documentId} = ${availableDocument.id})`;
    const { authority: availableAuthority, deletedAt: availableDeletedAt } =
      contentTrashPredicates(
        availableDocument,
        availableDatabase,
        accessFilter(
          availableDocument,
          schema.documentShares,
          undefined,
          "admin",
        ),
        accessFilter(availableDocument, schema.documentShares),
        accessFilter(availableHost, schema.documentShares, undefined, "editor"),
      );
    const authorizedDescendants = await db
      .select({
        id: availableDocument.id,
        rootId: availableDocument.trashRootId,
        title: availableDocument.title,
        ownerEmail: availableDocument.ownerEmail,
        parentId: availableDocument.parentId,
        spaceId: availableDocument.spaceId,
        trashedAt: availableDocument.trashedAt,
        sourceMode: availableDocument.sourceMode,
      })
      .from(availableDocument)
      .leftJoin(
        availableDatabase,
        eq(availableDatabase.id, availableCanonicalDatabaseId),
      )
      .leftJoin(
        availableHost,
        eq(availableHost.id, availableDatabase.ownerDocumentId),
      )
      .where(
        and(
          inArray(availableDocument.trashRootId, [...candidateRoots]),
          isNotNull(availableDeletedAt),
          availableAuthority,
        ),
      );
    const available = [
      ...new Map(
        [
          ...authorizedDescendants,
          ...selected
            .filter((item) => item.trashedAt !== null)
            .map((item) => ({
              id: item.id,
              rootId: item.rootId,
              title: item.title,
              ownerEmail: item.ownerEmail,
              parentId: item.parentId,
              spaceId: item.spaceId,
              trashedAt: item.trashedAt,
              sourceMode: item.sourceMode,
            })),
        ].map((item) => [item.id, item]),
      ).values(),
    ];
    const selectedIds = new Set(selected.map((item) => item.id));
    const availableById = new Map(available.map((item) => [item.id, item]));
    const seedIds =
      args.mode === "scope"
        ? new Set(available.map((item) => item.id))
        : selectedIds;
    const includesSelectedAncestor = (item: (typeof available)[number]) => {
      let current: (typeof available)[number] | undefined = item;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        if (seedIds.has(current.id)) return true;
        seen.add(current.id);
        current = current.parentId
          ? availableById.get(current.parentId)
          : undefined;
      }
      return false;
    };
    const frozen = available.filter(includesSelectedAncestor);
    const legacyBlocked = selected
      .filter((item) => !item.trashedAt && Boolean(item.databaseDeletedAt))
      .map((item) => ({
        id: item.id,
        rootId: item.rootId,
        title: item.title,
        ownerEmail: item.ownerEmail,
        parentId: null,
        spaceId: item.spaceId,
        trashedAt: item.effectiveDeletedAt,
        sourceMode: item.sourceMode,
      }));
    const frozenItems = [
      ...new Map(
        [...frozen, ...legacyBlocked].map((item) => [item.id, item]),
      ).values(),
    ];
    const frozenIds = frozenItems.map((item) => item.id);
    const provenance = await resolveTrashPurgeProvenance(frozenItems);
    const ownedDatabases = frozenIds.length
      ? await db
          .select({
            id: database.id,
            documentId: database.documentId,
            systemRole: database.systemRole,
          })
          .from(database)
          .where(inArray(database.documentId, frozenIds))
      : [];
    const databaseByDocument = new Map(
      ownedDatabases.map((item) => [item.documentId, item]),
    );
    const itemById = new Map(frozenItems.map((item) => [item.id, item]));
    const survivorEffects = new Map<string, string[]>();
    const addSurvivorEffect = (documentId: string, effect: string) => {
      const effects = survivorEffects.get(documentId) ?? [];
      effects.push(effect);
      survivorEffects.set(documentId, effects);
    };
    const sourceDatabaseIds = new Set(
      ownedDatabases.length
        ? (
            await db
              .select({ databaseId: schema.contentDatabaseSources.databaseId })
              .from(schema.contentDatabaseSources)
              .where(
                inArray(
                  schema.contentDatabaseSources.databaseId,
                  ownedDatabases.map((item) => item.id),
                ),
              )
          ).map((item) => item.databaseId)
        : [],
    );

    const unitBlockers = new Map<string, string>();
    const unitByItem = new Map<string, string>();
    for (const item of frozenItems) {
      let current = item;
      let unitId = item.id;
      const seen = new Set<string>();
      while (!seen.has(current.id)) {
        seen.add(current.id);
        if (seedIds.has(current.id)) unitId = current.id;
        const parent = current.parentId
          ? itemById.get(current.parentId)
          : undefined;
        if (!parent) break;
        current = parent;
      }
      unitByItem.set(
        item.id,
        args.mode === "scope" ? (item.rootId ?? item.id) : unitId,
      );
    }
    const ancestorUnits = new Map<string, string[]>();
    for (const item of frozenItems) {
      const units: string[] = [];
      let parent = item.parentId ? itemById.get(item.parentId) : undefined;
      while (parent) {
        const parentUnit = unitByItem.get(parent.id) ?? parent.id;
        if (
          parentUnit !== unitByItem.get(item.id) &&
          !units.includes(parentUnit)
        ) {
          units.push(parentUnit);
        }
        parent = parent.parentId ? itemById.get(parent.parentId) : undefined;
      }
      ancestorUnits.set(item.id, units);
    }
    if (ownedDatabases.length) {
      const memberships = await db
        .select({
          databaseId: schema.contentDatabaseItems.databaseId,
          documentId: schema.contentDatabaseItems.documentId,
        })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          document,
          eq(document.id, schema.contentDatabaseItems.documentId),
        )
        .where(
          and(
            inArray(
              schema.contentDatabaseItems.databaseId,
              ownedDatabases.map((item) => item.id),
            ),
            accessFilter(document, schema.documentShares),
          ),
        );
      const databaseOwnerUnit = new Map(
        ownedDatabases.map((item) => [
          item.id,
          unitByItem.get(item.documentId) ?? item.documentId,
        ]),
      );
      for (const membership of memberships) {
        const memberUnit = unitByItem.get(membership.documentId);
        const ownerUnit = databaseOwnerUnit.get(membership.databaseId);
        if (!memberUnit || !ownerUnit || memberUnit === ownerUnit) continue;
        const ancestors = ancestorUnits.get(membership.documentId) ?? [];
        if (!ancestors.includes(ownerUnit)) ancestors.push(ownerUnit);
        ancestorUnits.set(membership.documentId, ancestors);
      }
    }
    for (const item of frozenItems) {
      const ownedDatabase = databaseByDocument.get(item.id);
      const blocker = item.sourceMode
        ? "source-backed content cannot be permanently deleted"
        : ownedDatabase?.systemRole
          ? "system content cannot be permanently deleted"
          : ownedDatabase && sourceDatabaseIds.has(ownedDatabase.id)
            ? "source-connected databases cannot be permanently deleted"
            : null;
      if (blocker)
        unitBlockers.set(unitByItem.get(item.id) ?? item.id, blocker);
    }
    for (const item of selected) {
      if (!item.trashedAt && item.databaseDeletedAt) {
        unitBlockers.set(
          unitByItem.get(item.id) ?? item.id,
          "legacy database Trash requires restore or migration",
        );
      }
    }

    let propagated = true;
    while (propagated) {
      propagated = false;
      for (const item of frozenItems) {
        const unitId = unitByItem.get(item.id) ?? item.id;
        if (!unitBlockers.has(unitId)) continue;
        for (const parentUnit of ancestorUnits.get(item.id) ?? []) {
          if (unitBlockers.has(parentUnit)) continue;
          unitBlockers.set(
            parentUnit,
            "a blocked descendant would change the confirmed survivor effects",
          );
          propagated = true;
        }
      }
    }

    const planId = randomUUID();
    const scopeToken = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const unitFingerprints = new Map<string, string>();
    for (const unitId of new Set(unitByItem.values())) {
      const unitItems = frozenItems.filter(
        (item) => unitByItem.get(item.id) === unitId,
      );
      const relationships = await inspectPermanentDeleteRelationships(
        db,
        unitItems.map((item) => item.id),
        unitItems[0]!.ownerEmail,
      );
      unitFingerprints.set(unitId, relationships.fingerprint);
      if (relationships.inaccessibleRelationship) {
        unitBlockers.set(
          unitId,
          "related content is outside the manageable deletion scope",
        );
        continue;
      }
      for (const survivor of relationships.survivingChildren) {
        if (!survivor.parentId) continue;
        const parent = itemById.get(survivor.parentId);
        if (!parent || survivor.trashRootId === (parent.rootId ?? parent.id)) {
          continue;
        }
        addSurvivorEffect(
          survivor.parentId,
          `“${survivor.title}” will move to the top level`,
        );
      }
      const databaseById = new Map(
        relationships.databases.map((database) => [database.id, database]),
      );
      const survivorById = new Map(
        relationships.membershipSurvivors.map((survivor) => [
          survivor.id,
          survivor,
        ]),
      );
      for (const membership of relationships.memberships) {
        const survivor = survivorById.get(membership.documentId);
        const owner = databaseById.get(membership.databaseId);
        if (survivor?.trashedAt && owner) {
          addSurvivorEffect(
            owner.documentId,
            `“${survivor.title}” will be removed from this collection`,
          );
        }
      }
    }
    const eligibleCount = frozenItems.filter(
      (item) => !unitBlockers.has(unitByItem.get(item.id) ?? item.id),
    ).length;
    const blockedCount = frozenItems.length - eligibleCount;
    await db.transaction(async (tx) => {
      await tx.insert(schema.contentTrashPurgePlans).values({
        id: planId,
        actorEmail,
        orgId: provenance.orgId,
        mode: args.mode,
        spaceId: args.spaceId ?? filters?.spaceId ?? provenance.spaceId,
        filtersJson: JSON.stringify(filters ?? {}),
        state: "ready",
        scopeTokenHash: hashTrashScopeToken(scopeToken),
        eligibleCount,
        blockedCount,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      if (frozenItems.length > 0) {
        await tx.insert(schema.contentTrashPurgePlanItems).values(
          frozenItems.map((item) => {
            const unitId = unitByItem.get(item.id) ?? item.id;
            const blocker = unitBlockers.get(unitId) ?? null;
            return {
              id: randomUUID(),
              planId,
              unitId,
              rootDocumentId: unitId,
              documentId: item.id,
              ownerEmail: item.ownerEmail as string,
              title: item.title,
              spaceId: item.spaceId,
              expectedTrashedAt: item.trashedAt!,
              expectedParentId: item.parentId,
              expectedScopeFingerprint: unitFingerprints.get(unitId)!,
              ancestorUnitIdsJson: JSON.stringify(
                ancestorUnits.get(item.id) ?? [],
              ),
              survivorEffect: survivorEffects.get(item.id)?.join("; ") ?? null,
              eligibility: blocker ? "blocked" : "eligible",
              blocker,
              outcome: blocker ? "blocked" : "pending",
              outcomeDetail: blocker,
              createdAt: now,
            };
          }),
        );
      }
    });
    return {
      planId,
      scopeToken,
      state: "ready",
      eligibleCount,
      blockedCount,
      affectedPreview: frozenItems.slice(0, 50).map((item) => ({
        documentId: item.id,
        title: item.title,
        eligible: !unitBlockers.has(unitByItem.get(item.id) ?? item.id),
        blocker: unitBlockers.get(unitByItem.get(item.id) ?? item.id) ?? null,
        survivorEffect: survivorEffects.get(item.id)?.join("; ") ?? null,
      })),
      filtersIgnored: args.mode === "scope" && Boolean(args.filters),
    };
  },
});
