import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resolveProviderRecordLinks } from "../server/crm/provider-record-link.js";
import { listCrmProposals } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "List bounded, access-scoped CRM mutation proposals, their review status, and the upstream record link for completing a provider change by hand. Proposal payloads are intentionally omitted from this list surface. A proposal with status `approved` and no `appliedAt` was prepared and handed off — CRM never wrote it upstream.",
  schema: z.object({
    recordId: z.string().min(1).optional(),
    status: z
      .enum([
        "pending",
        "approved",
        "applied",
        "rejected",
        "conflict",
        "failed",
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe("Cursor returned by a previous page."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => {
    const result = await listCrmProposals(input);
    const links = await resolveProviderRecordLinks(
      result.proposals
        .map((proposal) => proposal.recordId)
        .filter((recordId): recordId is string => Boolean(recordId)),
    );
    return {
      ...result,
      proposals: result.proposals.map((proposal) => {
        const link = proposal.recordId
          ? links.get(proposal.recordId)
          : undefined;
        // A missing link is reported, never blanked: the review surface has to
        // say why it cannot hand off rather than show a dead button.
        return {
          ...proposal,
          recordUrl: link?.available ? link.url : null,
          recordUrlUnavailableReason:
            link && !link.available ? link.reason : null,
        };
      }),
    };
  },
});
