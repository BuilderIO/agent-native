import { defineAction, fail } from "@agent-native/core/action";
import {
  callBrowserSession,
  listBrowserSessions,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  buildContrastAuditRequest,
  CONTRAST_AUDIT_CLIENT_ACTION,
  CONTRAST_AUDIT_RESOURCE_TYPE,
  finalizeContrastAudit,
} from "../shared/contrast-audit.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";
import { getCurrentRequestBrowserTabId } from "./_tab-state.js";

const AUDIT_TIMEOUT_MS = 60_000;

export default defineAction({
  description:
    "Check text color contrast against WCAG AA on the given slideIds, or on every slide when omitted, using axe-core in the user's open editor tab. " +
    "Requires the deck to be open in the Slides editor. Returns failures (measured vs required ratio, colors, objectId), " +
    "unverified text that could not be measured (text over images, gradients, blend modes, or filters; text over overlapping solid shapes is measured), and skipped slides. " +
    "Only claim the deck passes when canClaimContrastPasses is true; report unverified and skipped slides as not checked.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideIds: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Audit only these slides, such as the ones this turn created or changed. Omit to audit the whole deck.",
      ),
  }),
  http: false,
  readOnly: true,
  run: async ({ deckId, slideIds }) => {
    const access = await resolveAccess("deck", deckId);
    if (!access) {
      fail(`Deck not found: ${deckId}`, {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const data = JSON.parse(access.resource.data) as {
      tweaks?: unknown;
      aspectRatio?: string | null;
      slides?: Array<{
        id: string;
        content?: string;
        background?: string | null;
        imageUrl?: string | null;
        layout?: string | null;
        excalidrawData?: string | null;
      }>;
    };
    const designSystemId = resolveDeckDesignSystemId(access.resource, data);
    const designSystemAccess = designSystemId
      ? await resolveAccess("design-system", designSystemId)
      : null;
    const slides = Array.isArray(data.slides) ? data.slides : [];
    const requestedSlideIds = slideIds ? new Set(slideIds) : undefined;
    const unknownSlideIds = slideIds?.filter(
      (id) => !slides.some((slide) => slide.id === id),
    );
    if (unknownSlideIds?.length) {
      fail(
        `Slides not found in deck ${deckId}: ${unknownSlideIds.join(", ")}`,
        {
          errorCode: "slide_not_found",
          statusCode: 404,
        },
      );
    }
    const request = buildContrastAuditRequest(
      deckId,
      {
        designSystemId,
        designSystemData: designSystemAccess?.resource.data ?? null,
        tweaks: data.tweaks,
        aspectRatio: data.aspectRatio,
        slides,
      },
      requestedSlideIds ? (id) => requestedSlideIds.has(id) : undefined,
    );

    const sessions = (await listBrowserSessions(ownerEmail)).filter(
      (session) =>
        session.context?.resource &&
        typeof session.context.resource === "object" &&
        (session.context.resource as { type?: unknown; id?: unknown }).type ===
          CONTRAST_AUDIT_RESOURCE_TYPE &&
        (session.context.resource as { id?: unknown }).id === deckId &&
        session.actions.some(
          (action) => action.name === CONTRAST_AUDIT_CLIENT_ACTION,
        ),
    );
    if (sessions.length === 0) {
      fail(
        "Contrast can only be audited while this deck is open in the Slides editor. Ask the user to open it, then retry.",
        { errorCode: "deck_not_open", statusCode: 409 },
      );
    }
    const callerTabId = getCurrentRequestBrowserTabId();
    const session =
      sessions.find((candidate) => candidate.sessionId === callerTabId) ??
      sessions[0];

    const raw = await callBrowserSession(
      ownerEmail,
      session.sessionId,
      {
        type: "run-action",
        name: CONTRAST_AUDIT_CLIENT_ACTION,
        args: request,
        timeoutMs: AUDIT_TIMEOUT_MS,
      },
      { timeoutMs: AUDIT_TIMEOUT_MS },
    );
    return finalizeContrastAudit(request, raw);
  },
});
