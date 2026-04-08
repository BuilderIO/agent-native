import { defineAction } from "@agent-native/core";
import { localFetch } from "./helpers.js";

export default defineAction({
  description:
    "Manage organizations: view info, list members, invite, create, or switch active org.",
  parameters: {
    action: {
      type: "string",
      description: "Action to perform",
      enum: ["info", "list-members", "invite", "create", "switch"],
    },
    email: {
      type: "string",
      description: "Email address to invite (for invite action)",
    },
    name: {
      type: "string",
      description: "Organization name (for create action)",
    },
    orgId: {
      type: "string",
      description: "Organization ID to switch to (for switch action)",
    },
  },
  http: false,
  run: async (args) => {
    switch (args.action) {
      case "info": {
        const data = await localFetch<any>("/api/org/me");
        if (!data.orgId && (!data.orgs || data.orgs.length === 0)) {
          return "No organization set up. The user can create one in Settings, or use --action=create --name='Org Name'.";
        }
        return {
          activeOrg: data.orgName,
          activeOrgId: data.orgId,
          role: data.role,
          allOrgs: data.orgs ?? [],
          pendingInvitations: data.pendingInvitations?.length ?? 0,
        };
      }

      case "list-members": {
        const data = await localFetch<any>("/api/org/members");
        if (!data.members?.length) {
          return "No organization or no members found.";
        }
        return data.members.map((m: any) => ({
          email: m.email,
          role: m.role,
          joinedAt: new Date(m.joinedAt).toLocaleDateString(),
        }));
      }

      case "invite": {
        if (!args.email) {
          return { error: "--email is required for invite action" };
        }
        const result = await localFetch<any>("/api/org/invitations", {
          method: "POST",
          body: JSON.stringify({ email: args.email }),
        });
        return `Invitation sent to ${result.email}. They'll need to sign in with Google using that email to accept.`;
      }

      case "create": {
        if (!args.name) {
          return { error: "--name is required for create action" };
        }
        const result = await localFetch<any>("/api/org", {
          method: "POST",
          body: JSON.stringify({ name: args.name }),
        });
        return `Organization "${result.name}" created. You are the owner.`;
      }

      case "switch": {
        if (!args.orgId) {
          return {
            error:
              "--orgId is required for switch action. Use --action=info to see available orgs.",
          };
        }
        const result = await localFetch<any>("/api/org/switch", {
          method: "PUT",
          body: JSON.stringify({ orgId: args.orgId }),
        });
        return `Switched to organization "${result.orgName}" (${result.role}).`;
      }

      default:
        return {
          error: `Unknown action: ${args.action}. Use info, list-members, invite, create, or switch.`,
        };
    }
  },
});
