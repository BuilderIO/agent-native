import { createHash, randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  listAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  CONTENT_WELCOME_PAGE_STATE_KEY,
  contentSpaceLastLocationStateKey,
  contentSpaceWelcomePageStateKey,
  type ContentLandingResolution,
  type ContentLastLocationState,
  type ContentSpaceLandingResult,
  type ContentWelcomePageState,
} from "../shared/content-landing.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import {
  normalizeContentSpaceEmail,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";
import { personalContentSpaceId } from "./_content-spaces.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";
import createDocumentAction from "./create-document.js";

const WELCOME_TITLE = "Welcome to Agent-Native Content";
const WELCOME_CONTENT = `Start here with a page that is wholly yours.

- Write a note, plan, or draft.
- Use the sidebar to find and organize your work.
- Ask the agent when you want a hand.`;

function legacyWelcomeDocumentId(userEmail: string, generation: number) {
  const identity = normalizeContentSpaceEmail(userEmail);
  const input = generation === 0 ? identity : `${identity}:${generation}`;
  const digest = createHash("sha256").update(input).digest("hex");
  return `content_welcome_${digest.slice(0, 32)}`;
}

function spaceWelcomeDocumentId(spaceId: string, generation: number) {
  const input = generation === 0 ? spaceId : `${spaceId}:${generation}`;
  const digest = createHash("sha256").update(input).digest("hex");
  return `content_welcome_${digest.slice(0, 32)}`;
}

function randomWelcomeDocumentId() {
  return `content_welcome_${randomUUID().replace(/-/g, "")}`;
}

function welcomeGeneration(state: Record<string, unknown>): number {
  const candidate = state as ContentWelcomePageState;
  if (
    typeof candidate.generation !== "number" ||
    !Number.isSafeInteger(candidate.generation) ||
    candidate.generation < 0
  ) {
    throw new Error("Content welcome page state has an invalid generation");
  }
  return candidate.generation;
}

function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const code =
      typeof candidate.code === "string"
        ? candidate.code
        : (JSON.stringify(candidate.code) ?? "");
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : (JSON.stringify(candidate.message) ?? "");
    if (
      code === "23505" ||
      /unique constraint|unique violation|duplicate key/i.test(message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

async function resolveWelcomeState(stateKey: string): Promise<{
  generation: number;
  documentId: string | null;
  expectedValue: Record<string, unknown>;
}> {
  while (true) {
    const entries = await listAppState(stateKey);
    const entry = entries.find(({ key }) => key === stateKey);
    if (entry) {
      if (!entry.value || typeof entry.value !== "object") {
        throw new Error("Content welcome page state must be an object");
      }
      return {
        generation: welcomeGeneration(entry.value),
        documentId:
          typeof entry.value.documentId === "string" && entry.value.documentId
            ? entry.value.documentId
            : null,
        expectedValue: entry.value,
      };
    }

    const initial = { generation: 0 };
    if (await compareAndSetAppState(stateKey, null, initial)) {
      return { generation: 0, documentId: null, expectedValue: initial };
    }
  }
}
function savedDocumentId(state: Record<string, unknown> | null): string | null {
  const candidate = state as ContentLastLocationState | null;
  return typeof candidate?.documentId === "string" && candidate.documentId
    ? candidate.documentId
    : null;
}

function savedTarget(
  state: Record<string, unknown> | null,
): ContentLastLocationState | null {
  const documentId = savedDocumentId(state);
  if (!documentId) return null;
  return {
    documentId,
    ...(typeof state?.databaseId === "string" && state.databaseId
      ? { databaseId: state.databaseId }
      : {}),
    ...(typeof state?.viewId === "string" && state.viewId
      ? { viewId: state.viewId }
      : {}),
  };
}

async function resolveUsableDocument(documentId: string) {
  const access = await resolveContentDocumentAccess(documentId);
  if (!access?.resource || access.resource.trashedAt) return null;
  if (await isSoftDeletedDatabaseDocument(documentId)) return null;
  return access.resource;
}

async function resolveUsableSpaceTarget(
  spaceId: string,
  target: ContentLastLocationState,
): Promise<ContentLastLocationState | null> {
  const db = getDb();
  const spaceAccess = await resolveContentSpaceAccess(spaceId, "viewer", {
    db,
  });
  const documentAccess = await resolveContentDocumentAccess(target.documentId);
  const document = documentAccess?.resource;
  if (
    !document ||
    document.trashedAt ||
    document.spaceId !== spaceId ||
    (await isSoftDeletedDatabaseDocument(target.documentId))
  ) {
    return null;
  }
  const [membership] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(
          schema.contentDatabaseItems.databaseId,
          spaceAccess.space.filesDatabaseId,
        ),
        eq(schema.contentDatabaseItems.documentId, target.documentId),
      ),
    )
    .limit(1);
  if (!membership) return null;
  if (!target.databaseId) return { documentId: target.documentId };
  const [database] = await db
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
      viewConfigJson: schema.contentDatabases.viewConfigJson,
    })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, target.databaseId),
        eq(schema.contentDatabases.documentId, target.documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .limit(1);
  if (!database) return null;
  const config = parseDatabaseViewConfig(database.viewConfigJson);
  const viewId = target.viewId
    ? config.views.some((view) => view.id === target.viewId)
      ? target.viewId
      : (
          config.views.find((view) => view.id === config.activeViewId) ??
          config.views[0]
        )?.id
    : undefined;
  return {
    documentId: database.documentId,
    databaseId: database.id,
    ...(viewId ? { viewId } : {}),
  };
}

async function resolveWelcomeDocument(spaceId: string, documentId: string) {
  const access = await resolveContentDocumentAccess(documentId);
  const document = access?.resource;
  if (!document) {
    return (await isSoftDeletedDatabaseDocument(documentId))
      ? { status: "unavailable" as const }
      : { status: "missing" as const };
  }
  if (document.trashedAt || (await isSoftDeletedDatabaseDocument(documentId))) {
    return { status: "unavailable" as const };
  }

  if (document.spaceId !== spaceId || document.parentId !== null) {
    return { status: "unavailable" as const };
  }
  const db = getDb();
  const [membership] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabases.spaceId, spaceId),
        eq(schema.contentDatabases.systemRole, "files"),
        eq(schema.contentDatabaseItems.documentId, documentId),
      ),
    )
    .limit(1);
  if (!membership) return { status: "unavailable" as const };
  return { status: "usable" as const, documentId };
}

async function resolveWelcome(
  userEmail: string,
  requestedSpaceId?: string,
): Promise<{
  documentId: string | null;
  resolution:
    | Extract<ContentLandingResolution, "welcome-created" | "welcome-reused">
    | "welcome-unavailable";
  fallbackReason?: "welcome-create-forbidden";
}> {
  const normalizedEmail = normalizeContentSpaceEmail(userEmail);
  const spaceId = requestedSpaceId ?? personalContentSpaceId(normalizedEmail);
  if (requestedSpaceId) {
    await resolveContentSpaceAccess(spaceId, "viewer");
  }
  const isPersonal = spaceId === personalContentSpaceId(normalizedEmail);
  const stateKey = isPersonal
    ? CONTENT_WELCOME_PAGE_STATE_KEY
    : contentSpaceWelcomePageStateKey(spaceId);
  while (true) {
    const state = await resolveWelcomeState(stateKey);
    const documentId =
      state.documentId ??
      (isPersonal
        ? legacyWelcomeDocumentId(normalizedEmail, state.generation)
        : spaceWelcomeDocumentId(spaceId, state.generation));
    const existing = await resolveWelcomeDocument(spaceId, documentId);
    if (existing.status === "usable") {
      if (!state.documentId) {
        await compareAndSetAppState(stateKey, state.expectedValue, {
          ...state.expectedValue,
          documentId,
        });
      }
      return {
        documentId: existing.documentId,
        resolution: "welcome-reused",
      };
    }

    if (!state.documentId || existing.status === "unavailable") {
      await compareAndSetAppState(stateKey, state.expectedValue, {
        ...state.expectedValue,
        generation: state.generation + 1,
        documentId: isPersonal
          ? randomWelcomeDocumentId()
          : spaceWelcomeDocumentId(spaceId, state.generation + 1),
      });
      continue;
    }

    try {
      await runWithRequestContext({ userEmail: normalizedEmail }, () =>
        createDocumentAction.run({
          id: documentId,
          spaceId,
          title: WELCOME_TITLE,
          content: WELCOME_CONTENT,
        }),
      );
      return { documentId, resolution: "welcome-created" };
    } catch (error) {
      const raced = await resolveWelcomeDocument(spaceId, documentId);
      if (raced.status === "usable") {
        return {
          documentId: raced.documentId,
          resolution: "welcome-reused",
        };
      }
      if (raced.status === "unavailable") continue;
      if (isUniqueConstraintError(error)) {
        await compareAndSetAppState(stateKey, state.expectedValue, {
          ...state.expectedValue,
          generation: state.generation + 1,
          documentId: isPersonal
            ? randomWelcomeDocumentId()
            : spaceWelcomeDocumentId(spaceId, state.generation + 1),
        });
        continue;
      }
      if (
        error instanceof Error &&
        /Contributor access is required/.test(error.message)
      ) {
        return {
          documentId: null,
          resolution: "welcome-unavailable",
          fallbackReason: "welcome-create-forbidden",
        };
      }
      throw error;
    }
  }
}

export default defineAction({
  description:
    "Resolve the signed-in user's safe Content landing page, restoring an authorized last page when possible.",
  schema: z.object({ spaceId: z.string().min(1).max(256).optional() }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");

    const spaceId = args.spaceId;
    if (spaceId) {
      const lastLocation = await readAppState(
        contentSpaceLastLocationStateKey(spaceId),
      );
      const target = savedTarget(lastLocation);
      const restored = target
        ? await resolveUsableSpaceTarget(spaceId, target)
        : null;
      if (restored) {
        return {
          target: restored,
          resolution: "restored" as const,
        } satisfies ContentSpaceLandingResult;
      }
      const welcome = await resolveWelcome(userEmail, spaceId);
      if (!welcome.documentId || welcome.resolution === "welcome-unavailable") {
        return {
          target: null,
          resolution: "welcome-unavailable" as const,
          fallbackReason: "welcome-create-forbidden" as const,
        } satisfies ContentSpaceLandingResult;
      }
      return {
        target: { documentId: welcome.documentId },
        resolution: target ? ("fallback" as const) : welcome.resolution,
        ...(target
          ? { fallbackReason: "saved-document-unavailable" as const }
          : {}),
      } satisfies ContentSpaceLandingResult;
    }

    const lastLocation = await readAppState(CONTENT_LAST_LOCATION_STATE_KEY);
    const lastDocumentId = savedDocumentId(lastLocation);
    if (lastDocumentId && (await resolveUsableDocument(lastDocumentId))) {
      return { documentId: lastDocumentId, resolution: "restored" as const };
    }

    const welcome = await resolveWelcome(userEmail);
    if (lastDocumentId) {
      return {
        documentId: welcome.documentId,
        resolution: "fallback" as const,
        fallbackReason: "saved-document-unavailable" as const,
      };
    }
    return welcome;
  },
});
