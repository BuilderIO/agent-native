import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  CONTENT_WELCOME_PAGE_STATE_KEY,
  type ContentLandingResolution,
  type ContentLastLocationState,
  type ContentWelcomePageState,
} from "../shared/content-landing.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { normalizeContentSpaceEmail } from "./_content-space-access.js";
import { personalContentSpaceId } from "./_content-spaces.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import createDocumentAction from "./create-document.js";

const WELCOME_TITLE = "Welcome to Agent-Native Content";
const WELCOME_CONTENT = `Start here with a page that is wholly yours.

- Write a note, plan, or draft.
- Use the sidebar to find and organize your work.
- Ask the agent when you want a hand.`;

function welcomeDocumentId(userEmail: string, generation: number) {
  const identity = normalizeContentSpaceEmail(userEmail);
  const input = generation === 0 ? identity : `${identity}:${generation}`;
  const digest = createHash("sha256").update(input).digest("hex");
  return `content_welcome_${digest.slice(0, 32)}`;
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

async function resolveWelcomeState(): Promise<ContentWelcomePageState> {
  while (true) {
    const current = await readAppState(CONTENT_WELCOME_PAGE_STATE_KEY);
    if (current) return { generation: welcomeGeneration(current) };

    const initial = { generation: 0 };
    if (
      await compareAndSetAppState(CONTENT_WELCOME_PAGE_STATE_KEY, null, initial)
    ) {
      return initial;
    }
  }
}
function savedDocumentId(state: Record<string, unknown> | null): string | null {
  const candidate = state as ContentLastLocationState | null;
  return typeof candidate?.documentId === "string" && candidate.documentId
    ? candidate.documentId
    : null;
}

async function resolveUsableDocument(documentId: string) {
  const access = await resolveContentDocumentAccess(documentId);
  if (!access?.resource || access.resource.trashedAt) return null;
  if (await isSoftDeletedDatabaseDocument(documentId)) return null;
  return access.resource;
}

async function resolveWelcomeDocument(userEmail: string, generation: number) {
  const documentId = welcomeDocumentId(userEmail, generation);
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

  const normalizedEmail = normalizeContentSpaceEmail(userEmail);
  if (
    normalizeContentSpaceEmail(document.ownerEmail) !== normalizedEmail ||
    document.spaceId !== personalContentSpaceId(normalizedEmail) ||
    document.parentId !== null ||
    document.visibility !== "private"
  ) {
    return { status: "unavailable" as const };
  }
  return { status: "usable" as const, documentId };
}

async function resolveWelcome(userEmail: string): Promise<{
  documentId: string;
  resolution: Extract<
    ContentLandingResolution,
    "welcome-created" | "welcome-reused"
  >;
}> {
  const normalizedEmail = normalizeContentSpaceEmail(userEmail);
  while (true) {
    const state = await resolveWelcomeState();
    const existing = await resolveWelcomeDocument(
      normalizedEmail,
      state.generation,
    );
    if (existing.status === "usable") {
      return {
        documentId: existing.documentId,
        resolution: "welcome-reused",
      };
    }

    if (existing.status === "unavailable") {
      await compareAndSetAppState(CONTENT_WELCOME_PAGE_STATE_KEY, state, {
        generation: state.generation + 1,
      });
      continue;
    }

    const documentId = welcomeDocumentId(normalizedEmail, state.generation);
    try {
      await runWithRequestContext({ userEmail: normalizedEmail }, () =>
        createDocumentAction.run({
          id: documentId,
          title: WELCOME_TITLE,
          content: WELCOME_CONTENT,
        }),
      );
      return { documentId, resolution: "welcome-created" };
    } catch (error) {
      const raced = await resolveWelcomeDocument(
        normalizedEmail,
        state.generation,
      );
      if (raced.status === "usable") {
        return {
          documentId: raced.documentId,
          resolution: "welcome-reused",
        };
      }
      if (raced.status === "unavailable") continue;
      throw error;
    }
  }
}

export default defineAction({
  description:
    "Resolve the signed-in user's safe Content landing page, restoring an authorized last page when possible.",
  schema: z.object({}),
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");

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
