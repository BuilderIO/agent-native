import { eq, inArray } from "drizzle-orm";

import {
  ensureDefaultWorkspace,
  workspaceScope,
  type Access,
} from "../actions/_access.js";
import { materializeQuestions, questionRowId } from "../actions/_form-store.js";
import { getDb, schema } from "../server/db/index.js";
import {
  EVENT_FEEDBACK_QUESTION_IDS as Q,
  draftSurveyBlocks,
  eventFeedbackBlocks,
  pagesSurveyBlocks,
  simpleFormBlocks,
  singlePageBlocks,
} from "../shared/form-model/fixtures.js";
import {
  createBlock,
  formTitleOf,
  questionBlocks,
  type Block,
  type ChoiceAnswer,
} from "../shared/form-model/index.js";
import { seedBlocks } from "./seeds/blocks.js";
import { seedCalc } from "./seeds/calc.js";
import { seedCollection } from "./seeds/collection.js";
import { seedNotify } from "./seeds/notify.js";
import { seedOrganize } from "./seeds/organize.js";
import { seedShare } from "./seeds/share.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

type FormSeed = {
  id: string;
  workspaceId: string;
  blocks: Block[];
  published: boolean;
  isClosed?: boolean;
  title?: string;
};

async function insertForm(
  tx: Tx,
  orgId: string | null,
  seed: FormSeed,
  position: number,
) {
  const now = hoursAgo(1 + position);
  const title = seed.title ?? formTitleOf(seed.blocks);
  const blocks = seed.title
    ? seed.blocks.map((block) =>
        block.type === "FORM_TITLE"
          ? createBlock("FORM_TITLE", { text: title }, { uuid: block.uuid })
          : block,
      )
    : seed.blocks;
  await tx.insert(schema.forms).values({
    id: seed.id,
    orgId,
    workspaceId: seed.workspaceId,
    name: title,
    status: seed.published ? "published" : "draft",
    publishedBlocks: seed.published ? blocks : [],
    draftBlocks: seed.published ? null : blocks,
    isClosed: seed.isClosed ?? false,
    position,
    publishedAt: seed.published ? now : null,
    revisionUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (seed.published) await materializeQuestions(tx, orgId, seed.id, blocks);
}

async function wipeScope(tx: Tx, access: Access) {
  const { workspaces } = schema;
  await tx
    .delete(workspaces)
    .where(workspaceScope(access.orgId, access.userEmail));
}

async function seedEventFeedback(
  tx: Tx,
  orgId: string | null,
  workspaceId: string,
) {
  const id = "fixture-event-feedback";
  await insertForm(
    tx,
    orgId,
    {
      id,
      workspaceId,
      blocks: eventFeedbackBlocks({ withSnack: true }),
      published: true,
    },
    0,
  );
  await tx
    .update(schema.forms)
    .set({
      publishedBlocks: eventFeedbackBlocks({ withSnack: false }),
    })
    .where(eq(schema.forms.id, id));
  await materializeQuestions(
    tx,
    orgId,
    id,
    eventFeedbackBlocks({ withSnack: false }),
  );

  const submit = async (
    n: number,
    completed: boolean,
    hours: number,
    answers: Record<string, string | number | ChoiceAnswer>,
  ) => {
    const submissionId = `${id}-submission-${n}`;
    await tx.insert(schema.submissions).values({
      id: submissionId,
      orgId,
      formId: id,
      sessionId: `${id}-session-${n}`,
      respondentId: `respondent-${n}@example.test`,
      isCompleted: completed,
      submittedAt: hoursAgo(hours),
    });
    for (const [group, answer] of Object.entries(answers))
      await tx.insert(schema.responses).values({
        id: `${submissionId}-${group}`,
        orgId,
        submissionId,
        questionId: questionRowId(id, group),
        answer,
      });
  };
  await submit(1, true, 5, {
    [Q.rating]: 5,
    [Q.comments]: "Loved the talks.",
    [Q.snack]: "Pretzels",
  });
  await submit(2, true, 4, {
    [Q.rating]: 3,
    [Q.comments]: "Good, but the room was cold.",
    [Q.snack]: "Fruit",
  });
  await submit(3, false, 3, { [Q.snack]: "Cookies" });

  const events: { session: string; type: string; hours: number }[] = [];
  for (let n = 1; n <= 6; n++) {
    events.push({
      session: `${id}-session-${n}`,
      type: "visit",
      hours: 6 - n * 0.5,
    });
    if (n <= 3)
      events.push({
        session: `${id}-session-${n}`,
        type: "start",
        hours: 5.9 - n * 0.5,
      });
    if (n <= 2)
      events.push({
        session: `${id}-session-${n}`,
        type: "page_view",
        hours: 5.5 - n * 0.5,
      });
  }
  let index = 0;
  for (const event of events)
    await tx.insert(schema.formEvents).values({
      id: `${id}-event-${index++}`,
      orgId,
      formId: id,
      sessionId: event.session,
      type: event.type,
      at: hoursAgo(event.hours),
    });
}

async function seedParity(tx: Tx, orgId: string | null, workspaceId: string) {
  const required = { isRequired: true };
  const form1 = [
    createBlock(
      "FORM_TITLE",
      { text: "Quarterly visit notes" },
      { uuid: "form-title" },
    ),
    ...questionBlocks({
      id: "parity-date",
      type: "INPUT_DATE",
      title: "Visit date",
      ...required,
    }),
    ...questionBlocks({
      id: "parity-name",
      type: "INPUT_TEXT",
      title: "Contact name",
      placeholder: "e.g. Jordan Lee",
      ...required,
    }),
    ...questionBlocks({
      id: "parity-rating",
      type: "RATING",
      title: "Overall rating",
      ...required,
    }),
    ...questionBlocks({
      id: "parity-notes",
      type: "TEXTAREA",
      title: "Anything else to add?",
      placeholder: "Tell us how the visit went",
      ...required,
    }),
  ];
  const form2 = [
    createBlock(
      "FORM_TITLE",
      { text: "Workshop pulse check" },
      { uuid: "form-title" },
    ),
    ...questionBlocks({
      id: "pulse-scale",
      type: "LINEAR_SCALE",
      title: "How useful was it?",
      ...required,
    }),
    ...questionBlocks({
      id: "pulse-a",
      type: "TEXTAREA",
      title: "What worked well?",
      ...required,
    }),
    ...questionBlocks({
      id: "pulse-b",
      type: "TEXTAREA",
      title: "What should change?",
      ...required,
    }),
    ...questionBlocks({
      id: "pulse-c",
      type: "TEXTAREA",
      title: "Other thoughts?",
      ...required,
    }),
  ];
  const form3 = [
    createBlock(
      "FORM_TITLE",
      { text: "Supplier onboarding" },
      { uuid: "form-title" },
    ),
    ...questionBlocks({
      id: "supplier-kind",
      type: "MULTIPLE_CHOICE",
      title: "Type of supplier",
      options: ["Goods", "Services", "Software"],
    }),
    ...questionBlocks({
      id: "supplier-name",
      type: "INPUT_TEXT",
      title: "Company name",
    }),
  ];
  await insertForm(
    tx,
    orgId,
    { id: "parity-visit-notes", workspaceId, blocks: form1, published: true },
    0,
  );
  await insertForm(
    tx,
    orgId,
    { id: "parity-pulse-check", workspaceId, blocks: form2, published: true },
    1,
  );
  await insertForm(
    tx,
    orgId,
    { id: "parity-supplier", workspaceId, blocks: form3, published: false },
    2,
  );
  const id = "parity-visit-notes";
  const submissionId = `${id}-submission-1`;
  await tx.insert(schema.submissions).values({
    id: submissionId,
    orgId,
    formId: id,
    sessionId: `${id}-session-1`,
    respondentId: "respondent-1@example.test",
    isCompleted: true,
    submittedAt: hoursAgo(5),
  });
  const answers = {
    "parity-date": "2026-10-01",
    "parity-name": "Jordan Lee",
    "parity-rating": 4,
    "parity-notes": "Everything went smoothly.",
  };
  for (const [group, answer] of Object.entries(answers))
    await tx.insert(schema.responses).values({
      id: `${submissionId}-${group}`,
      orgId,
      submissionId,
      questionId: questionRowId(id, group),
      answer,
    });
}

export type SeedResult = { scope: string; fresh: boolean; formIds: string[] };

export async function seedForms(
  access: Access,
  options: { fresh: boolean; parity?: boolean },
): Promise<SeedResult> {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "seed-forms is a development fixture and refuses to run in production.",
    );
  const db = getDb();
  const scope = access.orgId
    ? `org ${access.orgId}`
    : `user ${access.userEmail}`;
  const formIds: string[] = [];

  await db.transaction(async (tx) => {
    await wipeScope(tx, access);
  });
  if (options.fresh) {
    await ensureDefaultWorkspace(access);
    return { scope, fresh: true, formIds };
  }

  const key = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope),
  );
  const suffix = [...new Uint8Array(key)]
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (options.parity) {
    const workspaceId = `ws-parity-${suffix}`;
    const parityIds = [
      "parity-visit-notes",
      "parity-pulse-check",
      "parity-supplier",
    ];
    const created = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.delete(schema.forms).where(inArray(schema.forms.id, parityIds));
      await tx.insert(schema.workspaces).values({
        id: workspaceId,
        orgId: access.orgId,
        createdBy: access.userEmail,
        name: "Studio",
        position: 0,
        createdAt: created,
        updatedAt: created,
      });
      await seedParity(tx, access.orgId, workspaceId);
    });
    return { scope, fresh: false, formIds: parityIds };
  }
  const studio = `ws-studio-${suffix}`;
  const ops = `ws-ops-${suffix}`;
  const fixedIds = [
    "fixture-event-feedback",
    "fixture-team-lunch",
    "fixture-customer-pulse",
    "fixture-draft",
    "fixture-recover",
    "fixture-recover2",
    "fixture-pages",
    "fixture-single",
    "fixture-closed",
    "fixture-unpublished",
    "fixture-vendor-intake",
  ];
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(schema.forms).where(inArray(schema.forms.id, fixedIds));
    for (const [id, name, position] of [
      [studio, "Studio", 0],
      [ops, "Ops", 1],
    ] as const)
      await tx
        .insert(schema.workspaces)
        .values({
          id,
          orgId: access.orgId,
          createdBy: access.userEmail,
          name,
          position,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();

    await seedEventFeedback(tx, access.orgId, studio);
    const lunch = [
      createBlock(
        "FORM_TITLE",
        { text: "Team lunch poll" },
        { uuid: "form-title" },
      ),
      ...questionBlocks({
        id: "lunch-day",
        type: "MULTIPLE_CHOICE",
        title: "Which day works best?",
        options: ["Tuesday", "Thursday"],
      }),
    ];
    const seeds: FormSeed[] = [
      {
        id: "fixture-team-lunch",
        workspaceId: studio,
        blocks: lunch,
        published: false,
      },
      {
        id: "fixture-customer-pulse",
        workspaceId: studio,
        blocks: simpleFormBlocks("Customer pulse"),
        published: true,
      },
      {
        id: "fixture-draft",
        workspaceId: studio,
        blocks: draftSurveyBlocks(),
        published: false,
      },
      {
        id: "fixture-recover",
        workspaceId: studio,
        blocks: draftSurveyBlocks(),
        published: false,
      },
      {
        id: "fixture-recover2",
        workspaceId: studio,
        blocks: draftSurveyBlocks(),
        published: false,
      },
      {
        id: "fixture-pages",
        workspaceId: studio,
        blocks: pagesSurveyBlocks(),
        published: true,
      },
      {
        id: "fixture-single",
        workspaceId: studio,
        blocks: singlePageBlocks(),
        published: true,
      },
      {
        id: "fixture-closed",
        workspaceId: studio,
        blocks: singlePageBlocks(),
        published: true,
        isClosed: true,
        title: "Closed survey",
      },
      {
        id: "fixture-unpublished",
        workspaceId: studio,
        blocks: draftSurveyBlocks(),
        published: false,
        title: "Unpublished survey",
      },
      {
        id: "fixture-vendor-intake",
        workspaceId: ops,
        blocks: simpleFormBlocks("Vendor intake"),
        published: true,
      },
    ];
    let position = 1;
    for (const seed of seeds)
      await insertForm(tx, access.orgId, seed, position++);
    await seedOrganize(tx, access);
    await seedCollection(tx, access);
    await seedShare(tx, access);
    await seedBlocks(tx, access);
    await seedCalc(tx, access);
    await seedNotify(tx, access);
  });
  formIds.push(...fixedIds);
  return { scope, fresh: false, formIds };
}
