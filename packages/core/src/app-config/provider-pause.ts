import { z } from "zod";

const email = z.string().trim().toLowerCase().min(3).max(320);

/**
 * Who may flip a deployment-wide provider pause.
 *
 * The switch stops every user's calls to that provider on this deployment, so the identity that may flip it
 * has to come from the deployment's own declaration, not from the caller's session. A signed-in person
 * creates an organization with themselves as its owner on first sign-in, so "owner of my own org" proves
 * nothing about this deployment; only this list, or the one organization this deployment names, does.
 *
 * Unset means nobody: an undeclared deployment refuses the switch instead of inheriting whoever happens to
 * be signed in. `PROVIDER_PAUSE_OPERATOR_EMAILS` is a comma-separated allowlist; `PROVIDER_PAUSE_OPERATOR_ORG`
 * names the single organization whose owner or admin counts.
 */
export const providerPauseConfig = z.object({
  operatorEmails: z.array(email).default([]).meta({
    env: "PROVIDER_PAUSE_OPERATOR_EMAILS",
    doc: "Comma-separated emails allowed to change a deployment-wide provider pause. Unset means nobody may.",
  }),
  operatorOrgId: z.string().trim().min(1).optional().meta({
    env: "PROVIDER_PAUSE_OPERATOR_ORG",
    doc: "The deployment's own organization id; its owner or admin may change a deployment-wide provider pause.",
  }),
});

export type ProviderPauseConfig = z.infer<typeof providerPauseConfig>;
