import { defineAction, embedApp } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import {
  nativeCreativeArtifactFromMetadata,
  reassembleNativeCreativeArtifact,
  validateCompiledNativeHtml,
} from "@agent-native/creative-context";
import {
  getGenerationCreativeContext,
  mergeCreativeContextReuseLabels,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
} from "@agent-native/creative-context/server";
import {
  createContextPack,
  deriveContextPack,
  getCreativeContextItem,
  getCreativeContextItemByExternalId,
} from "@agent-native/creative-context/store";
import type { ContextDetail } from "@agent-native/creative-context/types";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { validateNativeSlideHtml } from "../app/lib/validate-native-slide-html.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import { getDeckUrl } from "./_app-url.js";
import { withDeckLock } from "./patch-deck.js";

export function cloneableNativeSlide(context: ContextDetail): {
  content: string;
  notes?: string;
  sourceExternalId: string;
} {
  const artifact = nativeCreativeArtifactFromMetadata(context.version.metadata);
  if (
    !artifact ||
    artifact.app !== "slides" ||
    artifact.format !== "slides-html" ||
    context.version.mimeType !== "text/html"
  ) {
    throw new Error("Creative Context item is not a Slides-native artifact.");
  }
  if (!context.version.content.includes("google-slides-native")) {
    throw new Error(
      "Slides-native artifact code is missing its compiler root.",
    );
  }
  if (
    context.item.provenance.compiler !==
    "@agent-native/creative-context:google-slides-native"
  ) {
    throw new Error("Slides-native artifact compiler provenance is untrusted.");
  }
  validateCompiledNativeHtml(context.version.content, artifact);
  const metadata = context.version.metadata;
  const notes =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).speakerNotes === "string"
      ? ((metadata as Record<string, unknown>).speakerNotes as string)
      : undefined;
  return {
    content: artifact.manifest
      ? context.version.content
      : validateNativeSlideHtml(context.version.content),
    ...(notes ? { notes } : {}),
    sourceExternalId: artifact.rootExternalId,
  };
}

export default defineAction({
  description:
    "Clone one pinned Google Slides-native Creative Context item into an existing deck without regenerating or rewriting its editable HTML/CSS. Returns a link that opens the cloned slide in Slides.",
  schema: z.object({
    deckId: z.string().min(1).describe("Target Slides deck"),
    itemId: z.string().min(1).describe("Creative Context item id"),
    itemVersionId: z
      .string()
      .min(1)
      .describe("Pinned immutable Creative Context version id"),
    position: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Cloned native slide",
      description: "Open the exact cloned artifact in the Slides editor.",
      iframeTitle: "Agent-Native Slides",
      openLabel: "Open cloned slide",
      height: 680,
    }),
  },
  http: false,
  run: async ({ deckId, itemId, itemVersionId, position, slideId }) => {
    const contextState = (await readAppState("creative-context").catch(
      () => null,
    )) as { contextMode?: "auto" | "off" } | null;
    if (contextState?.contextMode === "off") {
      throw new Error(
        "Creative Context is off. Enable it before cloning a library slide.",
      );
    }
    const context = await getCreativeContextItem(itemId, itemVersionId);
    if (!context || context.version.id !== itemVersionId) {
      throw new Error("Pinned Creative Context item version was not found.");
    }
    const source = cloneableNativeSlide(context);
    const reassembled = await reassembleNativeCreativeArtifact({
      root: context,
      app: "slides",
      format: "slides-html",
      resolveChild: getCreativeContextItemByExternalId,
    });
    source.content = validateNativeSlideHtml(reassembled.html);
    return withDeckLock(deckId, async () => {
      await assertAccess("deck", deckId, "editor");
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId));
      if (!row) throw new Error(`Deck ${deckId} not found`);
      const deck = JSON.parse(row.data) as Record<string, unknown>;
      const slides = Array.isArray(deck.slides)
        ? ([...deck.slides] as Array<Record<string, unknown>>)
        : [];
      const newSlideId = slideId ?? `slide-${nanoid(10)}`;
      const reuseLabel = {
        itemId,
        itemVersionId,
        kind: "google-slides-native-slide",
        label: "Cloned native Google Slides artifact",
        dataRole: "untrusted-reference" as const,
        elementId: newSlideId,
        influence: "reused" as const,
      };
      const clonedSlide = {
        id: newSlideId,
        content: source.content,
        layout: "blank",
        notes: source.notes ?? "",
        creativeContextReuseLabels: [reuseLabel],
        nativeArtifactSource: {
          itemId,
          itemVersionId,
          externalId: source.sourceExternalId,
        },
      };
      const insertAt =
        position === undefined
          ? slides.length
          : Math.max(0, Math.min(position, slides.length));
      slides.splice(insertAt, 0, clonedSlide);
      const now = new Date().toISOString();
      const existingContext =
        deck.creativeContext &&
        typeof deck.creativeContext === "object" &&
        !Array.isArray(deck.creativeContext)
          ? (deck.creativeContext as Record<string, unknown>)
          : {};
      const existingContextPackId =
        typeof existingContext.contextPackId === "string"
          ? existingContext.contextPackId
          : null;
      const existingLabels = Array.isArray(existingContext.reuseLabels)
        ? existingContext.reuseLabels
        : [];
      if (existingContext.contextMode === "off") {
        throw new Error(
          "Creative Context is disabled for this deck. Enable it before cloning a library slide.",
        );
      }
      const evidenceMembers = reassembled.evidence.map((entry) => ({
        ...entry,
        reason: "Exact native Google Slides reuse",
      }));
      const pack = existingContextPackId
        ? await deriveContextPack({
            packId: existingContextPackId,
            name: `Clone: ${context.item.title}`.slice(0, 200),
            addMembers: evidenceMembers,
          })
        : await createContextPack({
            name: `Clone: ${context.item.title}`.slice(0, 200),
            contextMode: "manual",
            request: {
              operation: "clone-native-artifact",
              appId: "slides",
              rootItemId: context.item.id,
              rootItemVersionId: context.version.id,
            },
            members: evidenceMembers,
          });
      const contextMode = "pinned" as const;
      const contextPackId = pack.id;
      const evidenceLabels = reassembled.evidence.map((entry, index) => ({
        ...entry,
        kind: "google-slides-native-slide",
        label:
          entry.itemId === context.item.id
            ? "Cloned native Google Slides artifact"
            : `Native child ${index + 1}`,
        dataRole: "untrusted-reference" as const,
        elementId:
          entry.itemId === context.item.id
            ? newSlideId
            : `${newSlideId}:evidence:${index + 1}`,
        influence: "reused" as const,
      }));
      const reuseLabels = mergeCreativeContextReuseLabels(
        existingLabels as (typeof reuseLabel)[],
        evidenceLabels,
      );
      deck.slides = slides;
      deck.updatedAt = now;
      deck.creativeContext = { contextMode, contextPackId, reuseLabels };
      const previousGeneration = await getGenerationCreativeContext(
        {
          appId: "slides",
          artifactType: "deck",
          artifactId: deckId,
        },
        getRequestOrgId()
          ? { accessScope: "artifact-access-asserted" }
          : undefined,
      );
      const elementProvenance = replaceCreativeContextElementProvenance(
        previousGeneration?.elementProvenance ?? [],
        evidenceLabels.map((entry) => ({
          elementId: entry.elementId,
          itemId: entry.itemId,
          itemVersionId: entry.itemVersionId,
          influence: entry.influence,
          label: entry.label,
        })),
      );

      await createDeckVersionSnapshot(
        {
          id: row.id,
          title: row.title,
          data: row.data,
          ownerEmail: row.ownerEmail,
        },
        { label: "Before cloning Creative Context slide" },
      );
      await db.transaction(async (tx: any) => {
        await tx
          .update(schema.decks)
          .set({ data: JSON.stringify(deck), updatedAt: now })
          .where(eq(schema.decks.id, deckId));
        await recordGenerationCreativeContext(
          {
            appId: "slides",
            artifactType: "deck",
            artifactId: deckId,
            contextMode,
            contextPackId,
            reuseLabels,
            elementProvenance,
          },
          { db: tx },
        );
      });
      notifyClients(deckId, { slideId: newSlideId, actor: "agent" });
      return {
        deckId,
        slideId: newSlideId,
        slideNumber: insertAt + 1,
        slideCount: slides.length,
        itemId,
        itemVersionId,
        contextPackId,
        evidenceCount: reassembled.evidence.length,
        clonedWithoutRegeneration: true,
        deepLink: buildDeepLink({
          app: "slides",
          view: "editor",
          params: { deckId, slideId: newSlideId },
        }),
        url: getDeckUrl(deckId),
      };
    });
  },
  link: ({ result }) => {
    const value = result as { deckId?: string; deepLink?: string } | undefined;
    if (!value?.deckId) return null;
    return {
      url:
        value.deepLink ??
        buildDeepLink({
          app: "slides",
          view: "editor",
          params: { deckId: value.deckId },
        }),
      label: "Open cloned slide in Slides",
      view: "editor",
    };
  },
});
