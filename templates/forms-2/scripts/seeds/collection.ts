import { inArray } from "drizzle-orm";

import type { Access } from "../../actions/_access.js";
import { hashPassword } from "../../actions/_collection.js";
import { materializeQuestions } from "../../actions/_form-store.js";
import { getDb, schema } from "../../server/db/index.js";
import type { FormSettings } from "../../shared/form-contract.js";
import {
  createBlock,
  formTitleOf,
  questionBlocks,
  type Block,
} from "../../shared/form-model/index.js";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const WORKSPACE = "fixture-ws-collection";

const title = (text: string) =>
  createBlock("FORM_TITLE", { text }, { uuid: "form-title" });

const twoPages = (name: string): Block[] => [
  title(name),
  ...questionBlocks({ id: "q-name", type: "INPUT_TEXT", title: "Your name" }),
  createBlock("PAGE_BREAK", {}, { uuid: "page-break-2" }),
  ...questionBlocks({ id: "q-comments", type: "TEXTAREA", title: "Comments" }),
];

const colourForm = (name: string): Block[] => [
  title(name),
  ...questionBlocks({ id: "q-name", type: "INPUT_TEXT", title: "Your name" }),
  ...questionBlocks({
    id: "q-colour",
    type: "MULTIPLE_CHOICE",
    title: "Favourite colour",
    options: ["Red", "Green", "Blue"],
  }),
];

const nameForm = (name: string): Block[] => [
  title(name),
  ...questionBlocks({ id: "q-name", type: "INPUT_TEXT", title: "Your name" }),
];

const emailForm = (name: string): Block[] => [
  title(name),
  ...questionBlocks({ id: "q-email", type: "INPUT_EMAIL", title: "Email" }),
];

const uniqueByEmail: FormSettings = {
  preventDuplicates: true,
  uniqueSubmissionKey: "field:q-email",
};

/** Forms for partial saves, save-for-later, the password gate, duplicate refusal and retention. */
export async function seedCollection(tx: Tx, access: Access) {
  const now = new Date().toISOString();
  const seeds: {
    id: string;
    blocks: Block[];
    settings?: FormSettings;
    passwordHash?: string;
  }[] = [
    {
      id: "fixture-partial",
      blocks: twoPages("Partial survey"),
      settings: { partialSubmissions: true },
    },
    { id: "fixture-nopartial", blocks: twoPages("No partial survey") },
    {
      id: "fixture-partial-hold",
      blocks: twoPages("Partial hold survey"),
      settings: { partialSubmissions: true },
    },
    {
      id: "fixture-partial-fail",
      blocks: twoPages("Partial fail survey"),
      settings: { partialSubmissions: true },
    },
    {
      id: "fixture-savelater",
      blocks: colourForm("Save for later survey"),
      settings: { saveAnswersForLater: true },
    },
    {
      id: "fixture-nosave",
      blocks: colourForm("No save survey"),
      settings: { saveAnswersForLater: false },
    },
    {
      id: "fixture-password",
      blocks: nameForm("Protected survey"),
      settings: { passwordProtected: true },
      passwordHash: await hashPassword("open-sesame"),
    },
    {
      id: "fixture-unique",
      blocks: emailForm("Unique survey"),
      settings: uniqueByEmail,
    },
    {
      id: "fixture-unique-lost",
      blocks: emailForm("Unique lost survey"),
      settings: uniqueByEmail,
    },
    {
      id: "fixture-unique-ip",
      blocks: emailForm("Unique by address survey"),
      settings: { preventDuplicates: true, uniqueSubmissionKey: "ip" },
    },
    { id: "fixture-settings", blocks: nameForm("Settings survey") },
    { id: "fixture-settings-retry", blocks: nameForm("Settings retry survey") },
  ];
  await tx.delete(schema.forms).where(
    inArray(
      schema.forms.id,
      seeds.map((seed) => seed.id),
    ),
  );
  await tx
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: "Collection",
      position: 3,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  for (const [position, seed] of seeds.entries()) {
    await tx.insert(schema.forms).values({
      id: seed.id,
      orgId: access.orgId,
      workspaceId: WORKSPACE,
      name: formTitleOf(seed.blocks),
      status: "published",
      publishedBlocks: seed.blocks,
      settings: seed.settings ?? {},
      passwordHash: seed.passwordHash ?? null,
      position,
      publishedAt: now,
      revisionUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await materializeQuestions(tx, access.orgId, seed.id, seed.blocks);
  }
}
