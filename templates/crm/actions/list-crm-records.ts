import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  createConnectedCrmAdapter,
  isConnectedCrmProvider,
} from "../server/crm/adapter.js";
import { resolveNativeCrmAccessScope } from "../server/crm/native-adapter.js";
import {
  crmFilterSchema,
  crmSortSchema,
  queryCrmRecords,
} from "../server/lib/crm-query.js";

const kinds = [
  "account",
  "person",
  "opportunity",
  "activity",
  "task",
  "custom",
] as const;

export default defineAction({
  description:
    'List a bounded, access-scoped page of CRM records. Filters, sorting, and pagination all run in SQL: pass a typed filter tree (or a saved viewId whose filter is used), an ordered sort, and the cursor from the previous page. A condition value of "@currentUser" resolves to the calling user on actor-reference attributes and owner fields. A filter naming an unknown or archived attribute fails rather than returning unfiltered rows.',
  schema: z.object({
    kind: z
      .enum(kinds)
      .optional()
      .describe("Optional canonical CRM record kind."),
    connectionId: z
      .string()
      .min(1)
      .optional()
      .describe("Optional CRM connection ID."),
    viewId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "Optional access-scoped saved CRM view ID; its stored filter, sort, and columns are applied. Cannot be combined with filter.",
      ),
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Optional display-name search, ANDed on top of the filter."),
    filter: crmFilterSchema
      .optional()
      .describe(
        'Typed filter tree: {op:"and"|"or", conditions:[{attributeId|field, condition, value}]}, nestable one level. Date values accept the relative tokens today, this-week, last-N-days, and next-N-days.',
      ),
    sort: crmSortSchema
      .optional()
      .describe(
        "Ordered sort keys; record id breaks ties so pagination cannot skip or repeat a row.",
      ),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .max(4_000)
      .optional()
      .describe("Cursor returned by a previous page of this same query."),
    includeTotal: z
      .boolean()
      .optional()
      .describe(
        "Include totalEstimate: the filtered row count before per-record provider scope revalidation.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: (input, ctx?: ActionRunContext) =>
    queryCrmRecords(input, {
      actorEmail: ctx?.userEmail ?? getRequestUserEmail() ?? null,
      resolveScope: async (target) => {
        if (target.provider === "native") {
          return resolveNativeCrmAccessScope({
            connectionId: target.connectionId,
            objectType: target.objectType,
          });
        }
        if (
          !isConnectedCrmProvider(target.provider) ||
          !target.workspaceConnectionId
        ) {
          return null;
        }
        const adapter = await createConnectedCrmAdapter({
          provider: target.provider,
          connectionId: target.workspaceConnectionId,
          ...(ctx?.userEmail ? { userEmail: ctx.userEmail } : {}),
          ...(ctx?.orgId !== undefined ? { orgId: ctx.orgId } : {}),
        });
        return adapter.getAccessScope(target.objectType);
      },
    }),
});
