import { getDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runWithClientIp } from "../server/client-ip.js";
import { getDb, schema } from "../server/db/index.js";
import type { FormSettings } from "../shared/form-contract.js";
import { createBlock, questionBlocks } from "../shared/form-model/index.js";
import {
  RESPONDENT_MAIL_PER_FORM_DAY,
  RESPONDENT_MAIL_PER_IP_HOUR,
} from "./_notify.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import publishForm from "./publish-form.js";
import submitResponse from "./submit-response.js";
import updateSettings from "./update-form-settings.js";

vi.stubEnv("APP_URL", "https://forms.example.test");
// A deployment that can mail: the transport result is stubbed and the rest of the
// send path (composition, logging, the code itself) is real. The case with no mail
// provider has its own test below.
const transport = vi.hoisted(() => ({ configured: true }));

const sentText = vi.hoisted(() => new Map<string, string>());

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...real,
    isEmailConfigured: () => Promise.resolve(transport.configured),
    sendEmail: (args: Parameters<typeof real.sendEmail>[0]) => {
      sentText.set(args.to, args.text ?? "");
      return real.sendEmail(args);
    },
  };
});

const mailedCode = (to: string) =>
  /\b(\d{6})\b/.exec(sentText.get(to) ?? "")?.[1] ?? "";

const blocks = (verify: boolean) => [
  createBlock("FORM_TITLE", { text: "Notify" }, { uuid: "form-title" }),
  ...questionBlocks({
    id: "q-email",
    type: "INPUT_EMAIL",
    title: "Email",
    ...(verify ? { settings: { requireVerification: true } } : {}),
  }),
];

async function formWith(verify: boolean, settings: FormSettings = {}) {
  const { id } = await as(owner, () => createForm.run({}));
  await as(owner, () => publishForm.run({ id, blocks: blocks(verify) }));
  await as(owner, () => updateSettings.run({ id, settings }));
  return id;
}

const submit = (
  formId: string,
  sessionId: string,
  extra: { code?: string; email?: string } = {},
) =>
  submitResponse.run({
    formId,
    sessionId,
    respondentId: `respondent-${sessionId}`,
    answers: { "q-email": extra.email ?? "ada@example.test" },
    isCompleted: true,
    ...(extra.code === undefined ? {} : { verificationCode: extra.code }),
  });

async function mailTo(recipient: string) {
  const { rows } = await getDbExec().execute({
    sql: "SELECT subject FROM email_log WHERE recipient = ? ORDER BY created_at",
    args: [recipient],
  });
  return rows.map((row) => String(row.subject));
}

describe("submission notifications", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("mails the owner and the respondent once, even when the submit is retried", async () => {
    const id = await formWith(false, {
      selfEmail: { enabled: true, to: ["owner-copy@example.test"] },
      respondentEmail: {
        enabled: true,
        toQuestionId: "q-email",
        subject: "Thanks {{answer:q-email}}",
        message: "We got it.",
      },
    });
    const first = await submit(id, "session-notify-1");
    expect(first.ok).toBe(true);
    await submit(id, "session-notify-1");
    expect(await mailTo("owner-copy@example.test")).toEqual([
      "New response: Notify",
    ]);
    expect(await mailTo("ada@example.test")).toEqual([
      "Thanks ada@example.test",
    ]);
  });

  it("sends nothing while both notifications are off", async () => {
    const id = await formWith(false);
    await submit(id, "session-notify-2", { email: "quiet@example.test" });
    expect(await mailTo("quiet@example.test")).toEqual([]);
  });

  it("refuses a respondent notification whose recipient is not an email question", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => publishForm.run({ id, blocks: blocks(false) }));
    await expect(
      as(owner, () =>
        updateSettings.run({
          id,
          settings: {
            respondentEmail: {
              enabled: true,
              toQuestionId: "missing",
              subject: "",
              message: "",
            },
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the owner's recipients out of the public form", async () => {
    const id = await formWith(false, {
      selfEmail: { enabled: true, to: ["private@example.test"] },
    });
    const { default: getPublicForm } = await import("./get-public-form.js");
    const result = await getPublicForm.run({ formId: id });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
  });
});

describe("email verification", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("sends one code, refuses a wrong code and stores nothing", async () => {
    const id = await formWith(true);
    const email = "v1@example.test";
    const asked = await submit(id, "session-verify-1", { email });
    expect(asked).toMatchObject({ ok: false, reason: "verify" });
    const wrong = await submit(id, "session-verify-1", {
      email,
      code: "000000",
    });
    expect(wrong).toMatchObject({ ok: false, reason: "wrong_code" });
    const mail = await mailTo(email);
    expect(mail).toHaveLength(1);
    expect(mailedCode(email)).toMatch(/^\d{6}$/);
    const stored = await getDb().select().from(schema.submissions);
    expect(stored.filter((row) => row.formId === id)).toHaveLength(0);
  });

  it("completes with the mailed code and not before the code is requested", async () => {
    const id = await formWith(true);
    const email = "v2@example.test";
    const early = await submit(id, "session-verify-2", {
      email,
      code: "123456",
    });
    expect(early).toMatchObject({ ok: false, reason: "verify" });
    const code = mailedCode(email);
    expect(await submit(id, "session-verify-2", { email, code })).toMatchObject(
      { ok: true },
    );
  });

  it("locks a code after five wrong tries", async () => {
    const id = await formWith(true);
    const email = "v3@example.test";
    await submit(id, "session-verify-3", { email });
    for (let n = 0; n < 5; n++)
      await submit(id, "session-verify-3", { email, code: "000000" });
    const locked = await submit(id, "session-verify-3", {
      email,
      code: "000000",
    });
    expect(locked).toMatchObject({ ok: false, reason: "code_limit" });
  });

  it("keeps the code out of the email log", async () => {
    const id = await formWith(true);
    const email = "v5@example.test";
    await submit(id, "session-verify-5", { email });
    const code = mailedCode(email);
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await getDbExec().execute({
      sql: "SELECT * FROM email_log WHERE recipient = ?",
      args: [email],
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("refuses instead of promising a code when the deployment cannot send mail", async () => {
    const id = await formWith(true);
    const email = "v6@example.test";
    transport.configured = false;
    try {
      const asked = await submit(id, "session-verify-6", { email });
      expect(asked).toMatchObject({
        ok: false,
        reason: "verify_unavailable",
        verifyEmail: email,
      });
      expect(sentText.get(email)).toBeUndefined();
      const stored = await getDb().select().from(schema.submissions);
      expect(stored.filter((row) => row.formId === id)).toHaveLength(0);
    } finally {
      transport.configured = true;
    }
  });

  it("does not ask when verification is off", async () => {
    const id = await formWith(false);
    expect(await submit(id, "session-verify-4")).toMatchObject({ ok: true });
  });
});

describe("respondent notification caps", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  const respondentMail = {
    respondentEmail: {
      enabled: true,
      toQuestionId: "q-email",
      subject: "Thanks",
      message: "We got it.",
    },
  } satisfies FormSettings;
  const from = (ip: string, formId: string, n: number) =>
    runWithClientIp(ip, () =>
      submit(formId, `session-cap-${ip}-${n}`, {
        email: `cap-${ip}-${n}@example.test`,
      }),
    );
  const mailed = async (formId: string) =>
    (await getDb().select().from(schema.respondentMailLog)).filter(
      (row) => row.formId === formId,
    ).length;

  it("saves the submission and skips the mail past the per-address hourly cap", async () => {
    const id = await formWith(false, respondentMail);
    for (let n = 0; n < RESPONDENT_MAIL_PER_IP_HOUR; n++)
      await from("10.0.0.1", id, n);
    const over = await from("10.0.0.1", id, RESPONDENT_MAIL_PER_IP_HOUR);
    expect(over).toMatchObject({ ok: true });
    expect(await mailed(id)).toBe(RESPONDENT_MAIL_PER_IP_HOUR);
    expect(
      await mailTo(`cap-10.0.0.1-${RESPONDENT_MAIL_PER_IP_HOUR}@example.test`),
    ).toEqual([]);
    expect(await from("10.0.0.2", id, 0)).toMatchObject({ ok: true });
    expect(await mailed(id)).toBe(RESPONDENT_MAIL_PER_IP_HOUR + 1);
  });

  it("caps the mail one form sends in a day across addresses", async () => {
    const id = await formWith(false, respondentMail);
    await getDb()
      .insert(schema.respondentMailLog)
      .values(
        Array.from({ length: RESPONDENT_MAIL_PER_FORM_DAY }, (_, n) => ({
          id: `cap-form-${id}-${n}`,
          formId: id,
          ipHash: `hash-${n}`,
          at: new Date().toISOString(),
        })),
      );
    expect(await from("10.0.1.1", id, 0)).toMatchObject({ ok: true });
    expect(await mailed(id)).toBe(RESPONDENT_MAIL_PER_FORM_DAY);
  });
});
