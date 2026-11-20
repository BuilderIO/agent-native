import { inArray } from "drizzle-orm";

import type { Access } from "../../actions/_access.js";
import { materializeQuestions } from "../../actions/_form-store.js";
import { getDb, schema } from "../../server/db/index.js";
import {
  createBlock,
  formTitleOf,
  questionBlocks,
  type Block,
} from "../../shared/form-model/index.js";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const WORKSPACE = "fixture-ws-notify";

const emailForm = (title: string, verify: boolean): Block[] => [
  createBlock("FORM_TITLE", { text: title }, { uuid: "form-title" }),
  ...questionBlocks({
    id: "q-email",
    type: "INPUT_EMAIL",
    title: "Email",
    isRequired: true,
    ...(verify ? { settings: { requireVerification: true } } : {}),
  }),
];

/** Notification and email-verification fixtures. */
export async function seedNotify(tx: Tx, access: Access) {
  const now = new Date().toISOString();
  const forms = [
    { id: "fixture-notify", blocks: emailForm("Notify demo", false) },
    { id: "fixture-verify", blocks: emailForm("Verify demo form", true) },
    { id: "fixture-noverify", blocks: emailForm("No verify demo", false) },
  ];
  await tx.delete(schema.forms).where(
    inArray(
      schema.forms.id,
      forms.map((form) => form.id),
    ),
  );
  await tx
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: "Notifications",
      position: 8,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  for (const [position, form] of forms.entries()) {
    await tx.insert(schema.forms).values({
      id: form.id,
      orgId: access.orgId,
      workspaceId: WORKSPACE,
      name: formTitleOf(form.blocks),
      status: "published",
      publishedBlocks: form.blocks,
      draftBlocks: null,
      position,
      publishedAt: now,
      revisionUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await materializeQuestions(tx, access.orgId, form.id, form.blocks);
  }
}
