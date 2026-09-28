import { z } from "zod";

export const accessConfig = z.object({
  signup: z.enum(["open", "invited"]).default("open").meta({
    env: "AUTH_SIGNUP",
    doc: "Whether new accounts can sign up openly or need an organization invitation, an allowed email domain, or bootstrap-admin status.",
  }),
  orgCreation: z.enum(["open", "closed"]).default("open").meta({
    env: "ORG_CREATION",
    doc: "Whether authenticated users can create organizations. Closed deployments allow only configured bootstrap admins to create the canonical org.",
  }),
  autoCreateDefaultOrg: z.boolean().default(true).meta({
    env: "AUTO_CREATE_DEFAULT_ORG",
    doc: "Whether a user without memberships gets a personal default org. Ignored when organization creation is closed.",
  }),
  bootstrapAdmins: z.array(z.string().email()).default([]).meta({
    env: "AUTH_BOOTSTRAP_ADMINS",
    doc: "Comma-separated verified email addresses allowed to bootstrap the workspace organization.",
  }),
  sso: z
    .object({
      enabled: z.boolean().default(false).meta({
        env: "AUTH_SSO",
        doc: "Enable opt-in organization SSO provider management.",
      }),
    })
    .prefault({}),
  scim: z
    .object({
      enabled: z.boolean().default(false).meta({
        env: "AUTH_SCIM",
        doc: "Enable opt-in organization SCIM provisioning.",
      }),
      credentialHashSecret: z.string().min(32).optional().meta({
        env: "AUTH_SCIM_CREDENTIAL_HASH_SECRET",
        doc: "Independent secret used to hash framework-managed SCIM bearer credentials.",
      }),
    })
    .prefault({}),
});
