import { localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Manage the organization: view org info, list members, invite new members.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action to perform",
        enum: ["info", "list-members", "invite", "create"],
      },
      email: {
        type: "string",
        description: "Email address to invite (for invite action)",
      },
      name: {
        type: "string",
        description: "Organization name (for create action)",
      },
    },
    required: ["action"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  switch (args.action) {
    case "info": {
      const data = await localFetch<any>("/api/org/me");
      if (!data.orgId) {
        return "No organization set up. The user can create one in Settings, or use --action=create --name='Org Name'.";
      }
      return JSON.stringify(
        {
          orgName: data.orgName,
          orgId: data.orgId,
          role: data.role,
          pendingInvitations: data.pendingInvitations?.length ?? 0,
        },
        null,
        2,
      );
    }

    case "list-members": {
      const data = await localFetch<any>("/api/org/members");
      if (!data.members?.length) {
        return "No organization or no members found.";
      }
      return data.members
        .map(
          (m: any) =>
            `${m.email} (${m.role}) — joined ${new Date(m.joinedAt).toLocaleDateString()}`,
        )
        .join("\n");
    }

    case "invite": {
      if (!args.email) {
        return "Error: --email is required for invite action";
      }
      const result = await localFetch<any>("/api/org/invitations", {
        method: "POST",
        body: JSON.stringify({ email: args.email }),
      });
      return `Invitation sent to ${result.email}. They'll need to sign in with Google using that email to accept.`;
    }

    case "create": {
      if (!args.name) {
        return "Error: --name is required for create action";
      }
      const result = await localFetch<any>("/api/org", {
        method: "POST",
        body: JSON.stringify({ name: args.name }),
      });
      return `Organization "${result.name}" created. You are the owner.`;
    }

    default:
      return `Unknown action: ${args.action}. Use info, list-members, invite, or create.`;
  }
}
