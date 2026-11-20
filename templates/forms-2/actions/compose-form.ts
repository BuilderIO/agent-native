import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { formStatusSchema } from "../shared/form-contract.js";
import {
  blockListSchema,
  deriveQuestions,
  formTitleOf,
  inputPages,
  splitPages,
} from "../shared/form-model/index.js";
import { formsAccess, formsErrors, requireForm } from "./_access.js";
import { composeBlocks, composeItemSchema } from "./_compose-form.js";
import { saveDraftBlocks } from "./_save-draft.js";

export default defineAction({
  description:
    "Create or extend a form's content from simple items; use this instead of hand-writing blocks. Items are questions (with options for choice types), text, headings, dividers, page breaks, and optional logic. Saves as the draft; call publish-form to put it live. For precise edits to existing blocks, use get-form and save-form-draft.",
  schema: z.object({
    id: z.string().describe("Form id"),
    mode: z
      .enum(["replace", "append"])
      .default("append")
      .describe(
        "append (default) adds the items after the current content, before any thank-you page. replace discards all current content and keeps only the title",
      ),
    title: z
      .string()
      .max(10_000)
      .optional()
      .describe(
        "Form title shown at the top; keeps the current title when omitted; an empty title takes the form's name",
      ),
    items: z
      .array(composeItemSchema)
      .min(1)
      .max(200)
      .describe(
        "In order, top to bottom. Put a page_break item between pages. A logic item applies to the page it sits on, so place it after the question it reads",
      ),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    status: formStatusSchema,
    hasDraftBlocks: z.boolean(),
    pageCount: z.number(),
    questions: z.array(z.object({ title: z.string(), type: z.string() })),
  }),
  errors: formsErrors,
  link: ({ args }) => ({
    url: buildDeepLink({
      app: "forms-2",
      view: "editor",
      to: `/forms/${encodeURIComponent(args.id)}/edit`,
      params: { id: args.id },
    }),
    label: "Open form in Forms",
  }),
  run: async ({ id, mode, title, items }) => {
    const { form } = await requireForm(formsAccess(), id);
    const current = form.draftBlocks ?? form.publishedBlocks;
    const heading =
      title ??
      (!formTitleOf(current) && form.nameIsCustom ? form.name : undefined);
    const blocks = blockListSchema.parse(
      composeBlocks(current, items, mode, heading),
    );
    const saved = await saveDraftBlocks(form, blocks);
    return {
      saved: saved.saved,
      status: saved.status,
      hasDraftBlocks: saved.hasDraftBlocks,
      pageCount: inputPages(splitPages(blocks)).length,
      questions: deriveQuestions(blocks).map((q) => ({
        title: q.title,
        type: q.type,
      })),
    };
  },
});
