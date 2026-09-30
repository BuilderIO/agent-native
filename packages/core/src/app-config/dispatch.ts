import { z } from "zod";

export const dispatchConfig = z.object({
  adminEmails: z.array(z.string().email()).default([]).meta({
    env: "DISPATCH_ADMIN_EMAILS",
    doc: "Comma-separated deployment administrators for Dispatch.",
  }),
  workspaceOwnerEmails: z.array(z.string().email()).default([]).meta({
    env: "WORKSPACE_OWNER_EMAIL",
    doc: "Comma-separated workspace owner emails trusted by Dispatch.",
  }),
  defaultOwnerEmails: z.array(z.string().email()).default([]).meta({
    env: "DISPATCH_DEFAULT_OWNER_EMAIL",
    doc: "Comma-separated default Dispatch owner emails.",
  }),
});
