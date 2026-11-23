import { z } from "zod";

export const QA_KEYSCREEN_EMAIL = "qa-fleet@builder.io";

export const QA_KEYSCREEN_PROJECT_TITLES = [
  "QA Keyscreen 1118",
  "[Demo] Sales Revenue Dashboard",
  "[Demo] Opportunity Conversion Regression Analysis",
] as const;

export const endorsedItemSchema = z
  .object({
    id: z.string().min(1),
    group: z.enum(["view", "model", "table", "schema"]),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    status: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .optional(),
    stat: z
      .object({ value: z.number().int().nonnegative(), label: z.string() })
      .nullable()
      .optional(),
  })
  .strict();
export type EndorsedItem = z.infer<typeof endorsedItemSchema>;

export const endorsedListSchema = z
  .object({ items: z.array(endorsedItemSchema).max(500) })
  .strict();

const ENDORSED = { id: "endorsed", name: "Endorsed" };

export const QA_KEYSCREEN_ENDORSED: EndorsedItem[] = [
  {
    id: "model:accounts",
    group: "model",
    name: "Accounts",
    description: "Account-level firmographic and owner data",
    status: ENDORSED,
    stat: { value: 13, label: "Dimensions" },
  },
  {
    id: "model:campaign-members",
    group: "model",
    name: "Campaign members",
    description: "Marketing campaign impressions and MQL events",
    status: ENDORSED,
    stat: { value: 15, label: "Dimensions" },
  },
  {
    id: "model:customers",
    group: "model",
    name: "Customers",
    description: "Customer ARR and milestone dates",
    status: ENDORSED,
    stat: { value: 11, label: "Dimensions" },
  },
  {
    id: "model:opportunities",
    group: "model",
    name: "Opportunities",
    description: "Sales opportunities from Salesforce",
    status: ENDORSED,
    stat: { value: 21, label: "Dimensions" },
  },
  {
    id: "table:B2B_SEMANTIC_VIEW",
    group: "table",
    name: "B2B_SEMANTIC_VIEW",
    description:
      "Includes metrics from across the customer lifecycle — from initial marketing touches to pipeline development to customer expansion and retention.",
    status: ENDORSED,
    stat: { value: 0, label: "Columns" },
  },
  {
    id: "table:DIM_ACCOUNTS",
    group: "table",
    name: "DIM_ACCOUNTS",
    status: ENDORSED,
    stat: { value: 13, label: "Columns" },
  },
  {
    id: "table:DIM_CAMPAIGN_MEMBERS",
    group: "table",
    name: "DIM_CAMPAIGN_MEMBERS",
    status: ENDORSED,
    stat: { value: 16, label: "Columns" },
  },
  {
    id: "table:DIM_CUSTOMERS",
    group: "table",
    name: "DIM_CUSTOMERS",
    status: ENDORSED,
    stat: { value: 11, label: "Columns" },
  },
  {
    id: "table:DIM_OPPORTUNITIES",
    group: "table",
    name: "DIM_OPPORTUNITIES",
    status: ENDORSED,
    stat: { value: 26, label: "Columns" },
  },
  {
    id: "schema:PROD",
    group: "schema",
    name: "PROD",
    status: ENDORSED,
    stat: { value: 5, label: "Tables" },
  },
];

type InventoryProject = { id: string; title: string };

export function planKeyscreenInventory(projects: readonly InventoryProject[]): {
  create: string[];
  archive: string[];
} {
  const wanted = new Set<string>(QA_KEYSCREEN_PROJECT_TITLES);
  const kept = new Set<string>();
  const archive: string[] = [];
  for (const project of projects) {
    if (wanted.has(project.title) && !kept.has(project.title))
      kept.add(project.title);
    else archive.push(project.id);
  }
  return {
    create: QA_KEYSCREEN_PROJECT_TITLES.filter((title) => !kept.has(title)),
    archive,
  };
}
