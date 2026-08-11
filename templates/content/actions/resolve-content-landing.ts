import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  type ContentLandingResolution,
  type ContentLastLocationState,
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

function welcomeDocumentId(userEmail: string) {
  const identity = normalizeContentSpaceEmail(userEmail);
  const digest = createHash("sha256").update(identity).digest("hex");
  return `content_welcome_${digest.slice(0, 32)}`;
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

async function resolveWelcomeDocument(userEmail: string) {
  const documentId = welcomeDocumentId(userEmail);
  const document = await resolveUsableDocument(documentId);
  if (!document) return null;

  const normalizedEmail = normalizeContentSpaceEmail(userEmail);
  if (
    normalizeContentSpaceEmail(document.ownerEmail) !== normalizedEmail ||
    document.spaceId !== personalContentSpaceId(normalizedEmail) ||
    document.parentId !== null ||
    document.visibility !== "private" ||
    document.title !== WELCOME_TITLE
  ) {
    return null;
  }
  return documentId;
}

async function resolveWelcome(userEmail: string): Promise<{
  documentId: string;
  resolution: Extract<
    ContentLandingResolution,
    "welcome-created" | "welcome-reused"
  >;
}> {
  const existing = await resolveWelcomeDocument(userEmail);
  if (existing) return { documentId: existing, resolution: "welcome-reused" };

  const documentId = welcomeDocumentId(userEmail);
  const normalizedEmail = normalizeContentSpaceEmail(userEmail);
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
    // The stable per-user document ID is the cross-request convergence point.
    // A competing request can own the insert; only reuse it after the complete
    // personal-page invariant has been rechecked.
    const raced = await resolveWelcomeDocument(userEmail);
    if (raced) return { documentId: raced, resolution: "welcome-reused" };
    throw error;
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
