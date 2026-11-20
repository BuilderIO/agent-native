import { inArray } from "drizzle-orm";

import type { Access } from "../../actions/_access.js";
import { materializeQuestions } from "../../actions/_form-store.js";
import { getDb, schema } from "../../server/db/index.js";
import { createBlock, questionBlocks } from "../../shared/form-model/index.js";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const LAB_WORKSPACE = "fixture-ws-lab";
const LAB_FORMS = ["a", "b", "c", "d"] as const;

const textForm = (title: string, question: string, isRequired: boolean) => [
  createBlock("FORM_TITLE", { text: title }, { uuid: "form-title" }),
  ...questionBlocks({
    id: "q-text",
    type: "INPUT_TEXT",
    title: question,
    isRequired,
  }),
];

/** The Lab workspace: four published forms in a fixed order plus a draft with no versions. */
export async function seedOrganize(tx: Tx, access: Access) {
  const now = new Date().toISOString();
  const ids = [
    ...LAB_FORMS.map((key) => `fixture-lab-${key}`),
    "fixture-history",
  ];
  await tx.delete(schema.forms).where(inArray(schema.forms.id, ids));
  await tx
    .insert(schema.workspaces)
    .values({
      id: LAB_WORKSPACE,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: "Lab",
      position: 2,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const common = {
    orgId: access.orgId,
    workspaceId: LAB_WORKSPACE,
    revisionUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  for (const [position, key] of LAB_FORMS.entries()) {
    const id = `fixture-lab-${key}`;
    const title = `Lab form ${key.toUpperCase()}`;
    const blocks = textForm(title, "Your answer", false);
    await tx.insert(schema.forms).values({
      ...common,
      id,
      name: title,
      status: "published",
      publishedBlocks: blocks,
      publishedAt: now,
      position,
    });
    await materializeQuestions(tx, access.orgId, id, blocks);
  }
  await tx.insert(schema.forms).values({
    ...common,
    id: "fixture-history",
    name: "History A",
    status: "draft",
    draftBlocks: textForm("History A", "Your name", true),
    position: LAB_FORMS.length,
  });
}
