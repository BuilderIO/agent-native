import { beforeEach, describe, expect, it, vi } from "vitest";

import { noteJobFrontmatterWrite } from "./frontmatter-loss.js";

const recordMock = vi.hoisted(() => vi.fn());
const getRunContextMock = vi.hoisted(() => vi.fn());
const getUserEmailMock = vi.hoisted(() => vi.fn());

vi.mock("../audit/org-admin.js", () => ({
  recordOrgAdminAuditEvent: recordMock,
}));
vi.mock("../server/request-context.js", () => ({
  getRequestRunContext: getRunContextMock,
  getRequestUserEmail: getUserEmailMock,
}));

const full = [
  "---",
  'schedule: "*/5 * * * *"',
  "enabled: true",
  "source: slack",
  "slackChannelId: C123",
  "displayName: slack-feedback",
  "---",
  "",
  "Body",
].join("\n");
const stripped = [
  "---",
  'schedule: "*/5 * * * *"',
  "enabled: true",
  "---",
  "",
  "Body",
].join("\n");

function write(
  overrides: Partial<Parameters<typeof noteJobFrontmatterWrite>[0]> = {},
) {
  return noteJobFrontmatterWrite({
    owner: "__organization__:org-1",
    orgId: "org-1",
    path: "jobs/factories/f1/factory-slack-feedback.md",
    before: full,
    after: stripped,
    writer: "resourcePut",
    ...overrides,
  });
}

describe("noteJobFrontmatterWrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    getRunContextMock.mockReturnValue(undefined);
    getUserEmailMock.mockReturnValue(undefined);
    recordMock.mockResolvedValue(undefined);
  });

  it("records the dropped fields with the writer and the agent run that made the write", async () => {
    getRunContextMock.mockReturnValue({ threadId: "thread-9", runId: "run-9" });
    getUserEmailMock.mockReturnValue("alice@example.com");

    await write();

    expect(recordMock).toHaveBeenCalledTimes(1);
    const event = recordMock.mock.calls[0][0];
    expect(event).toMatchObject({
      action: "job-fields-dropped",
      targetType: "job-file",
      targetId: "jobs/factories/f1/factory-slack-feedback.md",
      orgId: "org-1",
      userEmail: "alice@example.com",
      caller: "tool",
      threadId: "thread-9",
      runId: "run-9",
    });
    expect(event.summary).toContain("source, slackChannelId, displayName");
    expect(event.args).toMatchObject({
      writer: "resourcePut",
      droppedKeys: ["source", "slackChannelId", "displayName"],
    });
    expect(Array.isArray(event.args.callers)).toBe(true);
  });

  it("attributes a write with no request to the system", async () => {
    await write({ writer: "resourcePutIfCurrent" });

    expect(recordMock.mock.calls[0][0]).toMatchObject({
      caller: "automation",
      userEmail: undefined,
    });
  });

  it("logs the loss even when the audit row cannot be written", async () => {
    recordMock.mockRejectedValue(new Error("audit store down"));

    await expect(write()).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "lost frontmatter fields (source, slackChannelId, displayName)",
      ),
      expect.any(Array),
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("records nothing when no configuration was lost", async () => {
    await write({ after: full.replace("enabled: true", "enabled: false") });
    expect(recordMock).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("ignores paths outside jobs/", async () => {
    await write({ path: "notes/factory.md" });
    expect(recordMock).not.toHaveBeenCalled();
  });
});
