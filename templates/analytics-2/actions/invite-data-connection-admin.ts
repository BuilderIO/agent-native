import { defineAction } from "@agent-native/core/action";
import { inviteOrganizationAdmin } from "@agent-native/core/org";
import { z } from "zod";

const invitationOutput = z.object({
  id: z.string(),
  email: z.string(),
  role: z.literal("admin"),
  status: z.literal("pending"),
  emailSent: z.boolean(),
});

export default defineAction({
  description:
    "Invite an administrator to help configure a warehouse connection. Only the workspace owner may send this invitation.",
  schema: z.object({ email: z.string().trim().email() }).strict(),
  outputSchema: invitationOutput,
  http: { method: "POST" },
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  persistInBrowser: false,
  // The shared invitation helper owns the organization audit event.
  audit: { enabled: false },
  run: async (input, ctx) => {
    const result = await inviteOrganizationAdmin(input, ctx);
    return invitationOutput.parse({
      id: result.id,
      email: result.email,
      role: result.role,
      status: result.status,
      emailSent: result.emailSent,
    });
  },
});
