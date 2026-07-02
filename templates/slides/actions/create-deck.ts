import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import { ASPECT_RATIO_VALUES } from "../shared/aspect-ratios.js";
import { getDeckUrl } from "./_app-url.js";

const SlideSchema = z.object({
  id: z.string().describe("Unique slide ID, e.g. 'slide-1'"),
  content: z.string().describe("Full HTML content of the slide"),
  layout: z
    .enum([
      "title",
      "section",
      "content",
      "two-column",
      "image",
      "statement",
      "full-image",
      "blank",
    ])
    .optional()
    .describe("Layout type hint"),
  notes: z.string().optional().describe("Speaker notes for this slide"),
});

// Accept either a parsed array (HTTP/agent) or a JSON string (CLI)
const SlidesSchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.array(SlideSchema),
);

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

export default defineAction({
  description:
    "Create a new deck, optionally already populated with slides, or atomically replace all slides in an existing deck. " +
    "For short AI-generated decks in MCP app hosts, pass all generated slides in this call so the real deck editor opens inline already populated. " +
    "For longer decks or live in-app generation, create the deck with slides: [] and then use add-slide sequentially so progress appears live. " +
    "Pass deckId to replace an existing deck. " +
    "Returns the deck id, title, and slide count.",
  schema: z.object({
    title: z.string().describe("Deck title"),
    slides: SlidesSchema.describe(
      "Array of slides with id, content (HTML), and optional layout",
    ),
    deckId: z
      .string()
      .optional()
      .describe(
        "If provided, update this existing deck instead of creating a new one",
      ),
    aspectRatio: z
      .enum(ASPECT_RATIO_VALUES)
      .optional()
      .describe(
        "Slide aspect ratio for the deck (defaults to 16:9 when omitted)",
      ),
    designSystemId: z
      .string()
      .optional()
      .describe("Optional design system ID to link to the deck"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Deck preview",
      description: "Open the generated deck in the real Slides editor.",
      iframeTitle: "Agent-Native Slides",
      openLabel: "Open deck",
      height: 680,
    }),
  },
  http: false,
  run: async ({
    title,
    slides: rawSlides,
    deckId,
    aspectRatio,
    designSystemId,
  }) => {
    const db = getDb();
    const now = new Date().toISOString();

    const slides = rawSlides.map((s) => ({
      ...s,
      content: normalizeSlidePadding(s.content),
    }));

    if (deckId) {
      if (designSystemId) {
        await assertAccess("design-system", designSystemId, "viewer");
      }
      // Update existing deck — requires editor access.
      await assertAccess("deck", deckId, "editor");
      const existing = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      if (!existing[0]) {
        throw new Error(`Deck not found: ${deckId}`);
      }
      await createDeckVersionSnapshot(
        {
          id: existing[0].id,
          title: existing[0].title,
          data: existing[0].data,
          ownerEmail: existing[0].ownerEmail,
        },
        { force: true, label: "Before bulk replace" },
      );
      const prevData = existing[0] ? JSON.parse(existing[0].data) : {};
      const data = {
        title,
        slides,
        updatedAt: now,
        aspectRatio: aspectRatio ?? prevData.aspectRatio,
        designSystemId: designSystemId ?? prevData.designSystemId,
      };
      await db
        .update(schema.decks)
        .set({
          title,
          data: JSON.stringify(data),
          designSystemId: designSystemId ?? existing[0]?.designSystemId ?? null,
          updatedAt: now,
        })
        .where(eq(schema.decks.id, deckId));
      // Broadcast to open editors (in-process SSE) + application-state
      // refresh signal (cross-process polling fallback for serverless).
      notifyClients(deckId);
      await writeAppState("refresh-signal", { ts: now, source: "create-deck" });
      return {
        id: deckId,
        title,
        slideCount: slides.length,
        url: getDeckUrl(deckId),
        deepLink: deckDeepLink(deckId),
        slides,
      };
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    let resolvedDesignSystemId = designSystemId;
    if (resolvedDesignSystemId) {
      await assertAccess("design-system", resolvedDesignSystemId, "viewer");
    } else {
      const defaults = await db
        .select({ id: schema.designSystems.id })
        .from(schema.designSystems)
        .where(
          and(
            eq(schema.designSystems.ownerEmail, ownerEmail),
            eq(schema.designSystems.isDefault, true),
          ),
        )
        .limit(1);
      resolvedDesignSystemId = defaults[0]?.id;
    }

    const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data: Record<string, unknown> = {
      title,
      slides,
      createdAt: now,
      updatedAt: now,
    };
    if (aspectRatio) data.aspectRatio = aspectRatio;
    if (resolvedDesignSystemId) data.designSystemId = resolvedDesignSystemId;
    await db.insert(schema.decks).values({
      id,
      title,
      data: JSON.stringify(data),
      designSystemId: resolvedDesignSystemId ?? null,
      ownerEmail,
      orgId: getRequestOrgId(),
      createdAt: now,
      updatedAt: now,
    });

    notifyClients(id);
    await writeAppState("refresh-signal", { ts: now, source: "create-deck" });
    return {
      id,
      title,
      slideCount: slides.length,
      url: getDeckUrl(id),
      deepLink: deckDeepLink(id),
      slides,
    };
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
