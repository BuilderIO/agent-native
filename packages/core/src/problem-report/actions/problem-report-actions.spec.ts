import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../../app-config/index.js";
import type { RecorderEvent, RecorderReport } from "../../client/recorder.js";
import {
  PrivateBlobError,
  registerPrivateBlobProvider,
  setPrivateBlobPublicUploadFallbackEnabled,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
} from "../../private-blob/index.js";
import { runWithRequestContext } from "../../server/request-context.js";
import saveProblemReport from "./save-problem-report.js";

const recordActionAuditMock = vi.hoisted(() => vi.fn());
vi.mock("../../audit/record.js", () => ({
  recordActionAudit: recordActionAuditMock,
}));
vi.mock("../../tracking/failure-counters.js", () => ({
  countAttachmentOutcome: vi.fn(),
}));
vi.mock("../../file-upload/registry.js", () => ({
  deleteUploadedFile: vi.fn(),
  getActiveFileUploadProviderForRequest: vi.fn(async () => null),
  uploadFile: vi.fn(async () => null),
}));

const ALICE = "alice@example.com";
const originalEnv = { ...process.env };

class MemoryProvider implements PrivateBlobProvider {
  id = "memory";
  name = "Memory";
  blobs = new Map<string, Uint8Array>();
  isConfigured = () => true;
  put = async (input: { data: Uint8Array | Buffer }) => {
    const id = `memory:${this.blobs.size + 1}`;
    this.blobs.set(id, new Uint8Array(input.data));
    return { id, provider: this.id, opaque: true as const, encrypted: false };
  };
  read = async (handle: PrivateBlobHandle) => {
    const data = this.blobs.get(handle.id);
    if (!data) throw new PrivateBlobError("missing", "not_found");
    return { data, handle };
  };
  delete = async (handle: PrivateBlobHandle) => ({
    deleted: this.blobs.delete(handle.id),
    provider: this.id,
  });
}

let provider: MemoryProvider;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    SECRETS_ENCRYPTION_KEY: "problem-report-key",
  };
  resetAppConfigForTests();
  provider = new MemoryProvider();
  registerPrivateBlobProvider(provider);
  setPrivateBlobPublicUploadFallbackEnabled(false);
  recordActionAuditMock.mockReset();
});

afterEach(() => {
  unregisterPrivateBlobProvider("memory");
  setPrivateBlobPublicUploadFallbackEnabled(true);
  process.env = { ...originalEnv };
  resetAppConfigForTests();
});

const as = <T>(userEmail: string, orgId: string, fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail, orgId }, fn);

function event(overrides: Partial<RecorderEvent>): RecorderEvent {
  return { t: -1, at: 1, type: "action", ...overrides };
}

const REPORT: RecorderReport = {
  app: "mail",
  build: "abc123",
  url: "/inbox",
  at: "2026-10-14T16:20:05.120Z",
  reason: "user",
  windowSeconds: 120,
  events: [
    event({ t: -40, type: "nav", name: "/inbox" }),
    event({ t: -12, type: "state", name: "selection", data: { id: "m1" } }),
    event({ t: -0.8, name: "list-labels", ok: true, ms: 12 }),
    event({
      t: -0.8,
      name: "list-folders",
      ok: false,
      status: 403,
      errorCode: "forbidden_scope",
    }),
  ],
  watched: { inspector: { shown: "91%" } },
  pending: [{ type: "action", name: "save-file", ageMs: 1200 }],
  dropped: 0,
};

async function saveAsAlice(report: RecorderReport = REPORT): Promise<string> {
  const { ref } = await as(ALICE, "org-one", () =>
    saveProblemReport.run({ report }),
  );
  return ref;
}

describe("save-problem-report", () => {
  it("stores the report as a private blob and keeps it out of the audit input copy", async () => {
    const ref = await saveAsAlice();

    expect(ref).toMatch(/^attachment:v1:/);
    const [stored] = [...provider.blobs.values()];
    expect(JSON.parse(Buffer.from(stored).toString("utf8"))).toEqual(REPORT);
    expect(recordActionAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ config: { recordInputs: false } }),
    );
  });

  it("fails with the typed storage error instead of returning a ref when storage is down", async () => {
    unregisterPrivateBlobProvider("memory");

    await expect(saveAsAlice()).rejects.toMatchObject({
      errorCode: "attachment_storage_unavailable",
      statusCode: 503,
    });
  });
});
