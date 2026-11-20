import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithClientIp } from "../server/client-ip.js";
import { getDb, schema } from "../server/db/index.js";
import type { FormSettings } from "../shared/form-contract.js";
import { createBlock, questionBlocks } from "../shared/form-model/index.js";
import { retentionCutoff, trashExpiredSubmissions } from "./_collection.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import getPublicForm from "./get-public-form.js";
import publishForm from "./publish-form.js";
import submitResponse from "./submit-response.js";
import unlockForm from "./unlock-form.js";
import updateSettings from "./update-form-settings.js";

const blocks = () => [
  createBlock("FORM_TITLE", { text: "Collect" }, { uuid: "form-title" }),
  ...questionBlocks({ id: "q-email", type: "INPUT_EMAIL", title: "Email" }),
];

async function formWith(settings: FormSettings, password?: string) {
  const { id } = await as(owner, () => createForm.run({}));
  await as(owner, () => publishForm.run({ id, blocks: blocks() }));
  await as(owner, () =>
    updateSettings.run({
      id,
      settings,
      ...(password ? { password } : {}),
    }),
  );
  return id;
}

const submit = (
  formId: string,
  sessionId: string,
  email: string,
  extra: { respondentId?: string; password?: string } = {},
) =>
  submitResponse.run({
    formId,
    sessionId,
    respondentId: extra.respondentId ?? `respondent-${sessionId}`,
    answers: { "q-email": email },
    isCompleted: true,
    ...(extra.password === undefined ? {} : { password: extra.password }),
  });

describe("collection settings", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("keeps blocks and the hash out of a locked form and rechecks the password on submit", async () => {
    const id = await formWith({ passwordProtected: true }, "open-sesame");
    const locked = await getPublicForm.run({ formId: id });
    expect(locked.state).toBe("locked");
    expect(JSON.stringify(locked)).not.toContain("q-email");
    expect(JSON.stringify(locked)).not.toContain("scrypt");

    expect((await unlockForm.run({ formId: id, password: "nope" })).state).toBe(
      "locked",
    );
    const open = await unlockForm.run({ formId: id, password: "open-sesame" });
    expect(open.state).toBe("open");

    expect(await submit(id, "session-gate-1", "a@example.test")).toMatchObject({
      ok: false,
      reason: "locked",
    });
    expect(
      await submit(id, "session-gate-2", "a@example.test", {
        password: "open-sesame",
      }),
    ).toMatchObject({ ok: true });

    const [row] = await getDb()
      .select({ hash: schema.forms.passwordHash })
      .from(schema.forms)
      .where(eq(schema.forms.id, id));
    expect(row?.hash).toMatch(/^scrypt:/);
    expect(row?.hash).not.toContain("open-sesame");
  });

  it("refuses turning the gate on without a password and drops the hash when it is turned off", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await expect(
      as(owner, () =>
        updateSettings.run({ id, settings: { passwordProtected: true } }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_input" });
    await as(owner, () =>
      updateSettings.run({
        id,
        settings: { passwordProtected: true },
        password: "pw",
      }),
    );
    await as(owner, () =>
      updateSettings.run({ id, settings: { passwordProtected: false } }),
    );
    const [row] = await getDb()
      .select({ hash: schema.forms.passwordHash })
      .from(schema.forms)
      .where(eq(schema.forms.id, id));
    expect(row?.hash).toBeNull();
  });

  it("refuses a second submission with the same field value but accepts a retry of the first", async () => {
    const id = await formWith({
      preventDuplicates: true,
      uniqueSubmissionKey: "field:q-email",
    });
    expect(await submit(id, "session-dup-1", "dup@example.test")).toMatchObject(
      { ok: true },
    );
    expect(await submit(id, "session-dup-1", "dup@example.test")).toMatchObject(
      { ok: true },
    );
    expect(await submit(id, "session-dup-2", "dup@example.test")).toMatchObject(
      { ok: false, reason: "duplicate" },
    );
    expect(
      await submit(id, "session-dup-3", "other@example.test"),
    ).toMatchObject({ ok: true });
  });

  it("dedupes by respondent id by default and ignores trashed submissions", async () => {
    const id = await formWith({ preventDuplicates: true });
    const first = await submit(id, "session-rid-1", "a@example.test", {
      respondentId: "same-respondent",
    });
    expect(
      await submit(id, "session-rid-2", "b@example.test", {
        respondentId: "same-respondent",
      }),
    ).toMatchObject({ ok: false, reason: "duplicate" });
    if (first.ok)
      await getDb()
        .update(schema.submissions)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(schema.submissions.id, first.submissionId));
    expect(
      await submit(id, "session-rid-3", "b@example.test", {
        respondentId: "same-respondent",
      }),
    ).toMatchObject({ ok: true });
  });

  it("dedupes by client address when the form asks for it", async () => {
    const id = await formWith({
      preventDuplicates: true,
      uniqueSubmissionKey: "ip",
    });
    const from = (ip: string, session: string, email: string) =>
      runWithClientIp(ip, () => submit(id, session, email));
    expect(
      await from("203.0.113.7", "session-ip-1", "a@example.test"),
    ).toMatchObject({ ok: true });
    expect(
      await from("203.0.113.7", "session-ip-2", "b@example.test"),
    ).toMatchObject({ ok: false, reason: "duplicate" });
    expect(
      await from("203.0.113.8", "session-ip-3", "c@example.test"),
    ).toMatchObject({ ok: true });
    const stored = await getDb()
      .select({ key: schema.submissions.dedupeKey })
      .from(schema.submissions)
      .where(eq(schema.submissions.formId, id));
    expect(JSON.stringify(stored)).not.toContain("203.0.113");
  });

  it("lets exactly one of two concurrent submissions with the same key through", async () => {
    const id = await formWith({
      preventDuplicates: true,
      uniqueSubmissionKey: "field:q-email",
    });
    const results = await Promise.all([
      submit(id, "session-race-1", "race@example.test"),
      submit(id, "session-race-2", "race@example.test"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "duplicate" });
    const rows = await getDb()
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(eq(schema.submissions.formId, id));
    expect(rows).toHaveLength(1);
  });

  it("limits wrong password guesses per client and then refuses even the right one", async () => {
    const id = await formWith({ passwordProtected: true }, "open-sesame");
    const guess = (password: string) =>
      unlockForm.run({ formId: id, password, sessionId: "session-guess-1" });
    for (let n = 0; n < 5; n++)
      expect(await guess("nope")).toMatchObject({ state: "locked" });
    expect(await guess("open-sesame")).toMatchObject({
      state: "locked",
      retryAfterSeconds: expect.any(Number),
    });
    expect(
      await submit(id, "session-guess-1", "a@example.test", {
        password: "open-sesame",
      }),
    ).toMatchObject({ ok: false, reason: "throttled" });
    expect(
      await unlockForm.run({
        formId: id,
        password: "open-sesame",
        sessionId: "session-guess-2",
      }),
    ).toMatchObject({ state: "open" });
  });

  it("moves submissions older than the retention period to the Trash, only for forms that opt in", async () => {
    const kept = await formWith({});
    const trimmed = await formWith({
      dataRetention: { enabled: true, value: 2, unit: "day" },
    });
    for (const id of [kept, trimmed])
      await submit(id, `session-ret-${id}`, "old@example.test");
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect(
      await trashExpiredSubmissions(getDb(), later),
    ).toBeGreaterThanOrEqual(1);
    const rows = await getDb()
      .select({
        formId: schema.submissions.formId,
        deletedAt: schema.submissions.deletedAt,
      })
      .from(schema.submissions);
    expect(
      rows.find((row) => row.formId === trimmed)?.deletedAt,
    ).not.toBeNull();
    expect(rows.find((row) => row.formId === kept)?.deletedAt).toBeNull();
  });

  it("counts months and years on the calendar", () => {
    const now = new Date("2026-03-31T00:00:00.000Z");
    expect(retentionCutoff(now, 1, "week").toISOString()).toBe(
      "2026-03-24T00:00:00.000Z",
    );
    expect(retentionCutoff(now, 1, "year").toISOString()).toBe(
      "2025-03-31T00:00:00.000Z",
    );
    expect(retentionCutoff(now, 3, "month").getUTCMonth()).toBe(11);
  });
});
