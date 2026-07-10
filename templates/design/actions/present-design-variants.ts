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
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  mergeCanvasFramePlacements,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

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
  "delete each other variant screen at most once, call get-design-snapshot with fileId for " +
  "the kept screen once, then call edit-design on that same fileId in a bounded pass. " +
  'Use mode "replace-file" to replace the representative direction screen with ' +
  "the actual requested product UI; make the result complete but compact and " +
  "prefer visible controls/affordances over exhaustive content if the request is large. " +
  "Do not leave a direction board, summary card, or variant brief as the final result. " +
  "Do not call generate-design after a variant pick.";

const VARIANT_PICK_SUBMIT_MESSAGE =
  "Use this design direction. Keep the selected screen, clean up each other " +
  "variant screen at most once, read only the kept screen, then update that " +
  "same screen in one bounded pass into the requested app/product UI. Make it " +
  "complete but compact: prioritize the primary workflow, and if the full feature " +
  "list is too large for one reliable edit, render secondary details as visible " +
  "controls, states, or affordances instead of expanding the action input. " +
  "The selected screen is only a representative direction; the final saved " +
  "screen must not be a direction board, variant brief, or summary card. " +
  "If a cleanup action reports a screen was " +
  "already missing, continue. Use the exact file ids and tool instructions in " +
  "the selected answer below. Do not repeat cleanup/read cycles, do not create " +
  "a new index.html, and stop after the first successful screen update.";

const variantSchema = z.object({
  id: z.string().min(1).describe("Stable variant id, e.g. 'minimal-focus'"),
  label: z
    .string()
    .min(1)
    .describe("Short user-facing screen name, e.g. 'One-Line Focus'"),
  description: z
    .string()
    .optional()
    .describe(
      "Short visual direction summary. Use this instead of a huge HTML payload when exploring variants quickly.",
    ),
  accentColor: z
    .string()
    .optional()
    .describe("Optional CSS color used as this variant's primary accent."),
  features: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Optional short feature/polish bullets to show in the variant."),
  content: z
    .string()
    .optional()
    .describe(
      "Optional complete self-contained HTML document for this variant. Keep it compact: one representative screen or directional snapshot, not a full multi-screen app. For faster exploration, omit this and provide label/description/features; Design will generate a compact representative screen.",
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

function inferVariantSize(
  variant: z.infer<typeof variantSchema>,
  prompt?: string,
) {
  const explicitWidth = boundedDimension(variant.width, 240, 1920);
  const explicitHeight = boundedDimension(variant.height, 240, 3000);
  if (explicitWidth && explicitHeight) {
    return { width: explicitWidth, height: explicitHeight };
  }

  const content = variant.content ?? "";
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

  const lowercase = [
    content,
    variant.label,
    variant.description ?? "",
    ...(variant.features ?? []),
    prompt ?? "",
  ]
    .join(" ")
    .toLowerCase();
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorForVariant(
  variant: z.infer<typeof variantSchema>,
  index: number,
) {
  const provided = variant.accentColor?.trim();
  if (provided) return provided;
  return ["#f59e0b", "#06b6d4", "#10b981", "#f43f5e", "#d97706"][index % 5]!;
}

function fallbackVariantContent(
  variant: z.infer<typeof variantSchema>,
  index: number,
  prompt?: string,
  size: { width: number; height: number } = {
    width: DESKTOP_WIDTH,
    height: DESKTOP_HEIGHT,
  },
) {
  const label = escapeHtml(variant.label.trim() || optionName(index));
  const description = escapeHtml(
    variant.description?.trim() ||
      "A compact dark-mode product direction with a clear primary workflow, crisp hierarchy, and fast keyboard-first flow.",
  );
  const sourcePrompt = escapeHtml(
    prompt?.trim() ||
      "Generated app interface direction with a polished workflow and production-ready interaction model.",
  );
  const accent = escapeHtml(colorForVariant(variant, index));
  const features =
    variant.features && variant.features.length > 0
      ? variant.features.slice(0, 6)
      : [
          "Primary workflow",
          "Fast capture",
          "Structured details",
          "Status tracking",
          "Inline editing",
          "Shortcut hints",
        ];
  const safeFeatures = features.map((feature) => escapeHtml(feature));
  const cardTitles = [
    safeFeatures[0] ?? "Primary workflow",
    safeFeatures[1] ?? "Structured details",
    safeFeatures[2] ?? "Polished interactions",
    safeFeatures[3] ?? "Status tracking",
    safeFeatures[4] ?? "Review flow",
  ];
  const density =
    index % 3 === 0 ? "spacious" : index % 3 === 1 ? "glass" : "dense";
  const screenWidth = Math.round(size.width);
  const screenHeight = Math.round(size.height);
  const compact = screenWidth <= 560;
  const tablet = screenWidth > 560 && screenWidth <= 900;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${label}</title>
<style>
:root { color-scheme: dark; --accent: ${accent}; --bg: #080a0f; --panel: rgba(18, 22, 33, 0.82); --line: rgba(255,255,255,.11); --muted: #94a3b8; }
* { box-sizing: border-box; }
body { margin: 0; width: ${screenWidth}px; min-height: ${screenHeight}px; overflow: hidden; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f8fafc; background:
  radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--accent) 42%, transparent), transparent 30%),
  linear-gradient(140deg, #05070b 0%, #111827 48%, #05070b 100%); }
.shell { width: ${screenWidth}px; min-height: ${screenHeight}px; padding: ${compact ? "18" : "34"}px; display: grid; grid-template-columns: ${compact ? "1fr" : tablet ? "220px 1fr" : "258px 1fr 304px"}; gap: ${compact ? "14" : "22"}px; }
.panel { border: 1px solid var(--line); background: var(--panel); border-radius: ${density === "dense" ? "14" : "22"}px; box-shadow: 0 24px 80px rgba(0,0,0,.35); backdrop-filter: blur(${density === "glass" ? "26" : "10"}px); }
.sidebar { padding: 22px; display: flex; flex-direction: column; gap: 18px; }
.brand { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.mark { width: 40px; height: 40px; border-radius: 14px; background: var(--accent); box-shadow: 0 0 32px color-mix(in srgb, var(--accent) 58%, transparent); display:grid; place-items:center; font-weight:800; color:#05070b; }
h1 { margin: 0; font-size: 32px; line-height: 1.05; letter-spacing: 0; }
h2 { margin: 0; font-size: 16px; letter-spacing: 0; }
p { margin: 0; color: var(--muted); line-height: 1.5; }
.nav, .tasks, .right { display: grid; gap: 12px; }
.nav div, .task, .metric, .calendar { border: 1px solid var(--line); border-radius: 14px; background: rgba(255,255,255,.045); padding: 13px 14px; }
.nav div:first-child { color: #fff; background: color-mix(in srgb, var(--accent) 18%, rgba(255,255,255,.06)); border-color: color-mix(in srgb, var(--accent) 48%, var(--line)); }
.main { padding: 24px; display:flex; flex-direction:column; gap:18px; }
.top { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
.badge { border:1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); color:#fff; background: color-mix(in srgb, var(--accent) 20%, transparent); padding:8px 11px; border-radius:999px; font-size:12px; }
.board { display:grid; grid-template-columns: ${compact ? "1fr" : "repeat(3, 1fr)"}; gap:14px; flex:1; min-height:0; }
.column { border:1px solid var(--line); border-radius:18px; background:rgba(255,255,255,.035); padding:14px; display:flex; flex-direction:column; gap:12px; }
.column header { display:flex; justify-content:space-between; align-items:center; color:#cbd5e1; font-size:13px; }
.task { display:grid; gap:10px; padding:14px; }
.task strong { font-size:14px; line-height:1.25; }
.meta { display:flex; flex-wrap:wrap; gap:7px; }
.chip { font-size:11px; color:#dbeafe; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.055); border-radius:999px; padding:5px 8px; }
.priority { color:#fff; background: color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,.06)); border-color: color-mix(in srgb, var(--accent) 46%, var(--line)); }
.right { padding:22px; align-content:start; }
.metric { display:grid; gap:8px; }
.metric b { font-size:28px; }
.calendar { display:grid; grid-template-columns: repeat(7, 1fr); gap:7px; }
.calendar span { display:grid; place-items:center; height:32px; border-radius:10px; color:#cbd5e1; background:rgba(255,255,255,.04); font-size:12px; }
.calendar .hot { color:#05070b; background:var(--accent); font-weight:800; }
.features { display:flex; flex-wrap:wrap; gap:8px; }
.shortcut { margin-top:auto; border-top:1px solid var(--line); padding-top:14px; display:flex; justify-content:space-between; gap:10px; color:#cbd5e1; font-size:12px; }
${tablet ? ".right { display: none; }" : ""}
${compact ? ".sidebar { padding: 16px; } .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .nav div { padding: 10px; } .main { padding: 18px; } .top { display: grid; } .top .badge { width: fit-content; } h1 { font-size: 26px; } .right { display: none; } .column:nth-child(n+3) { display: none; }" : ""}
</style>
</head>
<body>
<main class="shell">
  <aside class="panel sidebar">
    <div class="brand"><div class="mark">${escapeHtml(String.fromCharCode(65 + index))}</div><span class="badge">${label}</span></div>
    <div>
      <h2>Direction</h2>
      <p>${description}</p>
    </div>
    <div class="nav">
      <div>Overview</div><div>Primary flow</div><div>Details</div><div>Timeline</div><div>Output</div>
    </div>
    <div class="features">${safeFeatures.map((feature) => `<span class="chip">${feature}</span>`).join("")}</div>
    <div class="shortcut"><span>⌘K command</span><span>G then B</span></div>
  </aside>
  <section class="panel main">
    <div class="top">
      <div><h1>${label}</h1><p>${sourcePrompt}</p></div>
      <span class="badge">${compact ? "Mobile" : tablet ? "Tablet" : "Desktop"} concept · live data</span>
    </div>
    <div class="board">
      <section class="column"><header><span>Focus</span><b>4</b></header>
        <article class="task"><strong>${cardTitles[0]}</strong><div class="meta"><span class="chip priority">Primary</span><span class="chip">Now</span><span class="chip">Fast path</span></div></article>
        <article class="task"><strong>${cardTitles[1]}</strong><div class="meta"><span class="chip">Detail view</span><span class="chip">Shortcut E</span></div></article>
      </section>
      <section class="column"><header><span>Build</span><b>6</b></header>
        <article class="task"><strong>${cardTitles[2]}</strong><div class="meta"><span class="chip priority">P2</span><span class="chip">Flow</span></div></article>
        <article class="task"><strong>${cardTitles[3]}</strong><div class="meta"><span class="chip">Inline edit</span><span class="chip">Next</span></div></article>
      </section>
      <section class="column"><header><span>Ready</span><b>12</b></header>
        <article class="task"><strong>${cardTitles[4]}</strong><div class="meta"><span class="chip">Complete</span><span class="chip">Motion ready</span></div></article>
      </section>
    </div>
  </section>
  <aside class="panel right">
    <h2>Progress</h2>
    <div class="metric"><p>Current flow</p><b>68%</b><p>Representative state for this direction</p></div>
    <h2>Timeline</h2>
    <div class="calendar">${Array.from({ length: 14 }, (_, day) => `<span class="${day === 4 || day === 9 ? "hot" : ""}">${day + 1}</span>`).join("")}</div>
    <h2>Key moments</h2>
    <div class="tasks">
      <div class="task"><strong>${safeFeatures[0] ?? "Primary workflow"}</strong><div class="meta"><span class="chip priority">Hero</span><span class="chip">45m</span></div></div>
      <div class="task"><strong>${safeFeatures[1] ?? "Polished interaction"}</strong><div class="meta"><span class="chip">Motion</span><span class="chip">⌘ Enter</span></div></div>
    </div>
  </aside>
</main>
</body>
</html>`;
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
    "call get-design-snapshot with fileId for the kept screen before " +
    "calling edit-design on that same fileId in a bounded pass. Use " +
    '`mode: "replace-file"` when expanding the representative placeholder ' +
    "into a complete but compact product UI in the chosen direction. Do not call generate-design after a " +
    "variant pick. Stop after the first successful edit-design save. For " +
    "complex apps, " +
    "make each variant a " +
    "compact representative screen; pass concise labels/descriptions/features " +
    "and omit content when full HTML would be too large. Design will render " +
    "compact screens from the direction data. Expand the chosen direction " +
    "after the user picks.",
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
        "2-5 concise, visually distinct generated design options to place as overview screens (3 is the sweet spot). Prefer short label/description/features for each direction; include inline HTML content only when it is compact enough to finish.",
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
      const providedContent = variant.content?.trim();
      const initialSize = inferVariantSize(variant, prompt);
      const rawContent =
        providedContent ||
        fallbackVariantContent(variant, index, prompt, initialSize);
      const { width, height } = providedContent
        ? inferVariantSize({ ...variant, content: rawContent })
        : initialSize;
      // Stamp missing data-agent-native-node-id attributes before persisting
      // so each variant screen is fully addressable by id-keyed editor
      // operations as soon as it lands on the overview board.
      const content = annotateScreenHtmlForPersist(rawContent, "html");

      await db.insert(schema.designFiles).values({
        id: fileId,
        designId,
        filename,
        fileType: "html",
        content,
        createdAt: now,
        updatedAt: now,
      });
      await seedFromText(fileId, content);

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
    await mutateDesignData({
      designId,
      mutate: (current, { updatedAt }) => {
        const mergedFrames = mergeCanvasFramePlacements({
          existing: current.canvasFrames,
          placements,
          resolveFileId: (placement) => placement.fileId,
        });
        const previousMetadata = isRecord(current.screenMetadata)
          ? { ...current.screenMetadata }
          : {};
        const previousVariantSets = isRecord(current.designVariantSets)
          ? { ...current.designVariantSets }
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

        return {
          ...current,
          canvasFrames: mergedFrames.canvasFrames,
          screenMetadata: previousMetadata,
          designVariantSets: previousVariantSets,
          updatedAt,
        };
      },
      isApplied: (current) => {
        const canvasFrames = isRecord(current.canvasFrames)
          ? current.canvasFrames
          : {};
        const metadata = isRecord(current.screenMetadata)
          ? current.screenMetadata
          : {};
        const variantSets = isRecord(current.designVariantSets)
          ? current.designVariantSets
          : {};
        const set = isRecord(variantSets[variantSetId])
          ? variantSets[variantSetId]
          : null;
        const persistedScreens = Array.isArray(set?.screens) ? set.screens : [];
        return screens.every(
          (screen) =>
            isRecord(canvasFrames[screen.id]) &&
            isRecord(metadata[screen.id]) &&
            persistedScreens.some(
              (persisted) => isRecord(persisted) && persisted.id === screen.id,
            ),
        );
      },
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
        "All options are on the board. Choose one to keep; I will delete the others, read only the kept screen, and turn that direction into the final requested screen.",
      submitLabel: "Use selected direction",
      submitMessage: VARIANT_PICK_SUBMIT_MESSAGE,
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
                `from variant set ${variantSetId}. Delete each other variant screen at most once: ${otherScreens}. If delete-file says a screen is already missing, continue. ` +
                `Then call get-design-snapshot exactly once with designId ${designId} and fileId ${screen.id} (filename ${screen.filename}), then call edit-design with fileId ${screen.id} on that same kept file in a bounded single-file pass. Use mode "replace-file" to replace the representative direction screen with a complete but compact requested app/product UI in the chosen visual style. Prioritize the primary workflow; if the full feature list is too large for one reliable edit, render secondary details as visible controls, states, or affordances instead of expanding the action input. The final saved screen must be the actual usable UI requested by the user, not a direction board, variant brief, summary card, or description of the direction. Do not call generate-design after this variant pick, do not repeat delete/snapshot cycles, do not create index.html, and do not resend a huge payload. Stop after the first successful edit-design save.`,
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
        'Wait for the user to pick a screen in chat. Then delete each unchosen variant screen with delete-file at most once, call get-design-snapshot exactly once with fileId for the chosen screen, and call edit-design with that same fileId in a bounded pass. Use mode "replace-file" to replace the representative direction screen with a complete but compact requested app/product UI in the chosen visual style. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the full feature list is too large for one reliable edit. Do not leave a direction board, variant brief, or summary card as the final result. Do not repeat delete/snapshot cycles. Do not call generate-design after a variant pick. Stop after the first successful edit-design save.',
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
