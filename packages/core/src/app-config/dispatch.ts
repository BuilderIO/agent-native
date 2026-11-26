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
  defaultOwnerEmail: z.string().email().optional().meta({
    env: "DISPATCH_DEFAULT_OWNER_EMAIL",
    doc: "Default Dispatch owner email.",
  }),
  directAppActions: z.boolean().default(false).meta({
    env: "DISPATCH_DIRECT_APP_ACTIONS",
    doc: "Expose list_app_actions, call_app_action, and read_view so Dispatch and MCP callers can run a granted app's actions directly.",
  }),
});
