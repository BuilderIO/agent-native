/**
 * create-fusion-app — start a brand-new full-app (fusion) design.
 *
 * Provisions a Builder Fusion branch (one branch per design) in the
 * configured Builder branch project and hands the user's prompt to the
 * Builder cloud agent to scaffold the app. The branch/container is not
 * necessarily ready immediately — call `sync-fusion-app` to poll the
 * container and pick up the preview URL once it boots.
 *
 * Gated behind `FULL_APP_BUILDING_ENABLED`. When Builder is not configured
 * (no credentials or no branch project ID), returns the same graceful
 * `{ status: "not-configured", cta, message }` shape as
 * `migrate-inline-design-to-app` instead of throwing.
 */

import { defineAction } from "@agent-native/core";
import {
  runBuilderAgent,
  resolveBuilderBranchProjectId,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { resolveBuilderStatus } from "../shared/builder-app.js";
import {
  FULL_APP_BUILDING_ENABLED,
  readFusionApp,
  writeFusionApp,
} from "../shared/full-app.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";

function resolveBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

function buildConnectUrl(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/_agent-native/builder/connect`;
}

export default defineAction({
  description:
    "Create a brand-new full-app (fusion) design: provisions a Builder Fusion " +
    "branch and hands the prompt to the Builder cloud agent to scaffold a real " +
    "running app. Use this when the user wants a real app (not an HTML " +
    "prototype) built from scratch for a design. Requires Builder.io to be " +
    "connected with a branch project ID configured; when not configured " +
    "returns a connect CTA — never throws. If the design already has a " +
    "fusion app, returns the existing linkage instead of creating a second " +
    "branch. The branch container may still be booting after this call — " +
    "call sync-fusion-app to poll for the preview URL.",
  schema: z.object({
    designId: z.string().describe("Design project ID to back with a full app."),
    prompt: z
      .string()
      .min(1)
      .describe(
        "What app to build, in the user's own words (features, pages, data model, etc.).",
      ),
    branchName: z
      .string()
      .optional()
      .describe(
        "Optional branch name for the Builder agent to use. If omitted, Builder generates one.",
      ),
  }),
  run: async ({ designId, prompt, branchName }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;

    // Already app-backed: don't create a second branch.
    const existingApp = readFusionApp(design.data);
    if (existingApp) {
      return {
        status: existingApp.status,
        designId,
        projectId: existingApp.projectId,
        branchName: existingApp.branchName,
        editorUrl: existingApp.editorUrl,
        message:
          `This design is already backed by fusion branch ` +
          `"${existingApp.branchName}". Call sync-fusion-app to check its ` +
          `status, or send-fusion-message to continue building on it.`,
      };
    }

    const builderStatus = await resolveBuilderStatus();
    if (!builderStatus.connected || !builderStatus.builderEnabled) {
      const connectUrl = buildConnectUrl(
        process.env.APP_URL ??
          process.env.VITE_APP_URL ??
          process.env.BETTER_AUTH_URL ??
          "",
      );
      const appHost = resolveBuilderAppHost();

      if (!builderStatus.connected) {
        return {
          status: "not-configured" as const,
          designId,
          cta: {
            kind: "connect-builder" as const,
            label: "Build a real app",
            description:
              "Connect Builder.io to build this design as a real running app " +
              "with a live container, branches, and deploys.",
            primaryAction: "Connect Builder.io",
            connectUrl,
          },
          message:
            "Builder is not connected. Call connect-builder-app to start " +
            "the OAuth flow, then retry create-fusion-app.",
        };
      }

      return {
        status: "not-configured" as const,
        designId,
        cta: {
          kind: "configure-project" as const,
          label: "Configure Builder project",
          description:
            "Builder credentials are present but no branch project ID is set. " +
            "Set DISPATCH_BUILDER_PROJECT_ID, BUILDER_BRANCH_PROJECT_ID, or " +
            "BUILDER_PROJECT_ID to enable full app building.",
          primaryAction: "Open Builder settings",
          connectUrl: `${appHost}/account-settings`,
        },
        message:
          "Builder credentials are configured but no branch project ID is set. " +
          "Set DISPATCH_BUILDER_PROJECT_ID to enable full app building.",
      };
    }

    const projectId = await resolveBuilderBranchProjectId();
    if (!projectId) {
      throw new Error(
        "Builder branch project ID is not configured. " +
          "Set DISPATCH_BUILDER_PROJECT_ID, BUILDER_BRANCH_PROJECT_ID, or " +
          "BUILDER_PROJECT_ID and try again.",
      );
    }

    const ownerEmail = getRequestUserEmail();
    const preamble =
      `You are building a brand-new full application for the design project ` +
      `"${design.title}". This is a fresh app — there is no existing code to ` +
      `preserve beyond what you generate. Build exactly what the user asks for ` +
      `below.\n\n## User request\n\n${prompt}`;

    const result = await runBuilderAgent({
      prompt: preamble,
      projectId,
      branchName: branchName?.trim() || undefined,
      userEmail: ownerEmail ?? undefined,
    });

    const now = new Date().toISOString();
    const nextFusionApp = {
      projectId: result.projectId,
      branchName: result.branchName,
      editorUrl: result.url,
      status: "building" as const,
      statusMessage:
        "App is being generated. Call sync-fusion-app to check progress.",
      createdAt: now,
      updatedAt: now,
    };
    await mutateDesignData({
      designId,
      mutate: (current) => writeFusionApp(current, nextFusionApp),
      isApplied: (current) => {
        const persisted = readFusionApp(current);
        return (
          persisted?.projectId === result.projectId &&
          persisted.branchName === result.branchName
        );
      },
    });

    return {
      status: "building" as const,
      designId,
      projectId: result.projectId,
      branchName: result.branchName,
      editorUrl: result.url,
      message:
        `Started building "${design.title}" as a full app on branch ` +
        `"${result.branchName}". Call sync-fusion-app to poll for the ` +
        `preview URL once the container finishes booting.`,
    };
  },
});
