import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { formDetailSchema } from "../shared/form-contract.js";
import { formsAccess, formsErrors, requireForm } from "./_access.js";
import {
  acceptingResponses,
  completedCounts,
  toFormSummary,
} from "./_form-store.js";

export default defineAction({
  description:
    "Read a form with its published blocks, draft blocks (null when there are no unpublished edits), settings and whether it accepts responses.",
  schema: z.object({ id: z.string().describe("Form id") }),
  outputSchema: formDetailSchema,
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = formsAccess();
    const { form, workspace } = await requireForm(access, id);
    const counts = await completedCounts(getDb(), access.orgId, [id]);
    const count = counts.get(id) ?? 0;
    return {
      ...toFormSummary(form, count),
      workspaceName: workspace.name,
      nameIsCustom: form.nameIsCustom,
      publishedBlocks: form.publishedBlocks,
      draftBlocks: form.draftBlocks,
      settings: form.settings,
      publishedAt: form.publishedAt,
      revisionUpdatedAt: form.revisionUpdatedAt,
      acceptingResponses: acceptingResponses(form, count),
    };
  },
});
