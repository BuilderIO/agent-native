import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getOutputReviewSummarySource } from "../reviews.js";
import { getTraceSummary, upsertHumanReviewSummary } from "../store.js";
import type { HumanReviewArtifactRef, HumanReviewSummary } from "../types.js";
import {
  authorizeObservabilityOrgAdmin,
  getObservabilityOrgAdminAccess,
  requireObservabilityReviewRunScope,
  resolveObservabilityReviewOrg,
} from "./authorization.js";

const summaryText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !/(?:data:[^\s;,]+;base64,|<\/?(?:html|script|svg|iframe)\b|\b[A-Za-z0-9+/]{512,}={0,2}\b)/i.test(
          value,
        ),
      "Summary fields must be plain bounded text, not raw artifact payloads.",
    );

const artifactSchema = z
  .object({
    appId: z
      .enum(["design", "slides", "analytics"])
      .describe("Artifact source app."),
    artifactId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/)
      .max(200)
      .describe("Exact artifact ID shown in the source action evidence."),
    title: summaryText(240).describe(
      "Short artifact title from the source evidence.",
    ),
    path: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe(
        "Optional app-native path; invalid app/path combinations are omitted.",
      ),
  })
  .strict();

function appPathMatches(ref: HumanReviewArtifactRef): boolean {
  if (!ref.path) return false;
  const id = ref.artifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = {
    design: new RegExp(`^/(?:design|present)/${id}$`),
    slides: new RegExp(`^/deck/${id}(?:/present)?$`),
    analytics: new RegExp(
      `^(?:/(?:dashboards|analyses|adhoc)/${id}|/api/media/${id})$`,
    ),
  };
  return patterns[ref.appId].test(ref.path);
}

function appMarkerMatches(
  value: string,
  appId: HumanReviewArtifactRef["appId"],
): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const markers = {
    design: /(?:^|_)(?:design|designs|design_app)(?:_|$)/,
    slides: /(?:^|_)(?:slides|slide|deck|presentation)(?:_|$)/,
    analytics:
      /(?:^|_)(?:analytics|dashboard|dashboards|chart|charts|analysis)(?:_|$)/,
  };
  return markers[appId].test(normalized);
}

function artifactEvidenceMatches(
  source: unknown,
  appId: HumanReviewArtifactRef["appId"],
  artifactId: string,
): boolean {
  if (!Array.isArray(source)) return false;
  const idKeys = {
    design: /^(?:id|artifact_?id|design_?id)$/i,
    slides: /^(?:id|artifact_?id|slide_?id|deck_?id|presentation_?id)$/i,
    analytics:
      /^(?:id|artifact_?id|chart_?id|dashboard_?id|analysis_?id|filename)$/i,
  };
  const markerKeys = /^(?:app_?id|app|application|server_?id|tool_?name)$/i;
  const hasAppMarker = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(hasAppMarker);
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) =>
        markerKeys.test(key)
          ? typeof item === "string" && appMarkerMatches(item, appId)
          : hasAppMarker(item),
    );
  };
  const visit = (value: unknown, renderable = true): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value))
      return value.some((item) => visit(item, renderable));
    const record = value as Record<string, unknown>;
    return Object.entries(record).some(([key, item]) => {
      const currentRenderable = renderable && record.renderable !== false;
      return (
        (idKeys[appId].test(key) &&
          item === artifactId &&
          !(appId === "design" && !currentRenderable)) ||
        visit(item, currentRenderable)
      );
    });
  };

  return source.some((span) => {
    if (!span || typeof span !== "object" || Array.isArray(span)) return false;
    const record = span as Record<string, unknown>;
    if (record.status !== "success") return false;
    const appMatches =
      (typeof record.name === "string" &&
        appMarkerMatches(record.name, appId)) ||
      hasAppMarker(record.output);
    return appMatches && visit(record.output, record.renderable !== false);
  });
}

export default defineAction({
  description:
    "Persist a concise human-review summary for a run. Artifact IDs must exactly match IDs returned by get-observability-review-summary-source; do not create, guess, or infer IDs. Include only real design, slide-deck, or analytics artifacts.",
  schema: z
    .object({
      runId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe("The target observability run ID."),
      orgId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "The target organization ID; must match the active organization.",
        ),
      ask: summaryText(2_000).describe(
        "Concise summary of what the user asked.",
      ),
      outcome: summaryText(3_000).describe(
        "Concise outcome, without raw payloads.",
      ),
      artifacts: z.array(artifactSchema).max(12),
    })
    .strict(),
  agentTool: true,
  authorize: authorizeObservabilityOrgAdmin,
  run: async (args, ctx) => {
    const access = getObservabilityOrgAdminAccess(ctx);
    const { userId } = access;
    requireObservabilityReviewRunScope(args.runId);
    const orgId = resolveObservabilityReviewOrg(
      { kind: "organization", orgId: access.orgId },
      args.orgId,
    );
    const target = await getTraceSummary(args.runId, { orgId });
    if (!target)
      fail("That agent output is no longer available.", { statusCode: 404 });
    const source = await getOutputReviewSummarySource({
      runId: args.runId,
      orgId,
    });
    if (!source.found)
      fail("That agent output is no longer available.", { statusCode: 404 });

    const artifacts = args.artifacts.map((artifact) => {
      const isAttachedArtifact = source.attachedArtifacts.some(
        (attached) =>
          attached.appId === artifact.appId &&
          attached.artifactId === artifact.artifactId,
      );
      if (
        !isAttachedArtifact &&
        !artifactEvidenceMatches(
          source.toolEvidence,
          artifact.appId,
          artifact.artifactId,
        )
      )
        fail(
          "Artifact IDs must come from the thread or captured tool evidence.",
          {
            statusCode: 400,
          },
        );
      const normalized: HumanReviewArtifactRef = {
        appId: artifact.appId,
        artifactId: artifact.artifactId,
        title: artifact.title,
        ...(artifact.path && appPathMatches(artifact as HumanReviewArtifactRef)
          ? { path: artifact.path }
          : {}),
      };
      return normalized;
    });
    const now = Date.now();
    const summary: HumanReviewSummary = {
      runId: target.runId,
      orgId,
      ask: args.ask,
      outcome: args.outcome,
      artifacts,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await upsertHumanReviewSummary(summary)))
      fail("That agent output is no longer available.", { statusCode: 404 });
    return { saved: true, runId: target.runId };
  },
});
