import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { runWithClientIp } from "../server/client-ip.js";
import { getDb, schema } from "../server/db/index.js";
import { blankFormBlocks, questionBlocks } from "../shared/form-model/index.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import {
  FORM_UPLOADS_PER_MINUTE,
  IP_UPLOADS_PER_MINUTE,
  MAX_FILES_PER_SUBMISSION,
  SESSION_UPLOADS_PER_MINUTE,
  logUpload,
  uploadRefusal,
} from "./_upload-storage.js";
import createForm from "./create-form.js";
import getFormUploadStatus from "./get-form-upload-status.js";
import publishForm from "./publish-form.js";
import updateSettings from "./update-form-settings.js";
import uploadFormFile from "./upload-form-file.js";

const mocks = vi.hoisted(() => ({
  provider: true,
  uploaders: [] as Array<string | undefined>,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: async () =>
    mocks.provider ? { id: "test" } : null,
  uploadFile: async () => {
    mocks.uploaders.push(
      (
        await import("@agent-native/core/server/request-context")
      ).getRequestUserEmail(),
    );
    return mocks.provider ? { url: "https://cdn.example.test/a.pdf" } : null;
  },
}));

const blocks = [
  ...blankFormBlocks(),
  ...questionBlocks({
    id: "file",
    type: "FILE_UPLOAD",
    title: "File",
    settings: { maxSizeMb: 1, allowedTypes: ["application/pdf", "image/*"] },
  }),
  ...questionBlocks({ id: "sign", type: "SIGNATURE", title: "Sign" }),
  ...questionBlocks({ id: "name", type: "INPUT_TEXT", title: "Name" }),
];

async function publishedForm(content = blocks) {
  const { id } = await as(owner, () => createForm.run({}));
  await as(owner, () => publishForm.run({ id, blocks: content }));
  return id;
}

const pdf = (bytes = 10) => Buffer.alloc(bytes).toString("base64");

const upload = (
  formId: string,
  overrides: Partial<Parameters<typeof uploadFormFile.run>[0]> = {},
) =>
  uploadFormFile.run({
    formId,
    questionId: "file",
    sessionId: `${formId}-s1`,
    filename: "cv.pdf",
    contentType: "application/pdf",
    data: pdf(),
    ...overrides,
  });

describe("respondent uploads", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(() => {
    mocks.provider = true;
    mocks.uploaders = [];
  });

  it("stores an anonymous respondent's file as the form owner", async () => {
    const id = await publishedForm();
    expect(getRequestUserEmail()).toBeUndefined();
    await expect(upload(id)).resolves.toEqual({
      url: "https://cdn.example.test/a.pdf",
    });
    expect(mocks.uploaders).toEqual([owner.userEmail]);
  });

  it("refuses files over the question's size or outside its types", async () => {
    const id = await publishedForm();
    await expect(upload(id, { data: pdf(1024 * 1024 + 1) })).rejects.toThrow(
      /at most 1 MB/,
    );
    await expect(upload(id, { contentType: "text/plain" })).rejects.toThrow(
      /type/,
    );
    await expect(
      upload(id, { questionId: "sign", contentType: "image/jpeg" }),
    ).rejects.toThrow(/type/);
    expect(mocks.uploaders).toEqual([]);
  });

  it("says uploads aren't available when the owner has no storage", async () => {
    const id = await publishedForm();
    mocks.provider = false;
    await expect(upload(id)).rejects.toThrow(/aren't available/);
    await expect(getFormUploadStatus.run({ formId: id })).resolves.toEqual({
      state: "unavailable",
    });
  });

  it("reports available storage, and none for a form without file questions", async () => {
    const withFile = await publishedForm();
    const plain = await publishedForm([
      ...blankFormBlocks(),
      ...questionBlocks({ id: "name", type: "INPUT_TEXT", title: "Name" }),
    ]);
    await expect(
      getFormUploadStatus.run({ formId: withFile }),
    ).resolves.toEqual({ state: "available" });
    await expect(getFormUploadStatus.run({ formId: plain })).resolves.toEqual({
      state: "none",
    });
    await expect(upload(plain, { questionId: "name" })).rejects.toThrow();
  });

  it("refuses uploads to a draft or closed form", async () => {
    const draft = (await as(owner, () => createForm.run({}))).id;
    await expect(upload(draft)).rejects.toThrow();

    const closed = await publishedForm();
    await getDb()
      .update(schema.forms)
      .set({ isClosed: true })
      .where(eq(schema.forms.id, closed));
    await expect(upload(closed)).rejects.toThrow(/closed/);
    await expect(getFormUploadStatus.run({ formId: closed })).resolves.toEqual({
      state: "none",
    });
  });

  it("limits uploads per session and per form each minute", async () => {
    const id = await publishedForm();
    const db = getDb();
    const now = Date.now();
    for (let i = 0; i < SESSION_UPLOADS_PER_MINUTE; i++)
      await logUpload(db, id, "busy", null, now);
    expect(await uploadRefusal(db, id, "busy", null, now)).toBe("slow_down");
    expect(await uploadRefusal(db, id, "calm", null, now)).toBeNull();
    expect(await uploadRefusal(db, id, "busy", null, now + 61_000)).toBeNull();

    for (let i = 0; i < FORM_UPLOADS_PER_MINUTE; i++)
      await logUpload(db, id, `other-${i}`, null, now);
    expect(await uploadRefusal(db, id, "calm", null, now)).toBe("slow_down");
  });

  it("limits uploads per client address even when the session id changes", async () => {
    const id = await publishedForm();
    const db = getDb();
    const now = Date.now();
    for (let i = 0; i < IP_UPLOADS_PER_MINUTE; i++)
      await logUpload(db, id, `rotating-${i}`, "ip-a", now);
    expect(await uploadRefusal(db, id, "fresh", "ip-a", now)).toBe("slow_down");
    expect(await uploadRefusal(db, id, "fresh", "ip-b", now)).toBeNull();
    expect(
      await uploadRefusal(db, id, "fresh", "ip-a", now + 61_000),
    ).toBeNull();
    await expect(
      runWithClientIp("10.9.9.9", async () => {
        for (let i = 0; i < IP_UPLOADS_PER_MINUTE; i++)
          await upload(id, { sessionId: `ip-session-${i}` });
        return upload(id, { sessionId: "ip-session-next" });
      }),
    ).rejects.toThrow(/Too many uploads/);
  });

  it("needs the form password before it takes a file", async () => {
    const id = await publishedForm();
    await as(owner, () =>
      updateSettings.run({
        id,
        settings: { passwordProtected: true },
        password: "open-sesame",
      }),
    );
    await expect(upload(id)).rejects.toThrow(/locked/);
    await expect(upload(id, { password: "wrong" })).rejects.toThrow(/locked/);
    expect(mocks.uploaders).toEqual([]);
    await expect(upload(id, { password: "open-sesame" })).resolves.toEqual({
      url: "https://cdn.example.test/a.pdf",
    });
  });

  it("caps the files one submission can carry", async () => {
    const id = await publishedForm();
    const db = getDb();
    const now = Date.now();
    for (let i = 0; i < MAX_FILES_PER_SUBMISSION; i++)
      await logUpload(db, id, "heavy", null, now - 120_000 - i);
    expect(await uploadRefusal(db, id, "heavy", now)).toBe("too_many_files");
    await expect(upload(id, { sessionId: "heavy" })).rejects.toThrow();
  });
});
