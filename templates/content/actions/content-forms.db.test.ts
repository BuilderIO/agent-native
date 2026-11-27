import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ContentFormAnswerEntry } from "../shared/content-forms.js";
import { formQuestionBlockRaw } from "../shared/form-question-block.js";
import { serializePropertyOptions } from "../shared/properties.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-forms-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "forms-owner@example.com";
const EDITOR = "forms-editor@example.com";
const VIEWER = "forms-viewer@example.com";
const MEMBER = "forms-member@example.com";
const ORG_ID = "forms-org";
const USER_AGENT = "FormsTestBrowser/7.3";

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let configureForm: typeof import("./configure-content-form.js").default;
let getFormSettings: typeof import("./get-content-form-settings.js").default;
let getForm: typeof import("./get-content-form.js").default;
let submitForm: typeof import("./submit-content-form.js").default;
let saveDraft: typeof import("./save-content-form-draft.js").default;
let getDraft: typeof import("./get-content-form-draft.js").default;
let clearDraft: typeof import("./clear-content-form-draft.js").default;
let submitCollectionForm: typeof import("./submit-content-database-form.js").default;
let flood: typeof import("./_content-form-flood.js");
let drafts: typeof import("./_content-form-drafts.js");
let receipts: typeof import("./_content-form-receipts.js");
let files: typeof import("./_content-files.js");
let deleteDocument: typeof import("./delete-document.js");
let spaceId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  configureForm = (await import("./configure-content-form.js")).default;
  getFormSettings = (await import("./get-content-form-settings.js")).default;
  getForm = (await import("./get-content-form.js")).default;
  submitForm = (await import("./submit-content-form.js")).default;
  saveDraft = (await import("./save-content-form-draft.js")).default;
  getDraft = (await import("./get-content-form-draft.js")).default;
  clearDraft = (await import("./clear-content-form-draft.js")).default;
  submitCollectionForm = (await import("./submit-content-database-form.js"))
    .default;
  flood = await import("./_content-form-flood.js");
  drafts = await import("./_content-form-drafts.js");
  receipts = await import("./_content-form-receipts.js");
  files = await import("./_content-files.js");
  deleteDocument = await import("./delete-document.js");
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  const { systemIdsForContentSpace } = await import("./_content-spaces.js");
  spaceId = `forms_space_${Date.now()}`;
  const filesIds = systemIdsForContentSpace(spaceId, "files");
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: filesIds.documentId,
    spaceId,
    ownerEmail: OWNER,
    title: "Files",
    content: "",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabases).values({
    id: filesIds.databaseId,
    spaceId,
    systemRole: "files",
    ownerEmail: OWNER,
    documentId: filesIds.documentId,
    title: "Files",
    createdAt: now,
    updatedAt: now,
  });

  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORG_ID, "Forms Org", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $5)",
    args: [
      "forms-owner-membership",
      ORG_ID,
      OWNER,
      "owner",
      Date.now(),
      "forms-member-membership",
      MEMBER,
      "member",
    ],
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(() => {
  flood.resetContentFormFloodForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Seeded = Awaited<ReturnType<typeof seedCollection>>;

async function seedCollection(options: { orgId?: string } = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 9);
  const ids = {
    databaseId: `forms_db_${suffix}`,
    databaseDocumentId: `forms_db_doc_${suffix}`,
    canvasDocumentId: `forms_canvas_${suffix}`,
    existingRowId: `forms_existing_${suffix}`,
    viewId: "intake",
    descriptionId: `description_${suffix}`,
    priorityId: `priority_${suffix}`,
    emailId: `email_${suffix}`,
    countId: `count_${suffix}`,
    secretId: `secret_${suffix}`,
    relatedId: `related_${suffix}`,
  };
  const orgId = options.orgId ?? null;
  await db.insert(schema.documents).values([
    {
      id: ids.databaseDocumentId,
      spaceId,
      ownerEmail: OWNER,
      orgId,
      title: "Confidential pipeline",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.existingRowId,
      spaceId,
      ownerEmail: OWNER,
      orgId,
      parentId: ids.databaseDocumentId,
      title: "Existing confidential row",
      content: "Quarterly margin is confidential.",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.canvasDocumentId,
      spaceId,
      ownerEmail: OWNER,
      orgId,
      parentId: ids.databaseDocumentId,
      title: "Request a design",
      content: [
        "Tell us what you need and we'll reply within a day.",
        "",
        formQuestionBlockRaw("q-name", { propertyId: "name", required: true }),
        "",
        formQuestionBlockRaw("q-priority", {
          propertyId: ids.priorityId,
          required: true,
          help: "P0 means a customer is blocked",
        }),
        "",
        formQuestionBlockRaw("q-email", {
          propertyId: ids.emailId,
          required: false,
          placeholder: "you@example.com",
        }),
        "",
        formQuestionBlockRaw("q-count", {
          propertyId: ids.countId,
          required: false,
        }),
        "",
        formQuestionBlockRaw("q-description", {
          propertyId: ids.descriptionId,
          required: false,
        }),
      ].join("\n"),
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.documentShares).values({
    id: `forms_share_${suffix}`,
    resourceId: ids.databaseDocumentId,
    principalType: "user",
    principalId: EDITOR,
    role: "editor",
    createdBy: OWNER,
    createdAt: now,
  });
  await db.insert(schema.documentShares).values({
    id: `forms_viewer_share_${suffix}`,
    resourceId: ids.databaseDocumentId,
    principalType: "user",
    principalId: VIEWER,
    role: "viewer",
    createdBy: OWNER,
    createdAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: ids.databaseId,
    spaceId,
    ownerEmail: OWNER,
    orgId,
    documentId: ids.databaseDocumentId,
    title: "Confidential pipeline",
    primaryBlocksPropertyId: ids.descriptionId,
    blocksSeeded: 1,
    viewConfigJson: JSON.stringify({
      activeViewId: "grid",
      views: [
        { id: "grid", name: "Internal grid", type: "table" },
        {
          id: ids.viewId,
          name: "Design intake",
          type: "form",
          formQuestions: [
            { key: "name", enabled: true, required: true },
            { key: ids.priorityId, enabled: true, required: true },
            { key: ids.emailId, enabled: true, required: false },
            { key: ids.secretId, enabled: false, required: false },
          ],
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: `forms_existing_item_${suffix}`,
    ownerEmail: OWNER,
    orgId,
    databaseId: ids.databaseId,
    documentId: ids.existingRowId,
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  const definition = (
    id: string,
    name: string,
    type: string,
    position: number,
    optionsJson?: string,
  ) => ({
    id,
    ownerEmail: OWNER,
    databaseId: ids.databaseId,
    name,
    type,
    position,
    ...(optionsJson ? { optionsJson } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values([
    definition(
      ids.descriptionId,
      "Description",
      "blocks",
      0,
      serializePropertyOptions({ blocks: { primary: true } }),
    ),
    definition(
      ids.priorityId,
      "Priority",
      "select",
      1,
      serializePropertyOptions({
        options: [
          { id: "p0", name: "P0 — Urgent", color: "red" },
          { id: "p1", name: "P1 — High", color: "orange" },
        ],
      }),
    ),
    definition(ids.emailId, "Email", "email", 2),
    definition(ids.countId, "Seats", "number", 3),
    definition(ids.secretId, "Internal margin", "text", 4),
    definition(ids.relatedId, "Related deal", "relation", 5),
  ]);
  await as(OWNER, () =>
    files.ensureDocumentFilesMembership(db, ids.canvasDocumentId),
  );
  return ids;
}

function caller(
  ip: string,
  extra: Partial<ActionRunContext> = {},
): ActionRunContext {
  return {
    caller: "http",
    requestHeaders: new Headers({
      "x-nf-client-connection-ip": ip,
      "user-agent": USER_AGENT,
    }),
    ...extra,
  };
}

function as<T>(userEmail: string | null, run: () => Promise<T>): Promise<T> {
  return Promise.resolve(
    runWithRequestContext(userEmail ? { userEmail } : {}, run),
  );
}

async function setUpForm(
  ids: Seeded,
  settings: Partial<Parameters<typeof configureForm.run>[0]> = {},
) {
  const configured = await as(OWNER, () =>
    configureForm.run({
      databaseId: ids.databaseId,
      viewId: ids.viewId,
      canvasDocumentId: ids.canvasDocumentId,
      ...settings,
    }),
  );
  if (!configured.link) throw new Error("The form has no link.");
  return `https://content.example${configured.link.path}`;
}

function validAnswers(ids: Seeded): ContentFormAnswerEntry[] {
  return [
    { question: "name", value: "New landing page" },
    { question: ids.priorityId, value: "P1 — High" },
    { question: ids.emailId, value: "contact@example.com" },
  ];
}

function send(
  link: string,
  answers: ContentFormAnswerEntry[],
  options: {
    as?: string | null;
    key?: string;
    ip?: string;
    ctx?: Partial<ActionRunContext>;
  } = {},
) {
  return as(options.as ?? null, () =>
    submitForm.run(
      {
        link,
        idempotencyKey: options.key ?? `key-${randomUUID()}`,
        answers,
      },
      caller(options.ip ?? "198.51.100.7", options.ctx),
    ),
  );
}

async function rowsOf(ids: Seeded) {
  return getDb()
    .select({ documentId: schema.contentDatabaseItems.documentId })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, ids.databaseId));
}

async function receiptsOf(ids: Seeded) {
  return getDb()
    .select()
    .from(schema.contentFormSubmissions)
    .where(
      and(
        eq(schema.contentFormSubmissions.databaseId, ids.databaseId),
        eq(schema.contentFormSubmissions.viewId, ids.viewId),
      ),
    );
}

async function durableTextContaining(needles: string[]) {
  const { rows } = await getDbExec().execute(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND data_type IN ('text', 'character varying', 'jsonb', 'json')`);
  const found: string[] = [];
  for (const column of rows as Array<{
    table_name: string;
    column_name: string;
  }>) {
    for (const needle of needles) {
      // raw-sql-ok: identifiers come from information_schema; the needle is a bound parameter.
      const { rows: hits } = await getDbExec().execute({
        sql: `SELECT 1 FROM "${column.table_name}" WHERE "${column.column_name}"::text LIKE $1 LIMIT 1`,
        args: [`%${needle}%`],
      });
      if (hits.length > 0) {
        found.push(`${column.table_name}.${column.column_name}: ${needle}`);
      }
    }
  }
  return found;
}

describe("Content forms: settings", () => {
  it("creates a form with an unguessable link that only collection editors can read or change", async () => {
    const ids = await seedCollection({ orgId: ORG_ID });
    const form = { databaseId: ids.databaseId, viewId: ids.viewId };

    await expect(
      as(OWNER, () => getFormSettings.run(form)),
    ).resolves.toMatchObject({ configured: false, link: null });
    const created = await as(EDITOR, () =>
      configureForm.run({ ...form, audience: "anonymous" }),
    );
    expect(created).toMatchObject({
      configured: true,
      audience: "anonymous",
      acceptingAnswers: true,
      oneAnswerPerPerson: false,
      thankYouMessage: "",
      canvasDocumentId: null,
    });
    expect(created.link?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.link?.path).toBe(`/form/${created.link?.token}`);

    const changed = await as(OWNER, () =>
      configureForm.run({
        ...form,
        audience: "organization",
        oneAnswerPerPerson: true,
        thankYouMessage: "Thanks, we'll be in touch.",
        acceptingAnswers: false,
        canvasDocumentId: ids.canvasDocumentId,
      }),
    );
    expect(changed).toMatchObject({
      audience: "organization",
      oneAnswerPerPerson: true,
      acceptingAnswers: false,
      thankYouMessage: "Thanks, we'll be in touch.",
      canvasDocumentId: ids.canvasDocumentId,
      link: created.link,
    });
    await expect(as(OWNER, () => getFormSettings.run(form))).resolves.toEqual(
      changed,
    );

    const rotated = await as(OWNER, () =>
      configureForm.run({ ...form, rotateLink: true }),
    );
    expect(rotated.link?.token).not.toBe(created.link?.token);
    await expect(
      as(OWNER, () =>
        getForm.run({ link: created.link?.path ?? "" }, caller("192.0.2.1")),
      ),
    ).rejects.toMatchObject({ errorCode: "form_not_found", statusCode: 404 });

    for (const outsider of [VIEWER, MEMBER, "stranger@example.com"]) {
      await expect(
        as(outsider, () => getFormSettings.run(form)),
      ).rejects.toThrow();
      await expect(
        as(outsider, () =>
          configureForm.run({ ...form, audience: "anonymous" }),
        ),
      ).rejects.toThrow();
    }
    await expect(as(OWNER, () => getFormSettings.run(form))).resolves.toEqual(
      rotated,
    );
  });

  it("takes an ordinary page inside the collection as the form's page, even though the space's Files collection lists it", async () => {
    const ids = await seedCollection();
    const memberships = await getDb()
      .select({ databaseId: schema.contentDatabaseItems.databaseId })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, ids.canvasDocumentId));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].databaseId).not.toBe(ids.databaseId);

    await expect(
      as(OWNER, () =>
        configureForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          canvasDocumentId: ids.canvasDocumentId,
        }),
      ),
    ).resolves.toMatchObject({ canvasDocumentId: ids.canvasDocumentId });
  });

  it("refuses settings a form can't keep", async () => {
    const ids = await seedCollection();
    const form = { databaseId: ids.databaseId, viewId: ids.viewId };
    await expect(
      as(OWNER, () =>
        configureForm.run({
          ...form,
          audience: "anonymous",
          oneAnswerPerPerson: true,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_form_settings" });
    await expect(
      as(OWNER, () => configureForm.run({ ...form, audience: "organization" })),
    ).rejects.toMatchObject({ errorCode: "invalid_form_settings" });
    await expect(
      as(OWNER, () =>
        configureForm.run({ ...form, canvasDocumentId: ids.existingRowId }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_form_settings" });
    await expect(
      as(OWNER, () =>
        configureForm.run({ databaseId: ids.databaseId, viewId: "grid" }),
      ),
    ).rejects.toMatchObject({ errorCode: "not_a_form_view" });
    await expect(receiptsOf(ids)).resolves.toEqual([]);
  });
});

describe("Content forms: reading a form by its link", () => {
  it("returns only the form's own title, page, questions, answer schema and whether the caller may submit", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });

    const read = await as("stranger@example.com", () =>
      getForm.run({ link }, caller("192.0.2.10")),
    );

    expect(Object.keys(read).sort()).toEqual([
      "answerSchema",
      "answering",
      "canvas",
      "questions",
      "sent",
      "title",
    ]);
    expect(read.title).toBe("Request a design");
    expect(read.canvas).toContain("Tell us what you need");
    expect(read.questions).toEqual([
      {
        key: "name",
        wording: "Name",
        help: null,
        placeholder: null,
        required: true,
        answerType: "text",
      },
      {
        key: ids.priorityId,
        wording: "Priority",
        help: "P0 means a customer is blocked",
        placeholder: null,
        required: true,
        answerType: "one_choice",
        choices: [
          { id: "p0", label: "P0 — Urgent" },
          { id: "p1", label: "P1 — High" },
        ],
      },
      {
        key: ids.emailId,
        wording: "Email",
        help: null,
        placeholder: "you@example.com",
        required: false,
        answerType: "email",
      },
      {
        key: ids.countId,
        wording: "Seats",
        help: null,
        placeholder: null,
        required: false,
        answerType: "number",
      },
      {
        key: ids.descriptionId,
        wording: "Description",
        help: null,
        placeholder: null,
        required: false,
        answerType: "long_text",
      },
    ]);
    expect(read.answerSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["name", ids.priorityId],
      properties: {
        [ids.priorityId]: {
          type: "string",
          enum: ["P0 — Urgent", "P1 — High"],
        },
        [ids.countId]: { type: "number" },
      },
    });
    expect(read.answering).toEqual({
      as: "anonymous",
      canSubmit: true,
      refusal: null,
    });
    expect(read.sent).toEqual([]);

    const everything = JSON.stringify(read);
    for (const hidden of [
      "Confidential pipeline",
      "Existing confidential row",
      "Quarterly margin",
      "Internal margin",
      "Related deal",
      "Internal grid",
      ids.secretId,
      ids.existingRowId,
      ids.databaseId,
      OWNER,
    ]) {
      expect(everything).not.toContain(hidden);
    }
  });

  it("asks only the questions the Form view lists when the form has no page, and refuses links that don't work", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "anonymous",
      canvasDocumentId: null,
    });
    const read = await getForm.run({ link }, caller("192.0.2.11"));
    expect(read.title).toBe("Design intake");
    expect(read.canvas).toBe(null);
    expect(
      read.questions.map((question) => [question.key, question.required]),
    ).toEqual([
      ["name", true],
      [ids.priorityId, true],
      [ids.emailId, false],
    ]);

    for (const broken of [
      "https://content.example/form/not-a-real-token-at-all-000000",
      "not a link",
      `https://content.example/page/${ids.databaseDocumentId}`,
    ]) {
      await expect(
        getForm.run({ link: broken }, caller("192.0.2.11")),
      ).rejects.toMatchObject({ errorCode: "form_not_found" });
    }
  });
});

describe("Content forms: submitting", () => {
  it("validates every answer, saves nothing on any problem, and returns every problem at once", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const before = await rowsOf(ids);

    const result = await send(link, [
      { question: ids.priorityId, value: "Extremely urgent" },
      { question: ids.countId, value: { not: "a number" } },
      { question: ids.secretId, value: "leak me" },
      { question: "Internal margin", value: "leak me" },
      { question: "Nonexistent", value: "x" },
    ]);

    expect(result.outcome).toBe("needs_changes");
    expect(result).toMatchObject({
      problems: [
        {
          question: "name",
          wording: "Name",
          message: '"Name" is required.',
        },
        {
          question: ids.priorityId,
          wording: "Priority",
          message:
            'Unknown option "Extremely urgent" for "Priority". Choose one of: P0 — Urgent, P1 — High.',
        },
        {
          question: ids.countId,
          wording: "Seats",
          message:
            'Invalid value for property "Seats": expected a finite number',
        },
        {
          question: ids.secretId,
          wording: null,
          message: `This form has no question "${ids.secretId}".`,
        },
        {
          question: "Internal margin",
          wording: null,
          message: 'This form has no question "Internal margin".',
        },
        {
          question: "Nonexistent",
          wording: null,
          message: 'This form has no question "Nonexistent".',
        },
      ],
    });
    expect(result.message).toContain("Nothing was saved");
    await expect(rowsOf(ids)).resolves.toEqual(before);
    await expect(receiptsOf(ids)).resolves.toEqual([]);
  });

  it("gives the same message an editor gets in the collection's own form", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const viaLink = await send(link, [
      ...validAnswers(ids).filter(
        (answer) => answer.question !== ids.priorityId,
      ),
      { question: ids.priorityId, value: "Extremely urgent" },
    ]);
    const linkMessage =
      viaLink.outcome === "needs_changes" ? viaLink.problems[0].message : "";

    await expect(
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "From the collection",
          propertyEntries: [
            { property: ids.priorityId, value: "Extremely urgent" },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "invalid_answers",
      message: linkMessage,
    });
    expect(linkMessage).toContain('Unknown option "Extremely urgent"');
  });

  it("creates exactly one record per idempotency key, and refuses the key with different answers", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "anonymous",
      thankYouMessage: "Thanks! We reply within a day.",
    });
    const key = `retry-${randomUUID()}`;

    const first = await send(link, validAnswers(ids), { key });
    const again = await send(link, [...validAnswers(ids)].reverse(), {
      key,
      ip: "198.51.100.99",
    });
    expect(first).toMatchObject({ outcome: "submitted", replayed: false });
    expect(again).toMatchObject({ outcome: "submitted", replayed: true });
    expect(again.outcome === "submitted" && again.receipt).toEqual(
      first.outcome === "submitted" && first.receipt,
    );

    await expect(
      send(link, [...validAnswers(ids), { question: ids.countId, value: 4 }], {
        key,
      }),
    ).rejects.toMatchObject({
      errorCode: "idempotency_conflict",
      statusCode: 409,
    });
    const rows = await rowsOf(ids);
    expect(rows).toHaveLength(2);
    await expect(receiptsOf(ids)).resolves.toHaveLength(1);
  });

  it("writes the record and its receipt together, or neither", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    await getDbExec().execute(
      `CREATE FUNCTION force_form_receipt_failure() RETURNS trigger
       LANGUAGE plpgsql AS $receipt$
       BEGIN
         RAISE EXCEPTION 'forced receipt failure';
       END;
       $receipt$`,
    );
    await getDbExec().execute(
      `CREATE TRIGGER force_form_receipt_failure
       BEFORE INSERT ON content_form_submissions
       FOR EACH ROW EXECUTE FUNCTION force_form_receipt_failure()`,
    );
    try {
      await expect(send(link, validAnswers(ids))).rejects.toThrow(
        /forced receipt failure|Failed query:/,
      );
    } finally {
      await getDbExec().execute(
        "DROP TRIGGER IF EXISTS force_form_receipt_failure ON content_form_submissions",
      );
      await getDbExec().execute(
        "DROP FUNCTION IF EXISTS force_form_receipt_failure()",
      );
    }
    await expect(rowsOf(ids)).resolves.toHaveLength(1);
    await expect(
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.parentId, ids.databaseDocumentId),
            eq(schema.documents.title, "New landing page"),
          ),
        ),
    ).resolves.toEqual([]);
  });

  it("records an anonymous answer as anonymous and keeps nothing that identifies the sender", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const sender = `anonymous-sender-${randomUUID()}@example.com`;
    const address = "203.0.113.77";

    const result = await send(link, validAnswers(ids), {
      as: sender,
      ip: address,
      ctx: { userEmail: sender, caller: "mcp" },
    });
    if (result.outcome !== "submitted") throw new Error(result.message);
    expect(result.receipt.sender).toEqual({ kind: "anonymous" });

    const [record] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.receipt.record.documentId));
    expect(record).toMatchObject({
      ownerEmail: OWNER,
      createdBy: null,
      updatedBy: null,
      parentId: ids.databaseDocumentId,
    });
    await expect(receiptsOf(ids)).resolves.toEqual([
      expect.objectContaining({
        documentId: record.id,
        channel: "link",
        senderKind: "anonymous",
        senderEmail: null,
      }),
    ]);
    await expect(
      durableTextContaining([sender, address, USER_AGENT]),
    ).resolves.toEqual([]);
  });

  it("records a signed-in sender, who can read what they sent but nothing else of the collection", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "signed_in",
      thankYouMessage: "Thanks! We reply within a day.",
    });
    const sender = "signed-in-sender@example.com";

    const result = await send(link, validAnswers(ids), { as: sender });
    expect(result).toMatchObject({
      outcome: "submitted",
      replayed: false,
      receipt: {
        formTitle: "Request a design",
        answers: [
          { question: "name", wording: "Name", value: "New landing page" },
          { question: ids.priorityId, wording: "Priority", value: "P1 — High" },
          {
            question: ids.emailId,
            wording: "Email",
            value: "contact@example.com",
          },
        ],
        thankYouMessage: "Thanks! We reply within a day.",
        sender: { kind: "signed_in", email: sender },
      },
    });
    if (result.outcome !== "submitted") throw new Error(result.message);
    const { record } = result.receipt;
    expect(record.urlPath).toBe(`/page/${record.documentId}`);
    expect(record.deepLink).toContain(record.documentId);
    expect(result.message).toContain("Thanks! We reply within a day.");

    const [saved] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, record.documentId));
    expect(saved).toMatchObject({
      title: "New landing page",
      createdBy: sender,
      ownerEmail: OWNER,
    });
    await expect(
      as(OWNER, () => resolveAccess("document", record.documentId)),
    ).resolves.toBeTruthy();
    for (const documentId of [
      record.documentId,
      ids.databaseDocumentId,
      ids.existingRowId,
    ]) {
      await expect(
        as(sender, () => resolveAccess("document", documentId)),
      ).resolves.toBe(null);
    }

    await send(link, validAnswers(ids), { as: "another-sender@example.com" });
    const read = await as(sender, () =>
      getForm.run({ link }, caller("192.0.2.12")),
    );
    expect(read.sent).toEqual([result.receipt]);
    expect(read.answering).toEqual({
      as: "signed_in",
      canSubmit: true,
      refusal: null,
    });
  });
});

describe("Content forms: who may answer", () => {
  it("lets anyone with the link answer an anonymous form, and needs a session for a signed-in form", async () => {
    const ids = await seedCollection();
    const anonymousLink = await setUpForm(ids, { audience: "anonymous" });
    await expect(send(anonymousLink, validAnswers(ids))).resolves.toMatchObject(
      { outcome: "submitted" },
    );

    await as(OWNER, () =>
      configureForm.run({
        databaseId: ids.databaseId,
        viewId: ids.viewId,
        audience: "signed_in",
      }),
    );
    const refused = await getForm
      .run({ link: anonymousLink }, caller("192.0.2.13"))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refused).toMatchObject({
      errorCode: "sign_in_required",
      statusCode: 401,
      message: "Sign in to answer this form.",
    });
    expect(JSON.stringify(refused)).not.toContain("Tell us what you need");
    await expect(send(anonymousLink, validAnswers(ids))).rejects.toMatchObject({
      errorCode: "sign_in_required",
      statusCode: 401,
      message: "Sign in to answer this form.",
    });
    await expect(
      send(anonymousLink, validAnswers(ids), { as: "someone@example.com" }),
    ).resolves.toMatchObject({ outcome: "submitted" });
  });

  it("limits an organization form to members of the collection's organization", async () => {
    const ids = await seedCollection({ orgId: ORG_ID });
    const link = await setUpForm(ids, { audience: "organization" });

    const outsider = await as("outsider@example.com", () =>
      getForm.run({ link }, caller("192.0.2.14")),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outsider).toMatchObject({
      errorCode: "organization_only",
      statusCode: 403,
      details: undefined,
    });
    for (const content of ["Tell us what you need", "Request a design", "P0"]) {
      expect(JSON.stringify(outsider)).not.toContain(content);
    }
    await expect(
      as(MEMBER, () => getForm.run({ link }, caller("192.0.2.14"))),
    ).resolves.toMatchObject({
      title: "Request a design",
      answering: { as: "signed_in", canSubmit: true, refusal: null },
    });
    await expect(
      send(link, validAnswers(ids), { as: "outsider@example.com" }),
    ).rejects.toMatchObject({
      errorCode: "organization_only",
      statusCode: 403,
      message:
        "Only members of the organization this form belongs to can answer it.",
    });
    await expect(
      send(link, validAnswers(ids), { as: MEMBER }),
    ).resolves.toMatchObject({
      outcome: "submitted",
      receipt: { sender: { kind: "signed_in", email: MEMBER } },
    });
  });

  it("refuses answers while the form is closed", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "anonymous",
      acceptingAnswers: false,
    });
    await expect(
      getForm.run({ link }, caller("192.0.2.15")),
    ).resolves.toMatchObject({
      answering: { canSubmit: false, refusal: { code: "form_closed" } },
    });
    await expect(send(link, validAnswers(ids))).rejects.toMatchObject({
      errorCode: "form_closed",
    });
    await expect(rowsOf(ids)).resolves.toHaveLength(1);
  });
});

describe("Content forms: one answer per person", () => {
  it("refuses a second answer from the same person and points at what they sent", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "signed_in",
      oneAnswerPerPerson: true,
    });
    const sender = "once@example.com";
    const first = await send(link, validAnswers(ids), { as: sender });
    if (first.outcome !== "submitted") throw new Error(first.message);

    await expect(
      send(link, validAnswers(ids), { as: sender, ip: "198.51.100.42" }),
    ).rejects.toMatchObject({
      errorCode: "already_answered",
      statusCode: 409,
      message: expect.stringContaining(first.receipt.receiptId),
      details: { receipt: first.receipt },
    });
    const read = await as(sender, () =>
      getForm.run({ link }, caller("192.0.2.16")),
    );
    expect(read.answering).toMatchObject({
      canSubmit: false,
      refusal: { code: "already_answered" },
    });
    expect(read.sent).toEqual([first.receipt]);
    await expect(
      send(link, validAnswers(ids), { as: "someone-else@example.com" }),
    ).resolves.toMatchObject({ outcome: "submitted" });
    await expect(rowsOf(ids)).resolves.toHaveLength(3);
  });
});

describe("Content forms: flood limits", () => {
  it("refuses a burst from one network however it labels itself, and says when to try again", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const fromNetwork = (address: string, forwardedFor: string) => ({
      requestHeaders: new Headers({
        "x-nf-client-connection-ip": address,
        "x-forwarded-for": forwardedFor,
      }),
    });
    for (
      let attempt = 0;
      attempt < flood.CONTENT_FORM_SOURCE_LIMIT;
      attempt++
    ) {
      await expect(
        send(link, [], {
          ctx: fromNetwork(`2001:db8:5:7::${attempt + 1}`, `10.0.0.${attempt}`),
        }),
      ).resolves.toMatchObject({ outcome: "needs_changes" });
    }
    await expect(
      send(link, validAnswers(ids), {
        ctx: fromNetwork("2001:db8:5:7::ff", "10.0.0.200"),
      }),
    ).rejects.toMatchObject({
      errorCode: "too_many_submissions",
      statusCode: 429,
      message: expect.stringMatching(
        /^Too many answers were sent from here just now\. Try again in \d+ seconds\.$/,
      ),
    });
    await expect(
      send(link, validAnswers(ids), {
        ctx: fromNetwork("2001:db8:5:8::1", "10.0.0.200"),
      }),
    ).resolves.toMatchObject({ outcome: "submitted" });
  });

  it("holds a caller with no address from Content's edge to the form's own limit only", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const unaddressed = {
      requestHeaders: new Headers({ "x-forwarded-for": "203.0.113.5" }),
    };
    for (
      let attempt = 0;
      attempt < flood.CONTENT_FORM_SOURCE_LIMIT;
      attempt++
    ) {
      await send(link, [], { ctx: unaddressed });
    }
    await expect(
      send(link, validAnswers(ids), { ctx: unaddressed }),
    ).resolves.toMatchObject({ outcome: "submitted" });
  });

  it("refuses a burst from one signed-in person whatever network they use", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "signed_in" });
    for (
      let attempt = 0;
      attempt < flood.CONTENT_FORM_SOURCE_LIMIT;
      attempt++
    ) {
      await send(link, [], {
        as: "busy@example.com",
        ip: `203.0.113.${attempt}`,
      });
    }
    await expect(
      send(link, validAnswers(ids), {
        as: "busy@example.com",
        ip: "203.0.113.200",
      }),
    ).rejects.toMatchObject({ errorCode: "too_many_submissions" });
  });

  it("refuses answers once a form has had its fill for the minute", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentFormSubmissions)
      .values(
        Array.from({ length: flood.CONTENT_FORM_FORM_LIMIT }, (_, index) => ({
          id: `burst_${ids.databaseId}_${index}`,
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          documentId: `burst_document_${index}`,
          itemId: `burst_item_${index}`,
          channel: "link",
          senderKind: "anonymous",
          senderEmail: null,
          idempotencyKey: `burst-key-${index}`,
          answersDigest: "digest",
          receiptJson: "{}",
          createdAt: now,
        })),
      );
    await expect(
      send(link, validAnswers(ids), { ip: "203.0.113.250" }),
    ).rejects.toMatchObject({
      errorCode: "too_many_submissions",
      message:
        "Too many answers were sent to this form just now. Try again in 60 seconds.",
    });
  });
});

describe("Content forms: drafts", () => {
  it("keeps a signed-in person's draft apart from the collection and clears it when they send", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "signed_in" });
    const person = "drafter@example.com";
    const partial = [{ question: "name", value: "Half-written request" }];

    const saved = await as(person, () =>
      saveDraft.run({ link, answers: partial }),
    );
    expect(saved.answers).toEqual(partial);
    expect(Date.parse(saved.expiresAt) - Date.parse(saved.updatedAt)).toBe(
      drafts.CONTENT_FORM_DRAFT_TTL_MS,
    );
    await expect(as(person, () => getDraft.run({ link }))).resolves.toEqual(
      saved,
    );
    await expect(
      as("someone-else@example.com", () => getDraft.run({ link })),
    ).resolves.toBe(null);
    await expect(rowsOf(ids)).resolves.toHaveLength(1);
    await expect(receiptsOf(ids)).resolves.toEqual([]);

    await expect(as(person, () => clearDraft.run({ link }))).resolves.toEqual({
      cleared: true,
    });
    await expect(as(person, () => getDraft.run({ link }))).resolves.toBe(null);

    await as(person, () => saveDraft.run({ link, answers: partial }));
    await send(link, validAnswers(ids), { as: person });
    await expect(as(person, () => getDraft.run({ link }))).resolves.toBe(null);
  });

  it("forgets a draft 30 days after its last change", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "signed_in" });
    const person = "slow-drafter@example.com";
    await as(person, () =>
      saveDraft.run({ link, answers: [{ question: "name", value: "Old" }] }),
    );
    const stale = new Date(
      Date.now() - drafts.CONTENT_FORM_DRAFT_TTL_MS - 60_000,
    ).toISOString();
    await getDb()
      .update(schema.contentFormDrafts)
      .set({ updatedAt: stale })
      .where(eq(schema.contentFormDrafts.senderEmail, person));

    await expect(as(person, () => getDraft.run({ link }))).resolves.toBe(null);
    await expect(drafts.deleteExpiredContentFormDrafts()).resolves.toBe(1);
    await expect(
      getDb()
        .select()
        .from(schema.contentFormDrafts)
        .where(eq(schema.contentFormDrafts.senderEmail, person)),
    ).resolves.toEqual([]);
  });

  it("keeps no server draft for an anonymous form or a caller who isn't signed in", async () => {
    const ids = await seedCollection();
    const anonymousLink = await setUpForm(ids, { audience: "anonymous" });
    await expect(
      as("someone@example.com", () =>
        saveDraft.run({ link: anonymousLink, answers: [] }),
      ),
    ).rejects.toMatchObject({ errorCode: "drafts_unavailable" });

    await as(OWNER, () =>
      configureForm.run({
        databaseId: ids.databaseId,
        viewId: ids.viewId,
        audience: "signed_in",
      }),
    );
    await expect(
      as(null, () => saveDraft.run({ link: anonymousLink, answers: [] })),
    ).rejects.toMatchObject({ errorCode: "sign_in_required" });
  });
});

describe("Content forms: an agent answering for its person", () => {
  it("gets every problem at once, then one record whose receipt names its person", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "signed_in" });
    const person = "agent-person@example.com";
    const agent = { caller: "mcp" as const, userEmail: person };
    const key = `agent-${randomUUID()}`;

    const read = await as(person, () =>
      getForm.run({ link }, caller("192.0.2.20", agent)),
    );
    expect(read.answering).toEqual({
      as: "signed_in",
      canSubmit: true,
      refusal: null,
    });

    const missing = await send(
      link,
      [{ question: ids.emailId, value: "agent@example.com" }],
      { as: person, key, ctx: agent },
    );
    expect(missing).toMatchObject({
      outcome: "needs_changes",
      problems: [
        { question: "name", message: '"Name" is required.' },
        { question: ids.priorityId, message: '"Priority" is required.' },
      ],
    });
    await expect(rowsOf(ids)).resolves.toHaveLength(1);

    const corrected = [
      { question: "name", value: "Agent request" },
      { question: ids.priorityId, value: "P0 — Urgent" },
      { question: ids.emailId, value: "agent@example.com" },
    ];
    const sent = await send(link, corrected, { as: person, key, ctx: agent });
    const resent = await send(link, corrected, { as: person, key, ctx: agent });
    expect(sent).toMatchObject({
      outcome: "submitted",
      replayed: false,
      receipt: { sender: { kind: "signed_in", email: person } },
    });
    expect(resent).toMatchObject({ outcome: "submitted", replayed: true });
    await expect(rowsOf(ids)).resolves.toHaveLength(2);
  });

  it("is recorded as anonymous on an anonymous form, as a browser would be", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const person = "agent-anon-person@example.com";
    const result = await send(link, validAnswers(ids), {
      as: person,
      ctx: { caller: "mcp", userEmail: person },
    });
    expect(result).toMatchObject({
      outcome: "submitted",
      receipt: { sender: { kind: "anonymous" } },
    });
  });
});

describe("the collection's own form", () => {
  it("runs through the same engine: its rows get receipts and honor an idempotency key", async () => {
    const ids = await seedCollection();
    const key = `collection-${randomUUID()}`;
    const submit = (priority: string) =>
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Editor request",
          propertyEntries: [{ property: ids.priorityId, value: priority }],
          idempotencyKey: key,
        }),
      );
    const first = await submit("P1 — High");
    const again = await submit("P1 — High");
    expect(again).toEqual(first);
    await expect(submit("P0 — Urgent")).rejects.toMatchObject({
      errorCode: "idempotency_conflict",
    });
    await expect(receiptsOf(ids)).resolves.toEqual([
      expect.objectContaining({
        documentId: first.createdDocumentId,
        channel: "collection",
        senderKind: "signed_in",
        senderEmail: OWNER,
      }),
    ]);
  });

  it("asks the questions on the form's page once the form has one", async () => {
    const ids = await seedCollection();
    await setUpForm(ids, { audience: "anonymous" });
    await expect(
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Editor request",
          propertyEntries: [{ property: ids.countId, value: 3 }],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "invalid_answers",
      message: '"Priority" is required.',
    });
  });
});

async function whileLocked<T>(
  ids: Seeded,
  statements: string[],
  run: () => Promise<T>,
): Promise<T> {
  const name = `forms_race_${randomUUID().replaceAll("-", "")}`;
  // raw-sql-ok: the trigger's name and statements come from this file's seeded ids, never from input.
  await getDbExec().execute(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $race$ BEGIN ${statements.join("; ")}; RETURN NEW; END; $race$`,
  );
  // raw-sql-ok: the trigger's name and the collection's id come from this file's seeded ids.
  await getDbExec().execute(
    `CREATE TRIGGER ${name} AFTER UPDATE ON content_databases FOR EACH ROW WHEN (NEW.id = '${ids.databaseId}' AND OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at AND pg_trigger_depth() < 1) EXECUTE FUNCTION ${name}()`,
  );
  try {
    return await run();
  } finally {
    // raw-sql-ok: the trigger's name is built above from a UUID.
    await getDbExec().execute(`DROP TRIGGER ${name} ON content_databases`);
    // raw-sql-ok: the function's name is built above from a UUID.
    await getDbExec().execute(`DROP FUNCTION ${name}()`);
  }
}

async function hideReceiptKey(receiptId: string) {
  await getDb()
    .update(schema.contentFormSubmissions)
    .set({ idempotencyKey: `hidden-${receiptId}` })
    .where(eq(schema.contentFormSubmissions.id, receiptId));
}

async function addProperty(
  ids: Seeded,
  property: { id: string; name: string; type: string; optionsJson?: string },
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentPropertyDefinitions)
    .values({
      ownerEmail: OWNER,
      databaseId: ids.databaseId,
      position: 10,
      createdAt: now,
      updatedAt: now,
      ...property,
    });
}

async function askOnCanvas(
  ids: Seeded,
  questions: Array<{ propertyId: string; required: boolean }>,
) {
  const [canvas] = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, ids.canvasDocumentId));
  await getDb()
    .update(schema.documents)
    .set({
      content: [
        canvas.content,
        ...questions.map((question) =>
          formQuestionBlockRaw(`q-${question.propertyId}`, question),
        ),
      ].join("\n\n"),
    })
    .where(eq(schema.documents.id, ids.canvasDocumentId));
}

describe("Content forms: a reader the audience doesn't let in", () => {
  it("gets the audience refusal even when the form's page is broken", async () => {
    const ids = await seedCollection({ orgId: ORG_ID });
    const link = await setUpForm(ids, { audience: "organization" });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, ids.canvasDocumentId));

    await expect(
      as("outsider@example.com", () =>
        getForm.run({ link }, caller("192.0.2.30")),
      ),
    ).rejects.toMatchObject({ errorCode: "organization_only" });
    await expect(
      as(MEMBER, () => getForm.run({ link }, caller("192.0.2.30"))),
    ).rejects.toMatchObject({ errorCode: "form_unavailable" });

    await as(OWNER, () =>
      configureForm.run({
        databaseId: ids.databaseId,
        viewId: ids.viewId,
        audience: "signed_in",
      }),
    );
    await expect(
      as(null, () => getForm.run({ link }, caller("192.0.2.30"))),
    ).rejects.toMatchObject({ errorCode: "sign_in_required" });
  });
});

describe("Content forms: the collection's own checks", () => {
  it("refuses values the collection refuses anywhere else, all at once, on both channels", async () => {
    const ids = await seedCollection();
    const urgentId = `urgent_${ids.databaseId}`;
    await addProperty(ids, { id: urgentId, name: "Urgent", type: "checkbox" });
    await askOnCanvas(ids, [{ propertyId: urgentId, required: false }]);
    const link = await setUpForm(ids, { audience: "anonymous" });
    const before = await rowsOf(ids);

    const refused = await send(link, [
      { question: "name", value: "New landing page" },
      { question: ids.priorityId, value: "P1 — High" },
      { question: ids.emailId, value: "not-an-email" },
      { question: urgentId, value: { yes: true } },
    ]);
    expect(refused).toMatchObject({
      outcome: "needs_changes",
      problems: [
        {
          question: ids.emailId,
          wording: "Email",
          message:
            'Invalid value for property "Email": expected an email address',
        },
        {
          question: urgentId,
          wording: "Urgent",
          message: 'Invalid value for property "Urgent": expected a boolean',
        },
      ],
    });
    await expect(
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "From the collection",
          propertyEntries: [
            { property: ids.priorityId, value: "P1 — High" },
            { property: ids.emailId, value: "not-an-email" },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "invalid_answers",
      message: 'Invalid value for property "Email": expected an email address',
    });
    await expect(rowsOf(ids)).resolves.toEqual(before);
    await expect(receiptsOf(ids)).resolves.toEqual([]);

    const sent = await send(link, [
      ...validAnswers(ids),
      { question: urgentId, value: "yes" },
    ]);
    if (sent.outcome !== "submitted") throw new Error(sent.message);
    const [urgent] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(
            schema.documentPropertyValues.documentId,
            sent.receipt.record.documentId,
          ),
          eq(schema.documentPropertyValues.propertyId, urgentId),
        ),
      );
    expect(urgent.valueJson).toBe("true");
  });

  it("checks a relation answer in the collection's own form the way a page's relation is checked", async () => {
    const ids = await seedCollection();
    const linkedId = `linked_${ids.databaseId}`;
    await addProperty(ids, {
      id: linkedId,
      name: "Linked request",
      type: "relation",
      optionsJson: serializePropertyOptions({
        relation: { databaseId: ids.databaseId },
      }),
    });
    const submitLinked = (value: unknown) =>
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Follow-up",
          propertyEntries: [
            { property: ids.priorityId, value: "P1 — High" },
            { property: linkedId, value },
          ],
        }),
      );
    const before = await rowsOf(ids);

    await expect(submitLinked(["forms_missing_page"])).rejects.toMatchObject({
      errorCode: "invalid_answers",
      message: "Some linked pages are not rows of the related database",
    });
    await expect(rowsOf(ids)).resolves.toEqual(before);

    const created = await submitLinked([ids.existingRowId]);
    const [linked] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(
            schema.documentPropertyValues.documentId,
            created.createdDocumentId,
          ),
          eq(schema.documentPropertyValues.propertyId, linkedId),
        ),
      );
    expect(JSON.parse(linked.valueJson)).toEqual([ids.existingRowId]);
  });

  it("keeps the collection's natural key to one record, and saves nothing for a key already taken", async () => {
    const ids = await seedCollection();
    const ticketId = `ticket_${ids.databaseId}`;
    await addProperty(ids, { id: ticketId, name: "Ticket", type: "text" });
    await getDb()
      .update(schema.contentDatabases)
      .set({ naturalKeyPropertyId: ticketId })
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    await askOnCanvas(ids, [{ propertyId: ticketId, required: false }]);
    const link = await setUpForm(ids, { audience: "anonymous" });
    const withTicket = [
      ...validAnswers(ids),
      { question: ticketId, value: "T-100" },
    ];

    const first = await send(link, withTicket);
    if (first.outcome !== "submitted") throw new Error(first.message);
    const rows = await rowsOf(ids);

    await expect(send(link, withTicket)).resolves.toMatchObject({
      outcome: "needs_changes",
      problems: [
        {
          question: ticketId,
          wording: "Ticket",
          message: "The natural key is already in use.",
        },
      ],
    });
    await expect(
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Same ticket",
          propertyEntries: [
            { property: ids.priorityId, value: "P1 — High" },
            { property: ticketId, value: "T-100" },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "NATURAL_KEY_CONFLICT",
      message: "The natural key is already in use.",
    });
    await expect(rowsOf(ids)).resolves.toEqual(rows);
    await expect(receiptsOf(ids)).resolves.toHaveLength(1);
    await expect(
      getDb()
        .select({
          documentId: schema.contentDatabaseItemKeyClaims.documentId,
          keyValueJson: schema.contentDatabaseItemKeyClaims.keyValueJson,
        })
        .from(schema.contentDatabaseItemKeyClaims)
        .where(
          eq(schema.contentDatabaseItemKeyClaims.databaseId, ids.databaseId),
        ),
    ).resolves.toEqual([
      {
        documentId: first.receipt.record.documentId,
        keyValueJson: '"T-100"',
      },
    ]);
  });
});

describe("Content forms: a resent key always gets its receipt", () => {
  it("replays a twin that committed while the resend waited for the lock, even though the form changed", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const key = `twin-${randomUUID()}`;
    const first = await send(link, validAnswers(ids), { key });
    if (first.outcome !== "submitted") throw new Error(first.message);
    const rows = await rowsOf(ids);
    await hideReceiptKey(first.receipt.receiptId);

    const resent = await whileLocked(
      ids,
      [
        `UPDATE content_form_submissions SET idempotency_key = '${key}' WHERE id = '${first.receipt.receiptId}'`,
        `UPDATE content_forms SET accepting_answers = 0 WHERE database_id = '${ids.databaseId}'`,
        `UPDATE content_databases SET view_config_json = view_config_json || ' ' WHERE id = '${ids.databaseId}'`,
      ],
      () => send(link, validAnswers(ids), { key }),
    );
    expect(resent).toEqual({
      outcome: "submitted",
      replayed: true,
      message: expect.stringContaining(first.receipt.receiptId),
      receipt: first.receipt,
    });
    await expect(rowsOf(ids)).resolves.toEqual(rows);
  });

  it("replays rather than calling the twin a second answer from the same person", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "signed_in",
      oneAnswerPerPerson: true,
    });
    const person = "twin-once@example.com";
    const key = `twin-${randomUUID()}`;
    const first = await send(link, validAnswers(ids), { as: person, key });
    if (first.outcome !== "submitted") throw new Error(first.message);

    vi.spyOn(receipts, "assertNoContentFormSubmission").mockResolvedValueOnce(
      undefined,
    );
    await expect(
      send(link, validAnswers(ids), { as: person, key }),
    ).resolves.toMatchObject({
      outcome: "submitted",
      replayed: true,
      receipt: first.receipt,
    });
    await expect(rowsOf(ids)).resolves.toHaveLength(2);
  });

  it("replays rather than refusing a flood the twin helped fill", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const key = `twin-${randomUUID()}`;
    const first = await send(link, validAnswers(ids), {
      key,
      ip: "203.0.113.40",
    });
    if (first.outcome !== "submitted") throw new Error(first.message);
    for (
      let attempt = 0;
      attempt < flood.CONTENT_FORM_SOURCE_LIMIT;
      attempt++
    ) {
      await send(link, [], { ip: "203.0.113.41" });
    }

    vi.spyOn(receipts, "assertNoContentFormSubmission").mockResolvedValueOnce(
      undefined,
    );
    await expect(
      send(link, validAnswers(ids), { key, ip: "203.0.113.41" }),
    ).resolves.toMatchObject({
      outcome: "submitted",
      replayed: true,
      receipt: first.receipt,
    });
  });

  it("replays a twin in the collection's own form that committed while it waited for the lock", async () => {
    const ids = await seedCollection();
    await setUpForm(ids, { audience: "anonymous" });
    const key = `twin-${randomUUID()}`;
    const submit = () =>
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Editor request",
          propertyEntries: [{ property: ids.priorityId, value: "P1 — High" }],
          idempotencyKey: key,
        }),
      );
    const first = await submit();
    const [stored] = await receiptsOf(ids);
    await hideReceiptKey(stored.id);

    const resent = await whileLocked(
      ids,
      [
        `UPDATE content_form_submissions SET idempotency_key = '${key}' WHERE id = '${stored.id}'`,
        `UPDATE content_forms SET accepting_answers = 0 WHERE database_id = '${ids.databaseId}'`,
        `UPDATE content_databases SET view_config_json = view_config_json || ' ' WHERE id = '${ids.databaseId}'`,
        `INSERT INTO content_database_sources (id, database_id, source_type, source_name, source_table) VALUES ('source_${ids.databaseId}', '${ids.databaseId}', 'github', 'docs', 'docs')`,
      ],
      submit,
    );
    expect(resent).toEqual(first);
    await expect(rowsOf(ids)).resolves.toHaveLength(2);
  });

  it("replays a resend in the collection's own form after the collection starts following GitHub", async () => {
    const ids = await seedCollection();
    const key = `resend-${randomUUID()}`;
    const submit = () =>
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Editor request",
          propertyEntries: [{ property: ids.priorityId, value: "P1 — High" }],
          idempotencyKey: key,
        }),
      );
    const first = await submit();
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values({
        id: `source_${ids.databaseId}`,
        databaseId: ids.databaseId,
        sourceType: "github",
        sourceName: "docs",
        sourceTable: "docs",
      });

    await expect(submit()).resolves.toEqual(first);
  });
});

describe("Content forms: rules that change while answers wait", () => {
  it("refuses with form_changed when the form's page or settings change before the write, on both channels", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const before = await rowsOf(ids);
    const editCanvas = `UPDATE documents SET content = content || ' Now also asks for a budget.' WHERE id = '${ids.canvasDocumentId}'`;
    const collectionSubmit = () =>
      as(OWNER, () =>
        submitCollectionForm.run({
          databaseId: ids.databaseId,
          viewId: ids.viewId,
          title: "Editor request",
          propertyEntries: [{ property: ids.priorityId, value: "P1 — High" }],
        }),
      );

    await expect(
      whileLocked(ids, [editCanvas], () => send(link, validAnswers(ids))),
    ).rejects.toMatchObject({ errorCode: "form_changed", statusCode: 409 });
    await expect(
      whileLocked(ids, [editCanvas], collectionSubmit),
    ).rejects.toMatchObject({ errorCode: "form_changed" });
    await expect(
      whileLocked(
        ids,
        [
          `UPDATE content_forms SET canvas_document_id = NULL WHERE database_id = '${ids.databaseId}'`,
        ],
        collectionSubmit,
      ),
    ).rejects.toMatchObject({ errorCode: "form_changed" });
    await expect(rowsOf(ids)).resolves.toEqual(before);
    await expect(receiptsOf(ids)).resolves.toEqual([]);
  });

  it("refuses with form_changed when the collection moves to another workspace before the write, on both channels", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const before = await rowsOf(ids);
    const move = `UPDATE content_databases SET space_id = 'forms_moved_space', org_id = 'forms_moved_org' WHERE id = '${ids.databaseId}'`;

    await expect(
      whileLocked(ids, [move], () => send(link, validAnswers(ids))),
    ).rejects.toMatchObject({ errorCode: "form_changed", statusCode: 409 });
    await expect(
      whileLocked(ids, [move], () =>
        as(OWNER, () =>
          submitCollectionForm.run({
            databaseId: ids.databaseId,
            viewId: ids.viewId,
            title: "Editor request",
            propertyEntries: [{ property: ids.priorityId, value: "P1 — High" }],
          }),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "form_changed" });
    await expect(rowsOf(ids)).resolves.toEqual(before);
  });

  it("refuses a relation to a row moved to Trash before the write, as a page's relation write would", async () => {
    const ids = await seedCollection();
    const linkedId = `linked_${ids.databaseId}`;
    await addProperty(ids, {
      id: linkedId,
      name: "Linked request",
      type: "relation",
      optionsJson: serializePropertyOptions({
        relation: { databaseId: ids.databaseId },
      }),
    });
    const before = await rowsOf(ids);

    await expect(
      whileLocked(
        ids,
        [
          `UPDATE documents SET trashed_at = '2026-11-26T00:00:00.000Z' WHERE id = '${ids.existingRowId}'`,
        ],
        () =>
          as(OWNER, () =>
            submitCollectionForm.run({
              databaseId: ids.databaseId,
              viewId: ids.viewId,
              title: "Follow-up",
              propertyEntries: [
                { property: ids.priorityId, value: "P1 — High" },
                { property: linkedId, value: [ids.existingRowId] },
              ],
            }),
          ),
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_RELATION_TARGET" });
    await expect(receiptsOf(ids)).resolves.toEqual([]);
    await expect(rowsOf(ids)).resolves.toEqual(before);
  });

  it("refuses once the collection stops taking new rows before the write", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const followGitHub = `INSERT INTO content_database_sources (id, database_id, source_type, source_name, source_table) VALUES ('source_${ids.databaseId}', '${ids.databaseId}', 'github', 'docs', 'docs')`;

    await expect(
      whileLocked(ids, [followGitHub], () => send(link, validAnswers(ids))),
    ).rejects.toMatchObject({ errorCode: "form_closed" });
    await expect(
      whileLocked(ids, [followGitHub], () =>
        as(OWNER, () =>
          submitCollectionForm.run({
            databaseId: ids.databaseId,
            viewId: ids.viewId,
            title: "Editor request",
            propertyEntries: [{ property: ids.priorityId, value: "P1 — High" }],
          }),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "SOURCE_READ_ONLY" });
    await expect(rowsOf(ids)).resolves.toHaveLength(1);
  });
});

describe("Content forms: a link without a page", () => {
  it("never asks a property the Form view doesn't list, such as one added after the link was shared", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, {
      audience: "anonymous",
      canvasDocumentId: null,
    });
    const budgetId = `budget_${ids.databaseId}`;
    await addProperty(ids, { id: budgetId, name: "Budget", type: "text" });

    const read = await getForm.run({ link }, caller("192.0.2.40"));
    expect(read.questions.map((question) => question.key)).toEqual([
      "name",
      ids.priorityId,
      ids.emailId,
    ]);
    expect(JSON.stringify(read)).not.toContain("Budget");
    await expect(
      send(link, [...validAnswers(ids), { question: budgetId, value: "$10k" }]),
    ).resolves.toMatchObject({
      outcome: "needs_changes",
      problems: [
        {
          question: budgetId,
          wording: null,
          message: `This form has no question "${budgetId}".`,
        },
      ],
    });

    const [database] = await getDb()
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    const config = JSON.parse(database.viewConfigJson) as {
      views: Array<{ id: string; formQuestions?: unknown[] }>;
    };
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          ...config,
          views: config.views.map((view) =>
            view.id === ids.viewId ? { ...view, formQuestions: [] } : view,
          ),
        }),
      })
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    await expect(
      getForm.run({ link }, caller("192.0.2.40")),
    ).resolves.toMatchObject({
      questions: [{ key: "name", required: true }],
    });
  });
});

describe("Content forms: the answer schema", () => {
  it("refuses what the form refuses, and tells apart choices that share a label", async () => {
    const ids = await seedCollection();
    const teamsId = `teams_${ids.databaseId}`;
    await addProperty(ids, {
      id: teamsId,
      name: "Teams",
      type: "multi_select",
      optionsJson: serializePropertyOptions({
        options: [
          { id: "design-a", name: "Design", color: "blue" },
          { id: "design-b", name: "design ", color: "green" },
          { id: "eng", name: "Engineering", color: "gray" },
          { id: "ops", name: "eng", color: "red" },
        ],
      }),
    });
    await askOnCanvas(ids, [{ propertyId: teamsId, required: true }]);
    const link = await setUpForm(ids, { audience: "anonymous" });

    const read = await getForm.run({ link }, caller("192.0.2.41"));
    expect(read.answerSchema).toMatchObject({
      required: ["name", ids.priorityId, teamsId],
      properties: {
        name: { type: "string", minLength: 1, pattern: "\\S" },
        [ids.priorityId]: {
          type: "string",
          minLength: 1,
          enum: ["P0 — Urgent", "P1 — High"],
        },
        [teamsId]: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: {
            type: "string",
            enum: ["design-a", "design-b", "Engineering", "ops"],
          },
        },
      },
    });
    const properties = read.answerSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties[ids.emailId]).not.toHaveProperty("minLength");
    const emailPattern = new RegExp(String(properties[ids.emailId].pattern));
    expect(emailPattern.test("")).toBe(true);
    expect(emailPattern.test(" ada@example.com ")).toBe(true);
    expect(emailPattern.test("not-an-email")).toBe(false);
    expect(new RegExp(String(properties.name.pattern)).test(" ")).toBe(false);

    const sent = await send(link, [
      ...validAnswers(ids),
      { question: teamsId, value: ["design-b", "Engineering"] },
    ]);
    if (sent.outcome !== "submitted") throw new Error(sent.message);
    const [teams] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(
            schema.documentPropertyValues.documentId,
            sent.receipt.record.documentId,
          ),
          eq(schema.documentPropertyValues.propertyId, teamsId),
        ),
      );
    expect(JSON.parse(teams.valueJson)).toEqual(["design-b", "eng"]);
  });
});

describe("Content forms: what a link submit leaves behind", () => {
  it("refreshes the collection owner's sessions without naming the sender", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const sender = `refresh-sender-${randomUUID()}@example.com`;
    const before = Date.now();
    const result = await send(link, validAnswers(ids), {
      as: sender,
      ctx: { userEmail: sender },
    });
    expect(result.outcome).toBe("submitted");
    const signal = await as(OWNER, () => readAppState("refresh-signal"));
    expect(Number(signal?.ts)).toBeGreaterThanOrEqual(before);
    await expect(durableTextContaining([sender])).resolves.toEqual([]);
  });

  it("deletes a record's receipts when its page is permanently deleted", async () => {
    const ids = await seedCollection();
    const link = await setUpForm(ids, { audience: "anonymous" });
    const kept = await send(link, validAnswers(ids));
    const purged = await send(link, validAnswers(ids));
    if (kept.outcome !== "submitted" || purged.outcome !== "submitted") {
      throw new Error("Both submissions should have been saved.");
    }
    await as(OWNER, () =>
      deleteDocument.deleteDocumentRecursive(
        getDb(),
        purged.receipt.record.documentId,
        OWNER,
      ),
    );
    await expect(receiptsOf(ids)).resolves.toEqual([
      expect.objectContaining({ id: kept.receipt.receiptId }),
    ]);
  });
});
