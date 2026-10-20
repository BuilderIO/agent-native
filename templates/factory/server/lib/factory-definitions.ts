import { desc, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { factoryDefinitions } from "../db/schema.js";
import { DEFAULT_FACTORY_ID } from "./factory-ids.js";

export async function listFactoryDefinitions(orgId: string) {
  return getDb()
    .select({
      id: factoryDefinitions.id,
      name: factoryDefinitions.name,
      description: factoryDefinitions.description,
      prompt: factoryDefinitions.prompt,
      updatedAt: factoryDefinitions.updatedAt,
    })
    .from(factoryDefinitions)
    .where(eq(factoryDefinitions.orgId, orgId))
    .orderBy(desc(factoryDefinitions.updatedAt));
}

export async function readFactoryDefinition(orgId: string, factoryId: string) {
  return (
    await getDb()
      .select()
      .from(factoryDefinitions)
      .where(eq(factoryDefinitions.id, factoryId))
      .limit(1)
  ).find((row) => row.orgId === orgId);
}

export function defaultFactoryDefinition() {
  return {
    id: DEFAULT_FACTORY_ID,
    name: "Product feedback to shipped change",
    description:
      "Observe product signals, classify them safely, and keep a human in the loop before work starts.",
    prompt:
      "Observe product feedback and pull-request evidence, classify it in shadow mode, and keep a person in the loop before coding work starts.",
    virtual: true,
  } as const;
}
