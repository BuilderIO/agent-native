import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/event-bus", () => ({
  subscribe: vi.fn(),
}));

vi.mock("@agent-native/core/notifications", () => ({
  notify: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/resources", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceDeleteByPath: vi.fn(),
  resourceGetByPath: resourceGetByPathMock,
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  WORKSPACE_OWNER: "workspace",
}));

vi.mock("@agent-native/core/server", () => ({
  defineNitroPlugin: () => undefined,
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../lib/factory-automation-repair.js", () => ({
  repairFactoryAutomationsFromConfig: vi.fn(),
}));

import {
  ensureFactoryAutomations,
  factoryAutomationTemplatePrompt,
} from "./factory-scheduler-job.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureFactoryAutomations", () => {
  it("does not create missing seed jobs", async () => {
    resourceGetByPathMock.mockResolvedValue(null);

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "support-triage",
    );

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("keeps the Slack template prompt lean and names the reaction argument", () => {
    const prompt = factoryAutomationTemplatePrompt("slack-feedback", "slack");
    expect(prompt).toContain("reaction robot_face 🤖");
    expect(prompt).toContain("get-slack-feedback-context");
    expect(prompt).toContain("productUxImplications false");
    expect(prompt).toContain("visual/UI defects");
    expect(prompt).not.toContain("limit 20");
    expect(prompt).not.toContain("👀");
  });
});
