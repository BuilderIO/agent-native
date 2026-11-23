import { defineAction, fail } from "@agent-native/core/action";
import { stringify } from "yaml";
import { z } from "zod";

import {
  cellContentsSchema,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  type CellDraft,
} from "../app/lib/model/contracts.js";
import { compareOrder } from "../app/lib/model/order.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { getReadableProjectDocument } from "../server/model/projects-store.js";
const cellDraftSchema = z.union(
  cellContentsSchema.options.map((schema) =>
    (schema as z.ZodObject<Record<string, z.ZodType>>)
      .omit({ order: true })
      .partial({ id: true }),
  ) as unknown as [
    z.ZodType<CellDraft>,
    z.ZodType<CellDraft>,
    ...z.ZodType<CellDraft>[],
  ],
);
const createProjectInput = z
  .object({
    title: z
      .string()
      .max(500)
      .regex(/^[^\u0000]*$/),
    description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH),
    cells: z.array(cellDraftSchema).max(200),
  })
  .strict();

export default defineAction({
  description:
    "Export a readable project's source as YAML containing create-project arguments, without run outputs.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: z.object({ content: z.string(), filename: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ projectId }) => {
    const { scope } = await requireReadableProject(projectId);
    const project = await getReadableProjectDocument(scope, projectId);
    if (project === null)
      fail("The project could not be read for export.", {
        statusCode: 404,
        errorCode: "project_not_found",
      });
    const cells = [...project.cells]
      .sort((a, b) => compareOrder(a.contents.order, b.contents.order))
      .map(({ contents }) => {
        const { id, order: _order, ...draft } = contents;
        if (draft.kind === "collapsible") return { ...draft, id };
        if (draft.kind === "sql") {
          const { pendingEdit: _pendingEdit, ...saved } = draft;
          return saved;
        }
        return draft;
      });
    const parsed = createProjectInput.safeParse({
      title: project.title,
      description: project.description,
      cells,
    });
    if (project.language !== "python" || !parsed.success)
      fail("This project cannot be exported in the supported project format.", {
        statusCode: 422,
        errorCode: "project_export_unsupported",
      });
    return {
      content: stringify(parsed.data),
      filename: `${project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project"}.yaml`,
    };
  },
});
