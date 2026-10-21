import {
  defineAction,
  fail,
  type WriteReceipt,
} from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getBuiltInDeckTemplate } from "../server/lib/deck-templates.js";
import {
  legacySlideDesignTokensFromHtml,
  legacySlideHtmlToSource,
} from "../server/lib/legacy-slide-source.js";
import { isSlides2DeckData } from "../shared/deck-app-scope.js";
import { assertHumanReadableDeckTitle } from "../shared/deck-title.js";
import { slideDesignTokensSchema } from "../shared/slide-design-tokens.js";
import { getDeckUrl } from "./_app-url.js";
import { compileSlideSource } from "./_slide-source.js";
import addDeck from "./add-deck.js";

const savedCopySchema = z.object({
  id: z.string(),
  appId: z.literal("slides-2"),
  designTokens: slideDesignTokensSchema,
  slides: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      sourceTsx: z.string().min(1),
      revision: z.number().int().positive(),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  templateSource: z.object({
    templateId: z.string(),
    version: z.number(),
    createdTitle: z.string(),
  }),
});

function conflict(): never {
  return fail(
    "This copy request cannot be reused. Start a new copy with a new ID.",
    {
      statusCode: 409,
      errorCode: "deck_template_copy_conflict",
    },
  );
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function copyReceipt(id: string, changed: boolean): WriteReceipt {
  return changed
    ? {
        changed: true,
        verified: true,
        summary: "Created a template copy and verified that it was saved.",
        subject: id,
        checks: [
          {
            id: "template-copy-persisted",
            ok: true,
            detail: "The saved deck is accessible in the caller's scope.",
          },
        ],
      }
    : {
        changed: false,
        verified: true,
        summary: "Reused the existing template copy; no changes were made.",
        subject: id,
      };
}

async function readRetry(
  id: string,
  ownerEmail: string,
  orgId: string | null,
  templateId: string,
  version: number,
  createdTitle: string,
) {
  const access = await resolveAccess("deck", id);
  if (!access) return null;
  const row = access.resource;
  if (
    row.ownerEmail?.toLowerCase() !== ownerEmail.toLowerCase() ||
    row.orgId !== orgId
  )
    conflict();
  if (!isSlides2DeckData(row.data)) conflict();
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    return conflict();
  }
  const parsed = savedCopySchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.id !== id ||
    parsed.data.templateSource.templateId !== templateId ||
    parsed.data.templateSource.version !== version ||
    parsed.data.templateSource.createdTitle !== createdTitle ||
    typeof row.title !== "string" ||
    !(row.designSystemId === null || typeof row.designSystemId === "string")
  )
    conflict();
  return {
    id,
    title: row.title as string,
    templateId,
    slideCount: parsed.data.slides.length,
    designSystemId: row.designSystemId as string | null,
    url: getDeckUrl(id),
    reused: true,
  };
}

export default defineAction({
  description:
    "Create a fully editable deck by copying a built-in template, with fresh slide IDs and no AI/provider or default design system. Optional newId makes an identical request retryable only for the same owner, organization, template version, and original title. A retry never overwrites subsequent edits. Use the returned URL to open the deck.",
  schema: z.object({
    templateId: z
      .string()
      .min(1)
      .max(100)
      .describe("Built-in ID from list-deck-templates"),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Copy title; defaults to the starter title"),
    newId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
      .describe(
        "Stable ID for an identical retry; omit to create a new independent copy",
      ),
  }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  retrySafe: (input) => typeof input.newId === "string",
  run: async ({ templateId, title, newId }, ctx) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail)
      fail("Sign in to create a deck.", {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    const orgId = getRequestOrgId() ?? null;
    const template = getBuiltInDeckTemplate(templateId);
    if (!template)
      fail("Deck template not found.", {
        statusCode: 404,
        errorCode: "deck_template_not_found",
      });
    const createdTitle = title ?? template.title;
    assertHumanReadableDeckTitle(createdTitle);
    const id = newId ?? `deck-${nanoid()}`;
    const retry = () =>
      readRetry(
        id,
        ownerEmail,
        orgId,
        templateId,
        template.version,
        createdTitle,
      );
    if (newId) {
      const existing = await retry();
      if (existing) return { ...existing, _receipt: copyReceipt(id, false) };
    }
    const deck = {
      id,
      appId: "slides-2",
      title: createdTitle,
      aspectRatio: template.aspectRatio,
      designSystemId: null,
      designTokens: legacySlideDesignTokensFromHtml(
        template.slides[0]!.content,
      ),
      templateSource: { templateId, version: template.version, createdTitle },
      slides: await Promise.all(
        template.slides.map(async (slide) => {
          const sourceTsx = legacySlideHtmlToSource(slide.content);
          const compiled = await compileSlideSource(sourceTsx, {
            ownerEmail,
            orgId,
          });
          return {
            ...slide,
            id: `slide-${nanoid()}`,
            sourceTsx,
            revision: 1,
            sourceHash: compiled.sourceHash,
            content: compiled.content,
          };
        }),
      ),
    };
    try {
      await addDeck.run({ deck, creationMethod: "template" }, ctx);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (newId) {
        const existing = await retry();
        if (existing) return { ...existing, _receipt: copyReceipt(id, false) };
      }
      return conflict();
    }
    const persisted = await retry();
    if (!persisted) {
      fail(
        "Template copy was created, but its saved deck could not be verified.",
        {
          statusCode: 503,
          errorCode: "deck_template_copy_readback_failed",
          details: { deckId: id },
        },
      );
    }
    return {
      ...persisted,
      reused: false,
      _receipt: copyReceipt(id, true),
    };
  },
  link: ({ result }) => {
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string"
    )
      return null;
    return {
      url: buildDeepLink({
        app: "slides-2",
        view: "editor",
        params: { deckId: result.id },
      }),
      label: "Open deck in Slides 2",
      view: "editor",
    };
  },
});
