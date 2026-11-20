import { inArray } from "drizzle-orm";

import type { Access } from "../../actions/_access.js";
import { materializeQuestions } from "../../actions/_form-store.js";
import type { getDb } from "../../server/db/index.js";
import { schema } from "../../server/db/index.js";
import {
  createBlock,
  mentionToken,
  questionBlocks,
  type Block,
} from "../../shared/form-model/index.js";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const WORKSPACE = "fixture-ws-calc";
const HIDDEN_IDS = ["fixture-hidden", "fixture-hidden-retry"];
const CALC_IDS = ["fixture-calc", "fixture-calc-lost"];

const thankYou = (text: string): Block[] => [
  createBlock("THANK_YOU_PAGE", {}, { uuid: "calc-thank-you" }),
  createBlock("TEXT", { text }, { uuid: "calc-thank-you-text" }),
];

function hiddenSurvey(): Block[] {
  return [
    createBlock(
      "FORM_TITLE",
      { text: "Hidden survey" },
      { uuid: "form-title" },
    ),
    createBlock(
      "HIDDEN_FIELDS",
      { fields: [{ id: "hidden-ref", name: "ref" }] },
      { uuid: "hidden-fields" },
    ),
    ...questionBlocks({
      id: "q-name",
      type: "INPUT_TEXT",
      title: "Your name",
      isRequired: true,
    }),
    ...thankYou(
      `Source: ${mentionToken({ kind: "answer", questionId: "hidden-ref" })}`,
    ),
  ];
}

function calcQuiz(): Block[] {
  const fruit = questionBlocks({
    id: "q-fruit",
    type: "MULTIPLE_CHOICE",
    title: "Pick a fruit",
    isRequired: true,
    options: ["Apple", "Banana"],
  });
  const whenFruit = (optionIndex: number, value: number) =>
    createBlock("CONDITIONAL_LOGIC", {
      condition: {
        type: "single",
        questionId: "q-fruit",
        comparison: "is",
        value: fruit[optionIndex + 1]?.uuid ?? "",
      },
      actions: [
        { type: "calculate", fieldId: "calc-score", operator: "add", value },
      ],
    });
  return [
    createBlock("FORM_TITLE", { text: "Quiz" }, { uuid: "form-title" }),
    createBlock(
      "CALCULATED_FIELDS",
      {
        fields: [
          {
            id: "calc-score",
            name: "score",
            type: "number",
            initialValue: "0",
          },
        ],
      },
      { uuid: "calculated-fields" },
    ),
    ...fruit,
    whenFruit(0, 10),
    whenFruit(1, 5),
    ...thankYou(
      `Your score: ${mentionToken({ kind: "answer", questionId: "calc-score" })}`,
    ),
  ];
}

/** Hidden-field and calculated-field forms, each with a copy for the recovery cases. */
export async function seedCalc(tx: Tx, access: Access) {
  const now = new Date().toISOString();
  await tx
    .delete(schema.forms)
    .where(inArray(schema.forms.id, [...HIDDEN_IDS, ...CALC_IDS]));
  await tx
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: "Calc",
      position: 21,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const forms = [
    ...HIDDEN_IDS.map((id) => ({
      id,
      name: "Hidden survey",
      blocks: hiddenSurvey(),
    })),
    ...CALC_IDS.map((id) => ({ id, name: "Quiz", blocks: calcQuiz() })),
  ];
  for (const [position, form] of forms.entries()) {
    await tx.insert(schema.forms).values({
      id: form.id,
      orgId: access.orgId,
      workspaceId: WORKSPACE,
      name: form.name,
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
