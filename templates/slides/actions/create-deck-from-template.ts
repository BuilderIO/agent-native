import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getBuiltInDeckTemplate } from "../server/lib/deck-templates.js";
import { assertHumanReadableDeckTitle } from "../shared/deck-title.js";
import { getDeckUrl } from "./_app-url.js";
import addDeck from "./add-deck.js";

const savedCopySchema = z.object({
  id: z.string(),
  slides: z.array(z.object({ id: z.string(), content: z.string() })),
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
      if (existing) return existing;
    }
    const deck = {
      id,
      title: createdTitle,
      aspectRatio: template.aspectRatio,
      designSystemId: null,
      templateSource: { templateId, version: template.version, createdTitle },
      slides: template.slides.map((slide) => ({
        ...slide,
        id: `slide-${nanoid()}`,
      })),
    };
    try {
      await addDeck.run({ deck }, ctx);
    } catch (error) {
      // Concurrent retries can both miss the read. Only a unique-key conflict
      // permits a scoped replay; database or notification failures stay errors.
      if (!isUniqueViolation(error)) throw error;
      if (newId) {
        const existing = await retry();
        if (existing) return existing;
      }
      return conflict();
    }
    return {
      id,
      title: createdTitle,
      templateId,
      slideCount: deck.slides.length,
      designSystemId: null,
      url: getDeckUrl(id),
      reused: false,
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
        app: "slides",
        view: "editor",
        params: { deckId: result.id },
      }),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
