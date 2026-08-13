/**
 * The builder-host counterpart to `open-visual-edit`: same handoff shape
 * (synthetic principal, single-use embed ticket), but Builder already owns the
 * running container, so there is no connect/boot preamble here.
 *
 * Deliberately NOT a `defineAction`: it takes the branch identity as input and
 * mints an embed token for the principal derived from it, so exposing it on the
 * action surface would let any authenticated caller skip the partner route's
 * signed-token check and mint a session for a branch they named themselves.
 * The verified-claims boundary is `server/handlers/builder-partner-open.ts`.
 */

import crypto from "node:crypto";

import { writeAppState } from "@agent-native/core/application-state";
import { signEmbedSessionToken } from "@agent-native/core/server";
import {
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { findOrCreateBuilderHostDesign } from "../server/lib/builder-host-design.js";
import {
  builderHostDesignPath,
  builderHostEmbedScope,
  builderHostEmbedUrl,
  BUILDER_HOST_EMBED_TTL_SECONDS,
} from "../server/lib/builder-host-embed.js";
import {
  DEFAULT_FUSION_SCREEN_HEIGHT,
  DEFAULT_FUSION_SCREEN_WIDTH,
  upsertFusionScreens,
} from "../server/lib/fusion-screens.js";
import { parseBuilderPreviewUrl } from "../shared/builder-preview-url.js";

const BUILDER_HOST_PRINCIPAL_DOMAIN = "builder-host.agent-native.invalid";

/**
 * Stable owner partition for designs opened from Builder's Design tab; never
 * installed as a browser session. Keyed on the branch, so every Builder
 * teammate opening it lands on the same design rather than a private copy.
 */
export function builderHostPrincipal(key: {
  builderOrgId: string;
  projectId: string;
  branchName: string;
}): string {
  const id = crypto
    .createHash("sha256")
    .update(`${key.builderOrgId}\u0000${key.projectId}\u0000${key.branchName}`)
    .digest("hex")
    .slice(0, 24);
  return `builder+${id}@${BUILDER_HOST_PRINCIPAL_DOMAIN}`;
}

/**
 * Root-relative only: `upsertFusionScreens` resolves each path against the
 * preview base, so an absolute URL here would place a screen outside the
 * validated container origin.
 */
const routeSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((path) => path.startsWith("/") && !path.startsWith("//"), {
      message: "Route path must be root-relative.",
    })
    .refine((path) => !/[[:*]/.test(path), {
      message: "Route path must not contain a dynamic segment.",
    }),
  title: z.string().optional(),
});

export const openBuilderVisualEditSchema = z.object({
  previewUrl: z
    .string()
    .describe(
      "Builder container preview URL. Must be a recognized Builder preview host.",
    ),
  builderOrgId: z.string().min(1).describe("Builder organization id."),
  projectId: z.string().min(1).describe("Builder project id."),
  branchName: z.string().min(1).describe("Builder branch backing this design."),
  contentId: z
    .string()
    .nullable()
    .optional()
    .describe("Builder content id the tab was opened from, when there is one."),
  title: z
    .string()
    .optional()
    .describe("Title for a newly created design. Defaults to the branch name."),
  routes: z
    .array(routeSchema)
    .optional()
    .describe(
      "Routes to place as screens. Defaults to the preview URL's path.",
    ),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export type OpenBuilderVisualEditArgs = z.input<
  typeof openBuilderVisualEditSchema
>;

export async function openBuilderVisualEdit(input: OpenBuilderVisualEditArgs) {
  const args = openBuilderVisualEditSchema.parse(input);
  {
    // Validate before any write: a bad preview URL must fail loudly rather than
    // create an empty design that reads as a broken container.
    const preview = parseBuilderPreviewUrl(args.previewUrl);
    const previewOrigin = preview.origin;
    const key = {
      builderOrgId: args.builderOrgId,
      projectId: args.projectId,
      branchName: args.branchName,
    };

    const requestedRoutes = args.routes?.length
      ? args.routes
      : [{ path: preview.pathname || "/" }];
    const paths = [...new Set(requestedRoutes.map((route) => route.path))];

    const runForPrincipal = async () => {
      const { designId, created } = await findOrCreateBuilderHostDesign({
        key: { ...key, contentId: args.contentId ?? null },
        previewUrl: previewOrigin,
        title: args.title,
      });

      // The container's own origin, framed cross-origin. Serving it from this
      // app's origin instead would run the user's application code with this
      // app's storage, cookies and DOM.
      const { screens, placedFrames } = await upsertFusionScreens({
        designId,
        previewUrl: previewOrigin,
        paths,
        width: args.width ?? DEFAULT_FUSION_SCREEN_WIDTH,
        height: args.height ?? DEFAULT_FUSION_SCREEN_HEIGHT,
      });

      const urlPath = builderHostDesignPath(designId);
      await writeAppState("visual-edit", {
        designId,
        source: "builder-host",
        ...key,
        previewUrl: previewOrigin,
        urlPath,
        screens,
        updatedAt: new Date().toISOString(),
      });

      // The session resolves to the principal, which owns this design, so
      // `resolveAccess` grants owner without the design being public.
      const embedToken = signEmbedSessionToken({
        ownerEmail: builderHostPrincipal(key),
        targetPath: urlPath,
        scope: builderHostEmbedScope(designId),
        ttlSeconds: BUILDER_HOST_EMBED_TTL_SECONDS,
      });

      const result = {
        designId,
        created,
        urlPath,
        previewUrl: previewOrigin,
        screenCount: screens.length,
        screens,
        placedFrames,
      };
      // Non-enumerable so generic serialization of action output cannot copy
      // the bearer into model-visible text.
      Object.defineProperty(result, "embedUrl", {
        value: builderHostEmbedUrl(urlPath, embedToken),
        enumerable: false,
      });
      return result as typeof result & { embedUrl: string };
    };

    return runWithRequestContext(
      {
        ...(getRequestContext() ?? {}),
        userEmail: builderHostPrincipal(key),
        orgId: undefined,
      },
      runForPrincipal,
    );
  }
}
