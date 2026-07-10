import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  type AssignedCanvasRegion,
  DEFAULT_ASSIGNED_REGION_GAP,
  DEFAULT_ASSIGNED_REGION_MAX_COLUMNS,
} from "../shared/canvas-math.js";
import {
  designGenerationSessionKey,
  type DesignGenerationFrame,
  type DesignGenerationSession,
} from "../shared/generation-session.js";

// Mirrors the mobile/tablet/desktop viewport vocabulary already used by
// present-design-variants.ts's inferVariantSize, so a screen's canvas region
// matches its intended device instead of every screen defaulting to the same
// fixed desktop-shaped region regardless of content (B5-10: AI-generated
// desktop designs were being placed in mobile-width screens because neither
// this schema nor assignRegions had any per-screen size signal).
const DEVICE_REGION_SIZE: Record<
  "mobile" | "tablet" | "desktop",
  { width: number; height: number }
> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 1024 },
};

function regionSizeForScreen(screen: {
  deviceType?: "mobile" | "tablet" | "desktop";
  width?: number;
  height?: number;
}): { width: number; height: number } {
  const base = DEVICE_REGION_SIZE[screen.deviceType ?? "desktop"];
  return {
    width: screen.width && screen.width > 0 ? screen.width : base.width,
    height: screen.height && screen.height > 0 ? screen.height : base.height,
  };
}

/**
 * Pack per-screen-sized regions into rows/columns, matching assignRegions'
 * layout shape (row/column-major, one gap between cells) but sizing each
 * region individually instead of assuming every region is the same fixed
 * size. Row height is the tallest region in that row, mirroring how
 * assignRegions would behave if every item in a row shared one size.
 */
function assignRegionsForSizes(
  sizes: Array<{ width: number; height: number }>,
  {
    columns,
    gap = DEFAULT_ASSIGNED_REGION_GAP,
  }: { columns: number; gap?: number },
): AssignedCanvasRegion[] {
  const regions: AssignedCanvasRegion[] = [];
  let rowY = 0;

  for (let rowStart = 0; rowStart < sizes.length; rowStart += columns) {
    const row = sizes.slice(rowStart, rowStart + columns);
    let x = 0;
    let rowHeight = 0;

    row.forEach((size, offset) => {
      const index = rowStart + offset;
      regions.push({
        index,
        row: Math.floor(index / columns),
        column: index % columns,
        x,
        y: rowY,
        width: size.width,
        height: size.height,
      });
      x += size.width + gap;
      rowHeight = Math.max(rowHeight, size.height);
    });

    rowY += rowHeight + gap;
  }

  return regions;
}

const AGENT_NAMES = [
  "Atlas",
  "Nova",
  "Kai",
  "Mira",
  "Sol",
  "Vega",
  "Rune",
  "Iris",
];

const AGENT_COLORS = [
  "var(--design-editor-accent-color)",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function designDeepLink(designId: string): string {
  const path = `/design/${encodeURIComponent(designId)}?view=overview`;
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
    to: path,
  });
}

const requestedScreenSchema = z
  .object({
    frameId: z.string().optional(),
    title: z.string().min(1),
    filename: z
      .string()
      .optional()
      .describe("Target filename for this screen, such as onboarding.html"),
    role: z.enum(["screen", "variant"]).optional().default("screen"),
    variantOf: z.string().trim().min(1).optional(),
    deviceType: z
      .enum(["mobile", "tablet", "desktop"])
      .optional()
      .describe(
        "Intended viewport for this screen. Defaults to desktop-sized when " +
          "omitted — pass 'mobile' for phone screens and 'tablet' for iPad-" +
          "width screens so the canvas region matches the content instead of " +
          "always sizing every screen as desktop.",
      ),
    width: z
      .number()
      .positive()
      .optional()
      .describe(
        "Optional explicit canvas region width in px, overriding deviceType.",
      ),
    height: z
      .number()
      .positive()
      .optional()
      .describe(
        "Optional explicit canvas region height in px, overriding deviceType.",
      ),
  })
  .superRefine((screen, ctx) => {
    if (screen.role === "variant" && !screen.variantOf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variantOf"],
        message:
          "variant screens require variantOf to identify the base screen",
      });
    }
  });

export default defineAction({
  description:
    "Start a multi-screen generation session on the Design canvas. " +
    "Use this before generating multiple screens or variations in parallel: it " +
    "assigns non-overlapping canvas regions and returns per-frame generation " +
    "instructions including canvasFrame placements. The session state is " +
    "agent-facing planning state consumed by generate-design and view-screen. " +
    "Pass each screen's deviceType ('mobile', 'tablet', or 'desktop') so its " +
    "canvas region matches the content — a desktop dashboard should not be " +
    "boxed into a 390px mobile-width frame. Defaults to desktop when omitted; " +
    "pass explicit width/height instead for a non-standard viewport. " +
    "After this action, fan out calls to generate-design for each returned " +
    "frame, passing the returned canvasFrame values to generate-design so " +
    "screens appear in the infinite overview canvas.",
  schema: z.object({
    designId: z.string().describe("Design project ID to generate into"),
    prompt: z.string().min(1).describe("Overall generation prompt"),
    screens: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z
          .array(requestedScreenSchema)
          .min(1)
          .max(8)
          .superRefine((screens, ctx) => {
            // Two screens sharing an explicit frameId would produce two
            // DesignGenerationFrame entries with the same frameId (and thus
            // the same derived agentId `agent-${frameId}`) once frames get
            // built below, colliding agent presence/status tracking for both
            // screens on the overview canvas.
            const frameIdsSeen = new Map<string, number>();
            screens.forEach((screen, index) => {
              if (!screen.frameId) return;
              const firstIndex = frameIdsSeen.get(screen.frameId);
              if (firstIndex !== undefined) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [index, "frameId"],
                  message:
                    `duplicate frameId "${screen.frameId}" (already used at index ${firstIndex}); ` +
                    "each screen needs a distinct frameId",
                });
                return;
              }
              frameIdsSeen.set(screen.frameId, index);
            });

            const requestAnchors = new Map<
              string,
              { index: number; role: DesignGenerationFrame["role"] }
            >();
            screens.forEach((screen, index) => {
              const anchors = [screen.frameId, screen.filename, screen.title];
              for (const anchor of anchors) {
                if (!anchor || requestAnchors.has(anchor)) continue;
                requestAnchors.set(anchor, {
                  index,
                  role: screen.role,
                });
              }
            });

            screens.forEach((screen, index) => {
              if (screen.role !== "variant" || !screen.variantOf) return;
              const anchor = requestAnchors.get(screen.variantOf);
              if (!anchor) return;
              if (anchor.index === index) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [index, "variantOf"],
                  message: "variant screens cannot point to themselves",
                });
                return;
              }
              if (anchor.role === "variant") {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [index, "variantOf"],
                  message:
                    "variant screens must anchor to a base screen, not another variant",
                });
              }
            });
          }),
      )
      .describe("Screens or variants that should be generated on the canvas"),
    designSystemId: z
      .string()
      .optional()
      .describe("Locked design system/token set for every worker"),
    contextRefs: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Selected frame/image/reference ids attached as context"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design generation session",
      description: "Open the Design editor with agent generation visible.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open generation session",
      height: 720,
    }),
  },
  run: async ({ designId, prompt, screens, designSystemId, contextRefs }) => {
    await assertAccess("design", designId, "editor");
    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }

    const regionSizes = screens.map(regionSizeForScreen);
    const regions = assignRegionsForSizes(regionSizes, {
      columns:
        screens.length <= 3
          ? screens.length
          : DEFAULT_ASSIGNED_REGION_MAX_COLUMNS,
    });

    // Seed the used-filename set with the design's EXISTING files, not just
    // names requested in this call. Without this, a requested/auto-slugged
    // target (e.g. a screen titled "Onboarding" slugging to "onboarding.html")
    // can silently collide with an already-saved screen: generate-design's
    // existing-file lookup is keyed by filename, so the later generate-design
    // call for that "new" target would UPDATE (overwrite) the pre-existing
    // file instead of creating the new screen the agent intended.
    const db = getDb();
    const existingFiles = await db
      .select({ filename: schema.designFiles.filename })
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));
    const usedFilenames = new Set(
      existingFiles
        .map((file) => file.filename)
        .filter((filename): filename is string => Boolean(filename)),
    );
    // Dedupe any filename (explicit or auto-generated) so two screens can
    // never resolve to the same target file, and so no target collides with
    // an existing screen — otherwise generate-design silently overwrites the
    // other screen's content.
    const dedupeFilename = (base: string): string => {
      if (!usedFilenames.has(base)) {
        usedFilenames.add(base);
        return base;
      }
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let count = 2;
      let candidate = `${stem}-${count}${ext}`;
      while (usedFilenames.has(candidate)) {
        count += 1;
        candidate = `${stem}-${count}${ext}`;
      }
      usedFilenames.add(candidate);
      return candidate;
    };
    const requestedTargets = screens.map((screen, index) => {
      if (screen.filename) return dedupeFilename(screen.filename);
      const slug =
        screen.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || `screen-${index + 1}`;
      return dedupeFilename(`${slug}.html`);
    });

    const frames: DesignGenerationFrame[] = screens.map((screen, index) => {
      const frameId = screen.frameId ?? nanoid();
      return {
        frameId,
        filename: requestedTargets[index],
        agentId: `agent-${frameId}`,
        agentName: AGENT_NAMES[index % AGENT_NAMES.length] ?? "Agent",
        agentColor:
          AGENT_COLORS[index % AGENT_COLORS.length] ??
          "var(--design-editor-accent-color)",
        region: regions[index]!,
        role: screen.role,
        variantOf: screen.variantOf,
        status: "queued",
        step: "Queued",
        progress: 0,
      };
    });

    const session: DesignGenerationSession = {
      id: nanoid(),
      designId,
      status: "planning",
      designSystemId,
      prompt,
      contextRefs,
      frames,
      startedAt: new Date().toISOString(),
    };

    await writeAppState(
      designGenerationSessionKey(designId),
      session as unknown as Record<string, unknown>,
    );
    await writeAppState("navigate", {
      view: "editor",
      designId,
      editorView: "overview",
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
    });

    const targets = frames.map((frame, index) => {
      const requested = screens[index]!;
      const filename = requestedTargets[index]!;
      return {
        frameId: frame.frameId,
        title: requested.title,
        filename,
        role: frame.role,
        variantOf: frame.variantOf,
        canvasFrame: {
          filename,
          x: frame.region.x,
          y: frame.region.y,
          width: frame.region.width,
          height: frame.region.height,
          z: index,
        },
      };
    });

    return {
      designId,
      sessionId: session.id,
      status: session.status,
      frames,
      targets,
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
      embed: true,
      nextRequiredAction:
        "Generate each target with generate-design, using the target filename and canvasFrame placement, the same designSystemId, and contextRefs for coherence.",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open generation session",
      view: "editor",
    };
  },
});
