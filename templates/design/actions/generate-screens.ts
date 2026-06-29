import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import "../server/db/index.js";
import { assignRegions } from "../shared/canvas-math.js";
import {
  designGenerationSessionKey,
  type DesignGenerationFrame,
  type DesignGenerationSession,
} from "../shared/generation-session.js";

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
    variantOf: z.string().optional(),
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
    "Start a visible multi-agent generation session on the Design canvas. " +
    "Use this before generating multiple screens or variations in parallel: it " +
    "assigns non-overlapping canvas regions, publishes named agent/frame " +
    "status to application state, and returns per-frame generation instructions. " +
    "After this action, fan out calls to generate-design for each returned " +
    "frame, passing the returned canvasFrame values to generate-design so " +
    "screens appear in the infinite overview canvas.",
  schema: z.object({
    designId: z.string().describe("Design project ID to generate into"),
    prompt: z.string().min(1).describe("Overall generation prompt"),
    screens: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z.array(requestedScreenSchema).min(1).max(8),
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

    const regions = assignRegions(screens.length, {
      origin: { x: 0, y: 0 },
      columns: screens.length <= 3 ? screens.length : 3,
    });

    const seenFilenames = new Map<string, number>();
    // Dedupe any filename (explicit or auto-generated) so two screens can never
    // resolve to the same target file — otherwise generate-design silently
    // overwrites the first screen's output with the second's.
    const dedupeFilename = (base: string): string => {
      if (!seenFilenames.has(base)) {
        seenFilenames.set(base, 1);
        return base;
      }
      const count = seenFilenames.get(base)! + 1;
      seenFilenames.set(base, count);
      const dot = base.lastIndexOf(".");
      return dot > 0
        ? `${base.slice(0, dot)}-${count}${base.slice(dot)}`
        : `${base}-${count}`;
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
