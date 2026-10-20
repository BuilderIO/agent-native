import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const resourceDeleteByPathMock = vi.hoisted(() => vi.fn());
const recordAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/resources", () => ({
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  resourceDeleteByPath: resourceDeleteByPathMock,
}));
vi.mock("../triage/audit.js", () => ({
  recordFactoryGovernanceAudit: recordAuditMock,
}));

import type { FactoryAutomationDefinition } from "./factory-automation-resources.js";
import {
  LEGACY_JOB_PAUSE_REASON,
  retireLegacyAgentJobs,
} from "./factory-legacy-agent-jobs.js";

const OWNER = "__organization__:org-1";
const identity = { userEmail: "owner@example.com", orgId: "org-1" };
const NOW = new Date("2026-10-19T12:00:00.000Z");

const SLACK_JOB = `---
schedule: "*/5 * * * *"
enabled: true
triggerType: schedule
domain: factory
appId: factory
orgId: org-1
factoryId: f1
createdBy: owner@example.com
runAs: creator
template: slack-feedback
source: slack
---
Call get-slack-feedback-context for each item, then dispatch-factory-item.
`;

const files = new Map<string, { id: string; content: string; rev: number }>();

function definition(
  leaf: string,
  content: string,
): FactoryAutomationDefinition {
  const path = `jobs/factories/f1/${leaf}.md`;
  files.set(path, { id: `res-${leaf}`, content, rev: 1 });
  const { meta, body } = parseJobResource(content);
  return {
    name: `factories/f1/${leaf}`,
    resource: {
      id: `res-${leaf}`,
      path,
      owner: OWNER,
      content,
    } as FactoryAutomationDefinition["resource"],
    meta,
    body,
  };
}

const retire = (definitions: FactoryAutomationDefinition[]) =>
  retireLegacyAgentJobs({
    identity,
    factoryId: "f1",
    definitions,
    now: () => NOW,
  });

const stored = (leaf: string) =>
  files.get(`jobs/factories/f1/${leaf}.md`)!.content;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  files.clear();
  recordAuditMock.mockResolvedValue(undefined);
  resourceGetByPathMock.mockImplementation(
    async (_owner: string, path: string) => {
      const file = files.get(path);
      return file
        ? {
            id: file.id,
            path,
            owner: OWNER,
            content: file.content,
            updatedAt: file.rev,
          }
        : null;
    },
  );
  resourcePutIfCurrentMock.mockImplementation(
    async (input: {
      path: string;
      content: string;
      expectedContent: string;
    }) => {
      const file = files.get(input.path);
      if (!file || file.content !== input.expectedContent) return null;
      file.content = input.content;
      file.rev += 1;
      return { id: file.id };
    },
  );
});

describe("retireLegacyAgentJobs", () => {
  it("pauses a seeded job that still names a removed action, keeps the file, and says why", async () => {
    const job = definition("factory-slack-feedback", SLACK_JOB);

    const result = await retire([job]);

    expect(result.retired).toEqual(["factories/f1/factory-slack-feedback"]);
    expect(result.failed).toEqual([]);
    const { meta, body } = parseJobResource(stored("factory-slack-feedback"));
    expect(meta).toMatchObject({
      enabled: false,
      lastStatus: "paused",
      pausedReason: LEGACY_JOB_PAUSE_REASON,
      pausedAt: NOW.toISOString(),
      createdBy: "owner@example.com",
      schedule: "*/5 * * * *",
    });
    expect(meta.lastError).toMatch(/^Replaced by workflows\./);
    expect(stored("factory-slack-feedback")).toContain(
      `retiredAt: ${NOW.toISOString()}`,
    );
    expect(body).toContain("Call get-slack-feedback-context");
    expect(resourceDeleteByPathMock).not.toHaveBeenCalled();
    expect(result.definitions[0]?.meta).toMatchObject({
      enabled: false,
      pausedReason: LEGACY_JOB_PAUSE_REASON,
    });
  });

  it("records one audit event for each job it pauses", async () => {
    await retire([definition("factory-slack-feedback", SLACK_JOB)]);

    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        action: "retire-legacy-agent-job",
        kind: "governance",
        status: "success",
        factoryId: "f1",
        summary:
          "Paused factories/f1/factory-slack-feedback: replaced by workflows.",
        details: expect.objectContaining({
          path: "jobs/factories/f1/factory-slack-feedback.md",
          pausedReason: LEGACY_JOB_PAUSE_REASON,
        }),
      }),
    );
  });

  it("pauses each retired seed name, and a suffixed copy of one", async () => {
    const leaves = [
      "factory-slack-feedback",
      "factory-sentry-errors",
      "factory-github-issues",
      "factory-pr-babysit",
      "factory-pr-babysit-2",
    ];

    const result = await retire(
      leaves.map((leaf) => definition(leaf, SLACK_JOB)),
    );

    expect(result.retired).toEqual(
      leaves.map((leaf) => `factories/f1/${leaf}`),
    );
    expect(recordAuditMock).toHaveBeenCalledTimes(leaves.length);
  });

  it("pauses once: a second read finds it paused and writes nothing", async () => {
    const first = await retire([
      definition("factory-slack-feedback", SLACK_JOB),
    ]);
    vi.clearAllMocks();

    const second = await retire(first.definitions);

    expect(second.retired).toEqual([]);
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("does not pause again a job its owner enabled after the pause", async () => {
    const first = await retire([
      definition("factory-slack-feedback", SLACK_JOB),
    ]);
    const reenabled = definition(
      "factory-slack-feedback",
      stored("factory-slack-feedback").replace(
        "enabled: false",
        "enabled: true",
      ),
    );
    vi.clearAllMocks();

    const second = await retire([reenabled]);

    expect(first.retired).toHaveLength(1);
    expect(second.retired).toEqual([]);
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("never touches a job that is already disabled", async () => {
    const job = definition(
      "factory-slack-feedback",
      SLACK_JOB.replace("enabled: true", "enabled: false"),
    );

    const result = await retire([job]);

    expect(result.retired).toEqual([]);
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("never touches a user's custom job, even one that names a removed action", async () => {
    const custom = definition("factory-slack-my-alerts", SLACK_JOB);
    const renamed = definition("weekly-digest", SLACK_JOB);

    const result = await retire([custom, renamed]);

    expect(result.retired).toEqual([]);
    expect(result.definitions).toEqual([custom, renamed]);
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("never touches a seeded job a person rewrote to stop naming removed actions", async () => {
    const job = definition(
      "factory-slack-feedback",
      SLACK_JOB.replace(
        "Call get-slack-feedback-context for each item, then dispatch-factory-item.",
        "Summarize new Slack messages for the team.",
      ),
    );

    const result = await retire([job]);

    expect(result.retired).toEqual([]);
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("never touches a workflow job, however it is named or worded", async () => {
    const workflowJob = SLACK_JOB.replace(
      "source: slack",
      "source: slack\nrunner: workflow",
    );

    const result = await retire([
      definition("factory-slack-feedback", workflowJob),
      definition("factory-pr-babysit-2", workflowJob),
    ]);

    expect(result.retired).toEqual([]);
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("re-checks the live file before writing, so a job a person just edited is left alone", async () => {
    const job = definition("factory-slack-feedback", SLACK_JOB);
    files.set("jobs/factories/f1/factory-slack-feedback.md", {
      id: "res-factory-slack-feedback",
      content: SLACK_JOB.replace("enabled: true", "enabled: false"),
      rev: 2,
    });

    const result = await retire([job]);

    expect(result.retired).toEqual([]);
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("does not report a pause the write lost to a concurrent change", async () => {
    const job = definition("factory-slack-feedback", SLACK_JOB);
    resourcePutIfCurrentMock.mockResolvedValue(null);

    const result = await retire([job]);

    expect(result.retired).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.definitions).toEqual([job]);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("skips a job that was deleted since it was listed", async () => {
    const job = definition("factory-slack-feedback", SLACK_JOB);
    files.delete("jobs/factories/f1/factory-slack-feedback.md");

    const result = await retire([job]);

    expect(result.retired).toEqual([]);
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("reports a failed pause by name and keeps going with the other jobs", async () => {
    const broken = definition("factory-slack-feedback", SLACK_JOB);
    const fine = definition("factory-pr-babysit", SLACK_JOB);
    resourcePutIfCurrentMock.mockImplementationOnce(async () => {
      throw new Error("db unavailable");
    });

    const result = await retire([broken, fine]);

    expect(result.retired).toEqual(["factories/f1/factory-pr-babysit"]);
    expect(result.failed).toEqual([
      {
        path: "jobs/factories/f1/factory-slack-feedback.md",
        stage: "pause",
        message: "db unavailable",
      },
    ]);
    expect(result.definitions[0]).toBe(broken);
    expect(
      parseJobResource(stored("factory-slack-feedback")).meta.enabled,
    ).toBe(true);
  });

  it("keeps the pause but reports it when the audit event cannot be written", async () => {
    recordAuditMock.mockRejectedValue(new Error("audit table locked"));

    const result = await retire([
      definition("factory-slack-feedback", SLACK_JOB),
    ]);

    expect(result.retired).toEqual(["factories/f1/factory-slack-feedback"]);
    expect(result.failed).toEqual([
      {
        path: "jobs/factories/f1/factory-slack-feedback.md",
        stage: "audit",
        message: "audit table locked",
      },
    ]);
    expect(
      parseJobResource(stored("factory-slack-feedback")).meta.enabled,
    ).toBe(false);
  });

  it("does not write, or report a pause, for a file it cannot rewrite as frontmatter", async () => {
    const crlf = SLACK_JOB.replace(/\n/g, "\r\n");
    const job = definition("factory-slack-feedback", crlf);

    const result = await retire([job]);

    expect(result.retired).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ stage: "pause" });
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("reads nothing when the factory has no retired job", async () => {
    const result = await retire([
      definition("factory-pr-governance", SLACK_JOB),
      definition("nightly", SLACK_JOB),
    ]);

    expect(result.retired).toEqual([]);
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
  });
});
