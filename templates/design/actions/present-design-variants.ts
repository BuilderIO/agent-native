import { defineAction, embedApp } from "@agent-native/core";
import {
  deleteAppState,
  writeAppState,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { seedFromText } from "@agent-native/core/collab";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { getDb, schema } from "../server/db/index.js";
import {
  mergeCanvasFramePlacements,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";

const VARIANT_GAP = 96;
const MAX_COLUMNS = 3;
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const TABLET_WIDTH = 768;
const TABLET_HEIGHT = 1024;
const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 900;

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}?view=overview`,
  });
}

const FALLBACK_INSTRUCTIONS =
  "The generated directions have been saved as normal screens on the Design " +
  "overview board. The chat shows one button per screen. Ask the user to pick " +
  "a screen by name if the inline buttons are not available; after they pick, " +
  "delete the other variant screens and continue from the kept screen.";

const variantSchema = z.object({
  id: z.string().min(1).describe("Stable variant id, e.g. 'minimal-focus'"),
  label: z
    .string()
    .min(1)
    .describe("Short user-facing screen name, e.g. 'One-Line Focus'"),
  content: z
    .string()
    .min(1)
    .describe(
      "Complete self-contained HTML document for this variant. Inline the CSS needed for the preview; avoid relying on external CSS/script CDNs because app sandboxes may block them.",
    ),
  width: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional source viewport/artboard width for the overview frame.",
    ),
  height: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional source viewport/artboard height for the overview frame.",
    ),
});

interface VariantScreen {
  id: string;
  variantId: string;
  label: string;
  filename: string;
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function slugify(value: string, fallback: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52) || fallback
  );
}

function optionName(index: number) {
  return `Option ${String.fromCharCode(65 + index)}`;
}

function uniqueFilename(preferred: string, used: Set<string>) {
  const dot = preferred.lastIndexOf(".");
  const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
  const ext = dot > 0 ? preferred.slice(dot) : ".html";
  let candidate = `${stem}${ext}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${suffix}${ext}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function firstCssPixelValue(content: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*:\\s*(\\d{2,4})px`, "i");
  const match = content.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function boundedDimension(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : undefined;
}

function inferVariantSize(variant: z.infer<typeof variantSchema>) {
  const explicitWidth = boundedDimension(variant.width, 240, 1920);
  const explicitHeight = boundedDimension(variant.height, 240, 3000);
  if (explicitWidth && explicitHeight) {
    return { width: explicitWidth, height: explicitHeight };
  }

  const content = variant.content;
  const cssWidth =
    firstCssPixelValue(content, "width") ??
    firstCssPixelValue(content, "max-width") ??
    firstCssPixelValue(content, "min-width");
  const cssHeight =
    firstCssPixelValue(content, "height") ??
    firstCssPixelValue(content, "min-height");
  const inferredWidth = boundedDimension(cssWidth, 240, 1920);
  const inferredHeight = boundedDimension(cssHeight, 240, 3000);
  if (inferredWidth && inferredWidth <= 560) {
    return {
      width: explicitWidth ?? inferredWidth,
      height: explicitHeight ?? inferredHeight ?? MOBILE_HEIGHT,
    };
  }
  if (inferredWidth && inferredHeight) {
    return {
      width: explicitWidth ?? inferredWidth,
      height: explicitHeight ?? inferredHeight,
    };
  }

  const lowercase = content.toLowerCase();
  if (
    /\b(?:mobile|phone|iphone|android)\b/.test(lowercase) ||
    /\b(?:max-w-sm|max-w-md|w-\[(?:360|375|390|393|414)px\])\b/.test(lowercase)
  ) {
    return {
      width: explicitWidth ?? MOBILE_WIDTH,
      height: explicitHeight ?? MOBILE_HEIGHT,
    };
  }
  if (/\b(?:tablet|ipad)\b/.test(lowercase)) {
    return {
      width: explicitWidth ?? TABLET_WIDTH,
      height: explicitHeight ?? TABLET_HEIGHT,
    };
  }

  return {
    width: explicitWidth ?? DESKTOP_WIDTH,
    height: explicitHeight ?? DESKTOP_HEIGHT,
  };
}

function placeVariantScreens(screens: VariantScreen[]) {
  const placements: CanvasFramePlacement[] = [];
  const columns = Math.min(MAX_COLUMNS, Math.max(1, screens.length));
  let rowY = 0;

  for (let rowStart = 0; rowStart < screens.length; rowStart += columns) {
    const row = screens.slice(rowStart, rowStart + columns);
    let x = 0;
    let rowHeight = 0;

    for (const [offset, screen] of row.entries()) {
      placements.push({
        fileId: screen.id,
        filename: screen.filename,
        x,
        y: rowY,
        width: screen.width,
        height: screen.height,
        z: rowStart + offset,
      });
      x += screen.width + VARIANT_GAP;
      rowHeight = Math.max(rowHeight, screen.height);
    }

    rowY += rowHeight + VARIANT_GAP;
  }

  return placements;
}

export default defineAction({
  description:
    "Present generated design directions as normal screens on the Design " +
    "overview board and ask the user to choose one with inline chat buttons. " +
    "Provide 2-5 variants (3 is the sweet spot). Use this for design " +
    "exploration before follow-up refinement. After the user's choice, keep " +
    "the chosen screen, delete the other generated variant screens, and " +
    "continue from the kept screen.",
  schema: z.object({
    designId: z.string().describe("Design project ID to show variants for"),
    prompt: z
      .string()
      .optional()
      .describe("Caption shown in chat above the variant choice buttons"),
    variants: z
      .array(variantSchema)
      .min(2)
      .max(5)
      .describe(
        "2-5 concise, visually distinct generated design options to place as overview screens (3 is the sweet spot). Inline CSS so all options render in the app preview.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design directions",
      description:
        "Open the Design editor with generated directions on the overview board.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open screen overview",
      height: 720,
    }),
  },
  run: async ({ designId, prompt, variants }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    const existingFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));
    const usedFilenames = new Set(existingFiles.map((file) => file.filename));
    const variantSetId = nanoid();
    const screens: VariantScreen[] = [];

    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index]!;
      const label = variant.label.trim() || optionName(index);
      const slug = slugify(label, `option-${index + 1}`);
      const preferredFilename = `variant-${slug}.html`;
      const filename = uniqueFilename(preferredFilename, usedFilenames);
      const fileId = nanoid();
      const { width, height } = inferVariantSize(variant);

      await db.insert(schema.designFiles).values({
        id: fileId,
        designId,
        filename,
        fileType: "html",
        content: variant.content,
        createdAt: now,
        updatedAt: now,
      });
      await seedFromText(fileId, variant.content);

      screens.push({
        id: fileId,
        variantId: variant.id,
        label,
        filename,
        width,
        height,
      });
    }

    const placements = placeVariantScreens(screens);
    await db.transaction(async (tx) => {
      const [currentDesign] = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);
      const prevData = parseJsonRecord(currentDesign?.data ?? design?.data);
      const mergedFrames = mergeCanvasFramePlacements({
        existing: prevData.canvasFrames,
        placements,
        resolveFileId: (placement) => placement.fileId,
      });
      const previousMetadata = isRecord(prevData.screenMetadata)
        ? { ...prevData.screenMetadata }
        : {};
      const previousVariantSets = isRecord(prevData.designVariantSets)
        ? { ...prevData.designVariantSets }
        : {};
      for (const screen of screens) {
        previousMetadata[screen.id] = {
          sourceType: "inline",
          previewState: "preview",
          title: screen.label,
          width: screen.width,
          height: screen.height,
          variantSetId,
          variantId: screen.variantId,
        };
      }
      previousVariantSets[variantSetId] = {
        id: variantSetId,
        prompt: prompt ?? "Pick a direction",
        createdAt: now,
        screens: screens.map((screen) => ({
          id: screen.id,
          variantId: screen.variantId,
          label: screen.label,
          filename: screen.filename,
          width: screen.width,
          height: screen.height,
        })),
      };

      await tx
        .update(schema.designs)
        .set({
          data: JSON.stringify({
            ...prevData,
            canvasFrames: mergedFrames.canvasFrames,
            screenMetadata: previousMetadata,
            designVariantSets: previousVariantSets,
            updatedAt: now,
          }),
          updatedAt: now,
        })
        .where(eq(schema.designs.id, designId));
    });

    await writeAppState("navigate", {
      view: "editor",
      designId,
      editorView: "overview",
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
    });
    await writeAppStateForCurrentTab("guided-questions", {
      title: prompt ?? "Pick a direction",
      description:
        "All options are on the board. Choose the one to keep and I will continue from it.",
      submitLabel: "Use selected direction",
      submitMessage: "Use this design direction.",
      skipLabel: "Show another set",
      skipMessage: "None of these directions are right.",
      questions: [
        {
          id: "variant",
          type: "text-options",
          question: "Which screen should I keep?",
          required: true,
          allowOther: false,
          includeExplore: false,
          includeDecide: false,
          submitOnSelect: true,
          options: screens.map((screen, index) => {
            const otherScreens = screens
              .filter((other) => other.id !== screen.id)
              .map(
                (other) =>
                  `${other.label} (${other.filename}, file id ${other.id})`,
              )
              .join("; ");
            return {
              label: screen.label || optionName(index),
              value:
                `Keep "${screen.label}" (${screen.filename}, file id ${screen.id}) ` +
                `from variant set ${variantSetId}. Delete the other variant screens: ${otherScreens}.`,
            };
          }),
        },
      ],
    });
    await deleteAppState("design-variants").catch(() => false);

    return {
      designId,
      prompt: prompt ?? "Pick a direction",
      variantSetId,
      count: screens.length,
      screens,
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
      embed: true,
      fallbackInstructions: FALLBACK_INSTRUCTIONS,
      nextRequiredAction:
        "Wait for the user to pick a screen in chat. Then delete the unchosen variant screens with delete-file and continue from the chosen screen.",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open screen overview",
      view: "editor",
    };
  },
});
