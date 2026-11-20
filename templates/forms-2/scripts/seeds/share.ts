import { eq, inArray, isNull } from "drizzle-orm";

import type { Access } from "../../actions/_access.js";
import {
  materializeQuestions,
  questionRowId,
} from "../../actions/_form-store.js";
import { getDb, schema } from "../../server/db/index.js";
import {
  createBlock,
  formTitleOf,
  questionBlocks,
  type Block,
} from "../../shared/form-model/index.js";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const WORKSPACE = "fixture-ws-share";
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

const survey = (name: string): Block[] => [
  createBlock("FORM_TITLE", { text: name }, { uuid: "form-title" }),
  ...questionBlocks({ id: "q-name", type: "INPUT_TEXT", title: "Your name" }),
  ...questionBlocks({
    id: "q-comments",
    type: "TEXTAREA",
    title: "Comments",
  }),
];

const shareBlocks = (name: string): Block[] => survey(name).slice(0, 3);

// Seven visits from four respondents, four starts, three completed
// submissions and one partial, all inside the last 24 hours.
const VISITS = [
  { n: 1, respondent: "r1" },
  { n: 2, respondent: "r1" },
  { n: 3, respondent: "r2" },
  { n: 4, respondent: "r2" },
  { n: 5, respondent: "r3" },
  { n: 6, respondent: "r4" },
  { n: 7, respondent: "r4" },
];
const STARTED = [1, 3, 5, 6];
const COMPLETED = [1, 3, 5];

/** Share, embed and Insights fixtures. */
export async function seedShare(tx: Tx, access: Access) {
  const now = new Date().toISOString();
  const ids = [
    "fixture-share",
    "fixture-draft-share",
    "fixture-insights",
    "fixture-insights-empty",
  ];
  await tx.delete(schema.forms).where(inArray(schema.forms.id, ids));
  await tx
    .delete(schema.domains)
    .where(
      access.orgId
        ? eq(schema.domains.orgId, access.orgId)
        : isNull(schema.domains.orgId),
    );
  await tx
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name: "Sharing",
      position: 5,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const forms: { id: string; blocks: Block[]; published: boolean }[] = [
    {
      id: "fixture-share",
      blocks: shareBlocks("Share survey"),
      published: true,
    },
    {
      id: "fixture-draft-share",
      blocks: shareBlocks("Draft share survey"),
      published: false,
    },
    {
      id: "fixture-insights",
      blocks: survey("Insights survey"),
      published: true,
    },
    {
      id: "fixture-insights-empty",
      blocks: survey("Empty insights survey"),
      published: true,
    },
  ];
  for (const [position, form] of forms.entries()) {
    await tx.insert(schema.forms).values({
      id: form.id,
      orgId: access.orgId,
      workspaceId: WORKSPACE,
      name: formTitleOf(form.blocks),
      status: form.published ? "published" : "draft",
      publishedBlocks: form.published ? form.blocks : [],
      draftBlocks: form.published ? null : form.blocks,
      position,
      publishedAt: form.published ? now : null,
      revisionUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (form.published)
      await materializeQuestions(tx, access.orgId, form.id, form.blocks);
  }

  const id = "fixture-insights";
  const session = (n: number) => `${id}-session-${n}`;
  let event = 0;
  const record = (
    n: number,
    type: string,
    hours: number,
    data: Record<string, unknown> | null = null,
  ) =>
    tx.insert(schema.formEvents).values({
      id: `${id}-event-${event++}`,
      orgId: access.orgId,
      formId: id,
      sessionId: session(n),
      type,
      data,
      at: hoursAgo(hours),
    });
  for (const { n, respondent } of VISITS) {
    const at = 20 - n;
    await record(n, "visit", at, { respondentId: `${id}-${respondent}` });
    if (STARTED.includes(n)) {
      await record(n, "start", at - 0.01);
      await record(n, "question_answer", at - 0.02, { questionId: "q-name" });
    }
    if (n === 1 || n === 3)
      await record(n, "question_answer", at - 0.03, {
        questionId: "q-comments",
      });
  }

  for (const n of STARTED) {
    const completed = COMPLETED.includes(n);
    const submissionId = `${id}-submission-${n}`;
    const respondent = VISITS[n - 1]?.respondent ?? "r1";
    await tx.insert(schema.submissions).values({
      id: submissionId,
      orgId: access.orgId,
      formId: id,
      sessionId: session(n),
      respondentId: `${id}-${respondent}`,
      isCompleted: completed,
      submittedAt: hoursAgo(20 - n - 0.03),
    });
    await tx.insert(schema.responses).values({
      id: `${submissionId}-q-name`,
      orgId: access.orgId,
      submissionId,
      questionId: questionRowId(id, "q-name"),
      answer: `Respondent ${n}`,
    });
  }
}
