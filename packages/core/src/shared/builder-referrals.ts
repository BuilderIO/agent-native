import { z } from "zod";

const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const inviteUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.origin === "https://builder.io" &&
      url.pathname === "/signup" &&
      /^[0-9a-f]{32}$/i.test(url.searchParams.get("fus_ref") ?? "")
    );
  });

export const builderReferralInfoSchema = z
  .object({
    eligible: z.boolean(),
    inviteUrl: inviteUrlSchema.nullable(),
    creditsPerReferral: safeCount,
    completedReferrals: safeCount,
    pendingReferrals: safeCount,
    creditsEarned: safeCount,
  })
  .superRefine((info, context) => {
    if (info.eligible !== Boolean(info.inviteUrl)) {
      context.addIssue({
        code: "custom",
        message: "Referral eligibility and invite URL must agree.",
        path: ["inviteUrl"],
      });
    }
  });

export type BuilderReferralInfo = z.infer<typeof builderReferralInfoSchema>;
