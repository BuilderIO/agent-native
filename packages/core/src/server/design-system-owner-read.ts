import { z } from "zod";

import { resolveA2ACallerAuth } from "../a2a/caller-auth.js";
import { invokeAgentAction } from "../a2a/invoke.js";
import { fail } from "../action.js";
import {
  designSystemArtifactSchema,
  designSystemWorkspaceSchema,
} from "../shared/design-system-authoring.js";

const referenceSchema = z.object({
  ownerApp: z.enum(["design", "slides"]),
  systemId: z.string(),
  revision: z.number().int().min(0),
});
const systemSchema = z.object({
  id: z.string(),
  title: z.string(),
  agentContext: z.string(),
  reference: referenceSchema,
  description: z.string().nullable().optional(),
  data: z.string().nullable().optional(),
  assets: z.string().nullable().optional(),
  customInstructions: z.string().optional(),
  isDefault: z.boolean().optional(),
  visibility: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  authoring: designSystemWorkspaceSchema.optional(),
  builder: z.unknown().optional(),
  builderDesignSystemId: z.string().nullable().optional(),
});
const artifactSchema = z.object({
  id: z.string(),
  ownerApp: z.enum(["design", "slides"]),
  workspaceRevision: z.number(),
  artifact: designSystemArtifactSchema,
  html: z.string().nullable(),
  text: z.string().nullable(),
});

async function invoke(
  ownerApp: "design" | "slides",
  selfAppId: "design" | "slides",
  action: string,
  input: Record<string, unknown>,
) {
  const auth = await resolveA2ACallerAuth();
  if (!auth.userEmail)
    return fail("Sign in to read an owner-app design system.", {
      errorCode: "unauthorized",
      statusCode: 401,
    });
  const { result } = await invokeAgentAction({
    target: ownerApp,
    selfAppId,
    action,
    input,
    userEmail: auth.userEmail,
    orgDomain: auth.orgDomain,
    orgSecret: auth.orgSecret,
  });
  if (result.status !== "completed")
    return fail(
      "The owner app could not read this design-system reference. Check access and the pinned revision.",
      { errorCode: "design_system_owner_read_failed", statusCode: 409 },
    );
  try {
    return JSON.parse(result.output) as unknown;
  } catch {
    return fail("The owner app returned unreadable design-system data.", {
      errorCode: "design_system_owner_result_invalid",
      statusCode: 502,
    });
  }
}

export async function readOwnerDesignSystem(
  selfAppId: "design" | "slides",
  input: {
    id: string;
    ownerApp: "design" | "slides";
    consumedRevision?: number;
    compact?: "true" | "false";
  },
) {
  const result = systemSchema.safeParse(
    await invoke(input.ownerApp, selfAppId, "get-design-system", input),
  );
  if (!result.success)
    return fail("The owner app returned an invalid design-system snapshot.", {
      errorCode: "design_system_owner_result_invalid",
      statusCode: 502,
    });
  if (
    result.data.id !== input.id ||
    result.data.reference.ownerApp !== input.ownerApp ||
    result.data.reference.systemId !== input.id ||
    (input.consumedRevision !== undefined &&
      result.data.reference.revision !== input.consumedRevision)
  )
    return fail(
      "The owner app could not resolve the pinned design-system revision.",
      { errorCode: "design_system_revision_unavailable", statusCode: 409 },
    );
  return result.data;
}

export async function readOwnerDesignSystemArtifact(
  selfAppId: "design" | "slides",
  input: {
    id: string;
    ownerApp: "design" | "slides";
    targetId: string;
    revision?: number;
  },
) {
  const result = artifactSchema.safeParse(
    await invoke(
      input.ownerApp,
      selfAppId,
      "get-design-system-artifact",
      input,
    ),
  );
  if (!result.success)
    return fail("The owner app returned an invalid component artifact.", {
      errorCode: "design_system_owner_result_invalid",
      statusCode: 502,
    });
  if (
    result.data.id !== input.id ||
    result.data.ownerApp !== input.ownerApp ||
    result.data.artifact.id !== input.targetId ||
    (input.revision !== undefined &&
      result.data.artifact.revision !== input.revision)
  )
    return fail(
      "The owner app could not resolve the pinned artifact revision.",
      { errorCode: "design_system_revision_unavailable", statusCode: 409 },
    );
  return result.data;
}
