import { defineAction } from "@agent-native/core/action";
import { listWorkspaceUserGroups } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { createBigQuerySchema } from "../app/components/data/bigquery.js";
import {
  SUPPORTED_TEMPLATE_TYPES,
  WAREHOUSE_TEMPLATES,
} from "../app/components/data/connection-catalog.js";
import { postgresConnectionSchema } from "../app/components/data/postgres.js";
import { FORM_ONLY_SCHEMAS } from "../app/components/data/warehouse-forms.js";
import { connectionContext } from "../server/model/data-connections.js";
const field = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "text",
    "password",
    "textarea",
    "json",
    "boolean",
    "select",
    "multiSelect",
    "file",
  ]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  hint: z.string().optional(),
  toggleFirst: z.boolean().optional(),
  docsUrl: z.string().url().optional(),
  icon: z.enum(["dbt"]).optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional(),
  defaultValue: z
    .union([z.string(), z.boolean(), z.array(z.string())])
    .optional(),
  condition: z
    .object({ field: z.string(), equals: z.union([z.string(), z.boolean()]) })
    .optional(),
});
const section = z.object({
  id: z.string(),
  title: z.string().optional(),
  group: z.enum(["Basic", "Advanced", "Access", "Schema browsing"]),
  description: z.string().optional(),
  fields: z.array(field),
  condition: z
    .object({ field: z.string(), equals: z.union([z.string(), z.boolean()]) })
    .optional(),
});
const output = z.object({
  schemas: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      sections: z.array(section),
      supported: z.boolean().optional(),
    }),
  ),
});
export default defineAction({
  description:
    "Read the warehouse connection templates in the original's order, with form fields and defaults for the templates this workspace can create. Returns schema metadata only.",
  schema: z.object({}),
  outputSchema: output,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const ctx = connectionContext();
    const groups = ctx.orgId ? await listWorkspaceUserGroups() : [];
    return output.parse({
      schemas: WAREHOUSE_TEMPLATES.map((template) => {
        if (template.type === "postgres" && ctx.orgId)
          return {
            ...postgresConnectionSchema,
            name: template.name,
            supported: true,
          };
        const formOnly = FORM_ONLY_SCHEMAS.find(
          (schema) => schema.type === template.type,
        );
        if (formOnly)
          return { ...formOnly, name: template.name, supported: false };
        if (!SUPPORTED_TEMPLATE_TYPES.includes(template.type))
          return {
            type: template.type,
            name: template.name,
            sections: [],
            supported: false,
          };
        return {
          ...createBigQuerySchema({
            accessOptions: ctx.orgId
              ? [
                  { value: "workspace", label: "All workspace members" },
                  ...groups.map((group) => ({
                    value: group.id,
                    label: group.name,
                  })),
                ]
              : [],
            defaultQueryAccess: ctx.orgId ? ["workspace"] : [],
            defaultViewAccess: ctx.orgId ? ["workspace"] : [],
          }),
          // The grid tile carries the template's display name from the
          // original; the form's own copy uses the short provider name.
          name: template.name,
          supported: true,
        };
      }),
    });
  },
});
