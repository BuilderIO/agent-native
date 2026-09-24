import { defineAction } from "@agent-native/core/action";
import {
  buildAgentAccessUrl,
  createScopedAgentAccessGrant,
  getAppProductionUrl,
  getRequestContext,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getServerAppBasePath } from "../server/lib/public-agent-context.js";
import {
  getActiveOrganizationId,
  nanoid,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";
import {
  CLIP_INTAKE_DEFAULT_TTL_SECONDS,
  CLIP_INTAKE_ID_PARAM,
  CLIP_INTAKE_MAX_TTL_SECONDS,
  CLIP_INTAKE_RESOURCE_KIND,
  CLIP_INTAKE_TOKEN_PARAM,
} from "../shared/clip-intake.js";

function appOrigin(): string {
  const origin = getRequestContext()?.requestOrigin || getAppProductionUrl();
  try {
    return new URL(origin).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export default defineAction({
  description:
    "Create a short-lived, one-recording Clips intake URL. An anonymous visitor can use it to submit one private recording, but the URL cannot read the Clips library or call agent APIs.",
  agentTool: false,
  schema: z.object({
    ttlSeconds: z
      .number()
      .int()
      .min(60)
      .max(CLIP_INTAKE_MAX_TTL_SECONDS)
      .optional()
      .describe("Intake URL lifetime in seconds. Defaults to one hour."),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Sign in to create an intake URL.");
    const organizationId = await getActiveOrganizationId();
    const access = await requireOrganizationAccess(organizationId);
    const intakeId = nanoid(24);
    const ttlSeconds = args.ttlSeconds ?? CLIP_INTAKE_DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    await getDb().insert(schema.clipIntakeSessions).values({
      id: intakeId,
      ownerEmail: access.email,
      organizationId: access.organizationId,
      status: "open",
      expiresAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const grant = createScopedAgentAccessGrant({
      resourceKind: CLIP_INTAKE_RESOURCE_KIND,
      resourceId: intakeId,
      ttlSeconds,
    });
    const intakePath = `/bug-report?${new URLSearchParams({
      [CLIP_INTAKE_ID_PARAM]: intakeId,
    }).toString()}`;
    const url = buildAgentAccessUrl({
      path: intakePath,
      origin: appOrigin(),
      basePath: getServerAppBasePath(),
      token: grant.token,
      tokenParam: CLIP_INTAKE_TOKEN_PARAM,
    });

    return { intakeId, url, expiresAt: grant.expiresAt, ttlSeconds };
  },
});
