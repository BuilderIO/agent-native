import { inArray } from "drizzle-orm";

import type { Access } from "../../actions/_access.js";
import { materializeQuestions } from "../../actions/_form-store.js";
import type { getDb } from "../../server/db/index.js";
import { schema } from "../../server/db/index.js";
import {
  createBlock,
  questionBlocks,
  type Block,
} from "../../shared/form-model/index.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const WORKSPACE = "fixture-ws-blocks";
const BLOCKS_FORM_IDS = [
  "fixture-blocks",
  "fixture-blocks-retry",
  "fixture-blocks-lost",
];

function blocksSurvey(): Block[] {
  return [
    createBlock(
      "FORM_TITLE",
      { text: "Blocks survey" },
      { uuid: "form-title" },
    ),
    ...questionBlocks({
      id: "blocks-rank",
      type: "RANKING",
      title: "Rank the fruits",
      isRequired: true,
      options: ["Apple", "Banana", "Cherry"],
    }),
    ...questionBlocks({
      id: "blocks-matrix",
      type: "MATRIX",
      title: "Rate the service",
      isRequired: true,
      rows: ["Speed", "Quality"],
      columns: ["Poor", "Good", "Great"],
    }),
    ...questionBlocks({
      id: "blocks-file",
      type: "FILE_UPLOAD",
      title: "Attach a file",
    }),
    ...questionBlocks({
      id: "blocks-signature",
      type: "SIGNATURE",
      title: "Sign here",
    }),
    createBlock(
      "IMAGE",
      { url: "/fixture-image.png" },
      { uuid: "blocks-image" },
    ),
    createBlock(
      "EMBED_VIDEO",
      { url: "https://vimeo.com/76979871" },
      { uuid: "blocks-video" },
    ),
  ];
}

/** Published forms with every rich block, and two copies for the recovery cases. */
export async function seedBlocks(tx: Tx, access: Access) {
  const now = new Date().toISOString();
  await tx
    .delete(schema.forms)
    .where(inArray(schema.forms.id, BLOCKS_FORM_IDS));
  await tx
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: "Blocks",
      position: 20,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  let position = 0;
  for (const id of BLOCKS_FORM_IDS) {
    const blocks = blocksSurvey();
    await tx.insert(schema.forms).values({
      id,
      orgId: access.orgId,
      workspaceId: WORKSPACE,
      name: "Blocks survey",
      status: "published",
      publishedBlocks: blocks,
      draftBlocks: null,
      position: position++,
      publishedAt: now,
      revisionUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await materializeQuestions(tx, access.orgId, id, blocks);
  }
}
