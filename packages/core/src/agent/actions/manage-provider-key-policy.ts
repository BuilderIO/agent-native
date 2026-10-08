import { z } from "zod";

import { defineAction, fail, type ActionRunContext } from "../../action.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  listPersonalProviderKeyHolders,
  type PersonalProviderKeyHolder,
} from "../../server/personal-provider-key-holders.js";
import {
  readOrgMemberRole,
  readPersonalProviderKeyPolicy,
  writePersonalProviderKeyPolicy,
} from "../../server/personal-provider-key-policy.js";

export const PROVIDER_KEY_POLICY_ADMIN_REQUIRED_ERROR_CODE =
  "provider_key_policy_admin_required";

export interface ProviderKeyPolicyStatus {
  /** Members can't use or add personal provider keys or personal Builder.io. */
  restricted: boolean;
  /** The caller is an owner or admin and may change `restricted`. */
  canManage: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
  /**
   * Owners and admins only: members whose stored personal keys or personal
   * Builder.io connection stop working while restricted (and work again
   * when it is turned off).
   */
  affectedMembers?: PersonalProviderKeyHolder[];
  /** Set calls only: whether the value actually changed. */
  changed?: boolean;
}

async function recordPolicyAudit(
  ctx: ActionRunContext | undefined,
  input: {
    email: string;
    orgId: string;
    restricted: boolean;
    status: "success" | "denied";
  },
): Promise<void> {
  const summary =
    input.status === "denied"
      ? "Refused a change to Restrict personal API keys"
      : input.restricted
        ? "Restricted personal API keys"
        : "Allowed personal API keys";
  const { recordActionAudit } = await import("../../audit/record.js");
  await recordActionAudit({
    config: {
      enabled: true,
      target: () => ({
        type: "provider-key-policy",
        id: input.orgId,
        orgId: input.orgId,
        visibility: "org",
      }),
      summary: () => summary,
    },
    args: { set: input.restricted },
    ctx: {
      actionName: ctx?.actionName ?? "manage-provider-key-policy",
      caller: ctx?.caller,
      userEmail: input.email,
      orgId: input.orgId,
      threadId: ctx?.threadId,
      turnId: ctx?.turnId,
      runId: ctx?.runId,
    },
    status: input.status,
  });
}

export default defineAction({
  description:
    "Read or change the organization's \"Restrict personal API keys\" setting. While restricted, members (not owners or admins) can't use or save their own model provider keys (Anthropic, OpenAI, Gemini, OpenRouter, and the rest) or a personal Builder.io connection, so their chats use organization providers only. Nothing is deleted: turning it off makes their stored keys work again. Omit `set` to read the setting; owners and admins also get `affectedMembers` (each member and the providers that stop working for them). Pass `set` to change it; owners and admins only. Before turning it on, read it first and tell the user who is affected.",
  schema: z.object({
    set: z
      .boolean()
      .optional()
      .describe(
        "true restricts personal API keys, false allows them. Omit to read the current value.",
      ),
  }),
  http: { method: "POST" },
  // A read must not announce a change, or every query keyed on actions
  // refetches after each read.
  planMode: {
    effect: (args) => (args.set === undefined ? "read" : "write"),
    omittedProperties: ["set"],
  },
  // Only real changes (and refused ones) are recorded, below.
  audit: { enabled: false },
  run: async (args, ctx): Promise<ProviderKeyPolicyStatus> => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    const orgId = ctx?.orgId?.trim();
    if (!email)
      fail("Sign in to manage API key settings.", { statusCode: 401 });
    if (!orgId) {
      fail("Select an organization to manage API key settings.", {
        statusCode: 400,
      });
    }

    const role = await readOrgMemberRole(orgId, email);
    const canManage = canManageOrg(role);

    if (args.set !== undefined) {
      if (!canManage) {
        await recordPolicyAudit(ctx, {
          email,
          orgId,
          restricted: args.set,
          status: "denied",
        });
        fail(
          "Only organization owners and admins can restrict personal API keys.",
          {
            statusCode: 403,
            errorCode: PROVIDER_KEY_POLICY_ADMIN_REQUIRED_ERROR_CODE,
          },
        );
      }
      const { policy, changed } = await writePersonalProviderKeyPolicy(orgId, {
        restricted: args.set,
        updatedBy: email,
      });
      if (changed) {
        await recordPolicyAudit(ctx, {
          email,
          orgId,
          restricted: policy.restricted,
          status: "success",
        });
      }
      return {
        ...policy,
        canManage,
        affectedMembers: await listPersonalProviderKeyHolders(orgId),
        changed,
      };
    }

    const policy = await readPersonalProviderKeyPolicy(orgId);
    return {
      ...policy,
      canManage,
      ...(canManage
        ? { affectedMembers: await listPersonalProviderKeyHolders(orgId) }
        : {}),
    };
  },
});
