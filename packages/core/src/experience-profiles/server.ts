import { z } from "zod";

import { defineAction, fail, type ActionRunContext } from "../action.js";
import { getAppConfig } from "../app-config/index.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { resolveExperienceFlags, type ExperienceDeviation } from "./index.js";

const profileSchema = z.enum(["reference", "agent-native"]);
const preferenceSchema = z.object({ profile: profileSchema });
const stateSchema = z.object({
  profile: profileSchema,
  savedProfile: profileSchema.nullable(),
  referenceAvailable: z.boolean(),
  values: z.record(z.string(), z.boolean()),
});

export interface ExperienceProfileOptions {
  appId: string;
  deviations: readonly ExperienceDeviation[];
  canUseReference: (ctx: ActionRunContext) => boolean | Promise<boolean>;
}

export function createExperienceProfileActions(
  options: ExperienceProfileOptions,
) {
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(options.appId)) {
    throw new Error("Experience profiles require a stable app id.");
  }
  resolveExperienceFlags(options.deviations, "reference");
  const key = `experience-profile:${options.appId}`;

  async function read(ctx: ActionRunContext | undefined) {
    if (!ctx?.userEmail)
      fail("Sign in to select an experience.", { statusCode: 401 });
    const email = ctx.userEmail;
    const referenceAvailable = await options.canUseReference(ctx);
    const stored = await getUserSetting(email, key, { bypassCache: true });
    const preference = stored === null ? null : preferenceSchema.parse(stored);
    const savedProfile = preference?.profile ?? null;
    // A saved choice is not a permission grant. Revocation takes effect on every read.
    const profile =
      savedProfile === "reference" && referenceAvailable
        ? ("reference" as const)
        : ("agent-native" as const);
    return {
      profile,
      savedProfile,
      referenceAvailable,
      values: resolveExperienceFlags(options.deviations, profile),
    };
  }

  return {
    get: defineAction({
      description:
        "Read the current user's experience profile and effective deviation flags. Reference access is checked on the server; no saved choice defaults to Agent-Native.",
      schema: z.object({}),
      outputSchema: stateSchema,
      http: { method: "GET" },
      run: async (_args, ctx) => read(ctx),
    }),
    set: defineAction({
      description:
        "Save the current user's experience profile without changing navigation, selection, or app records. Reference requires current server authorization.",
      schema: preferenceSchema,
      outputSchema: stateSchema,
      run: async ({ profile }, ctx) => {
        if (!ctx?.userEmail)
          fail("Sign in to select an experience.", { statusCode: 401 });
        if (profile === "reference" && !(await options.canUseReference(ctx))) {
          fail("Reference experience is restricted to authorized reviewers.", {
            statusCode: 403,
            errorCode: "reference_forbidden",
          });
        }
        await putUserSetting(ctx.userEmail, key, { profile });
        return read(ctx);
      },
    }),
  };
}

export function canUseReferenceExperience(ctx: ActionRunContext): boolean {
  const email = ctx.userEmail?.trim().toLowerCase();
  return (
    email !== undefined &&
    getAppConfig().experienceProfiles.referenceEmails.some(
      (reviewer) => reviewer.trim().toLowerCase() === email,
    )
  );
}

export function createGetExperienceProfileAction(
  options: ExperienceProfileOptions,
) {
  return createExperienceProfileActions(options).get;
}

export function createSetExperienceProfileAction(
  options: ExperienceProfileOptions,
) {
  return createExperienceProfileActions(options).set;
}
