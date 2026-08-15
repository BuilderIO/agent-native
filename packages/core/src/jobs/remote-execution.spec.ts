import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueRemoteCommandMock = vi.hoisted(() => vi.fn());
const getRemoteCommandMock = vi.hoisted(() => vi.fn());
const getRemoteCommandByIdempotencyKeyMock = vi.hoisted(() => vi.fn());
const getRemoteDeviceForOwnerMock = vi.hoisted(() => vi.fn());
const getRemoteExecutionCapabilitiesMock = vi.hoisted(() => vi.fn());
const finishAutomationRunMock = vi.hoisted(() => vi.fn());
const startAutomationRunMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());

vi.mock("../integrations/remote-commands-store.js", () => ({
  enqueueRemoteCommand: enqueueRemoteCommandMock,
  getRemoteCommand: getRemoteCommandMock,
  getRemoteCommandByIdempotencyKey: getRemoteCommandByIdempotencyKeyMock,
}));

vi.mock("../integrations/remote-devices-store.js", () => ({
  getRemoteDeviceForOwner: getRemoteDeviceForOwnerMock,
  getRemoteExecutionCapabilities: getRemoteExecutionCapabilitiesMock,
}));

vi.mock("./run-history.js", () => ({
  finishAutomationRun: finishAutomationRunMock,
  startAutomationRun: startAutomationRunMock,
}));

vi.mock("../resources/store.js", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

import type { Resource } from "../resources/store.js";
import { buildJobResourceContent, type JobFrontmatter } from "./frontmatter.js";
import {
  dispatchRemoteAutomation,
  getRemoteAutomationStatus,
} from "./remote-execution.js";

function makeResource(meta: JobFrontmatter): Resource {
  return {
    id: "resource-1",
    path: "jobs/nightly.md",
    owner: "alice@example.com",
    content: buildJobResourceContent(meta, "Inspect the workspace."),
    mimeType: "text/markdown",
    size: 1,
    createdAt: 1,
    updatedAt: 1,
    createdBy: "user",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

function makeDevice() {
  return {
    id: "remote-device-laptop",
    ownerEmail: "alice@example.com",
    orgId: null,
    label: "Always-on laptop",
    platform: "darwin",
    appVersion: null,
    hostName: "laptop.local",
    metadata: null,
    deviceTokenHash: "hash",
    lastSeenAt: Date.now(),
    status: "active" as const,
    revokedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: "remote-command-1",
    deviceId: "remote-device-laptop",
    ownerEmail: "alice@example.com",
    orgId: null,
    kind: "create-run" as const,
    params: {},
    status: "pending" as const,
    result: null,
    platform: "automation",
    externalThreadId: "automation:nightly",
    idempotencyKey: "remote-request-1",
    attempts: 0,
    nextCheckAt: 1,
    claimedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("remote automation execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRemoteDeviceForOwnerMock.mockResolvedValue(makeDevice());
    getRemoteExecutionCapabilitiesMock.mockReturnValue({
      backend: "desktop",
      workloads: ["code-agent", "scheduled-code"],
      engines: ["codex-cli", "claude-cli"],
      acceptsScheduledWork: true,
      persistence: "local-files",
    });
    startAutomationRunMock.mockResolvedValue("automation-run-1");
    finishAutomationRunMock.mockResolvedValue(undefined);
    enqueueRemoteCommandMock.mockResolvedValue(makeCommand());
  });

  it("rejects a selected host that does not advertise scheduled work", async () => {
    getRemoteExecutionCapabilitiesMock.mockReturnValue({
      backend: "desktop",
      workloads: ["code-agent"],
      acceptsScheduledWork: false,
    });
    const resource = makeResource({
      schedule: "0 * * * *",
      enabled: true,
      lastRun: "2026-08-15T12:00:00.000Z",
      lastStatus: "running",
      executionHostId: "remote-device-laptop",
    });

    await expect(
      dispatchRemoteAutomation({
        resource,
        meta: {
          schedule: "0 * * * *",
          enabled: true,
          lastRun: "2026-08-15T12:00:00.000Z",
          lastStatus: "running",
          executionHostId: "remote-device-laptop",
        },
        body: "Inspect the workspace.",
        ownerEmail: "alice@example.com",
        prompt: "Run it.",
        title: "Nightly",
      }),
    ).rejects.toThrow(/does not accept scheduled work/);
    expect(enqueueRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("uses one stable request key across a dispatch retry", async () => {
    let current = makeResource({
      schedule: "0 * * * *",
      enabled: true,
      lastRun: "2026-08-15T12:00:00.000Z",
      lastStatus: "running",
      executionHostId: "remote-device-laptop",
    });
    resourceGetByPathMock.mockImplementation(async () => current);
    resourcePutIfCurrentMock.mockImplementation(async (input) => {
      current = {
        ...current,
        content: input.content,
        updatedAt: current.updatedAt + 1,
      };
      return current;
    });

    const input = {
      resource: current,
      meta: {
        schedule: "0 * * * *",
        enabled: true,
        lastRun: "2026-08-15T12:00:00.000Z",
        lastStatus: "running" as const,
        executionHostId: "remote-device-laptop",
      },
      body: "Inspect the workspace.",
      ownerEmail: "alice@example.com",
      prompt: "Run it.",
      title: "Nightly",
    };

    await dispatchRemoteAutomation(input);
    await dispatchRemoteAutomation({ ...input, resource: current });

    expect(startAutomationRunMock).toHaveBeenCalledTimes(1);
    expect(enqueueRemoteCommandMock).toHaveBeenCalledTimes(2);
    expect(enqueueRemoteCommandMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        idempotencyKey:
          "remote-automation:alice@example.com:jobs/nightly.md:2026-08-15T12:00:00.000Z",
      }),
    );
    expect(enqueueRemoteCommandMock.mock.calls[1]?.[0].idempotencyKey).toBe(
      enqueueRemoteCommandMock.mock.calls[0]?.[0].idempotencyKey,
    );
    expect(current.content).toContain('remoteCommandId: "remote-command-1"');
  });

  it("keeps a running relay command active and recognizes a terminal run", async () => {
    const meta: JobFrontmatter = {
      schedule: "0 * * * *",
      enabled: true,
      lastRun: "2026-08-15T12:00:00.000Z",
      lastStatus: "running",
      executionHostId: "remote-device-laptop",
      remoteRequestId: "remote-request-1",
      remoteCommandId: "remote-command-1",
    };
    getRemoteCommandMock.mockResolvedValueOnce(
      makeCommand({ status: "running" }),
    );
    await expect(
      getRemoteAutomationStatus({
        meta,
        ownerEmail: "alice@example.com",
      }),
    ).resolves.toMatchObject({ state: "active" });

    getRemoteCommandMock.mockResolvedValueOnce(
      makeCommand({
        status: "completed",
        result: {
          ok: true,
          run: { id: "run-1", status: "completed" },
        },
      }),
    );
    await expect(
      getRemoteAutomationStatus({
        meta,
        ownerEmail: "alice@example.com",
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });
});
