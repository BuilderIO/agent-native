import type { ActionRunContext } from "@agent-native/core/action";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordTripwireMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const readNavigationMock = vi.hoisted(() => vi.fn());

vi.mock("../tripwire/index.js", async (importActual) => ({
  ...(await importActual<typeof import("../tripwire/index.js")>()),
  recordTripwire: recordTripwireMock,
}));
vi.mock("./factory-definitions.js", () => ({
  readFactoryDefinition: readFactoryDefinitionMock,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: readNavigationMock,
}));
vi.mock("./factory-workflow-context.js", () => ({
  isAgentCaller: (context: ActionRunContext | undefined) =>
    context?.caller === "tool",
}));

import {
  SLOW_TOOL_WARN_MS,
  watchAgentCall,
} from "./factory-workflow-tripwires.js";

const agent = { caller: "tool", orgId: "org-1" } as ActionRunContext;

const refusal = (errorCode: string, statusCode = 404) =>
  Object.assign(new Error(errorCode), {
    actionContractError: true,
    errorCode,
    statusCode,
  });

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  recordTripwireMock.mockReset();
  readFactoryDefinitionMock.mockReset();
  readNavigationMock.mockReset();
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a refused agent call", () => {
  it("records nothing under a factory id it never verified, however many the caller makes up", async () => {
    for (let index = 0; index < 300; index += 1) {
      await expect(
        watchAgentCall(
          {
            action: "run-factory-workflow",
            input: { factoryId: `made-up-${index}` },
            context: agent,
            factoryId: `made-up-${index}`,
          },
          async () => {
            throw refusal("factory_not_found");
          },
        ),
      ).rejects.toMatchObject({ errorCode: "factory_not_found" });
    }

    expect(recordTripwireMock).not.toHaveBeenCalled();
    // The refusal is still in the function log, without the id it was keyed by.
    expect(logged).toHaveBeenCalledTimes(300);
    expect(String(logged.mock.calls[0]?.[0])).not.toContain("made-up");
  });

  it("is recorded under the organization and factory the action verified", async () => {
    await expect(
      watchAgentCall(
        {
          action: "run-factory-workflow",
          input: { factoryId: "support-triage", workflowId: "wf-1" },
          context: agent,
          factoryId: "support-triage",
          workflowId: "wf-1",
        },
        async (watch) => {
          watch.inOrg("org-1");
          throw refusal("workflow_not_found");
        },
      ),
    ).rejects.toMatchObject({ errorCode: "workflow_not_found" });

    expect(recordTripwireMock).toHaveBeenCalledTimes(1);
    expect(recordTripwireMock.mock.calls[0]?.[0]).toMatchObject({
      scope: { orgId: "org-1", factoryId: "support-triage" },
      code: "agent_write_rejected",
      workflowId: "wf-1",
    });
  });
});

describe("a slow agent call", () => {
  function slow() {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(SLOW_TOOL_WARN_MS + 1);
  }

  it("is not recorded before the caller's organization is verified", async () => {
    slow();
    await watchAgentCall(
      {
        action: "save-factory-workflow",
        input: {},
        context: agent,
        factoryId: "made-up",
        slow: true,
      },
      async () => undefined,
    );

    expect(recordTripwireMock).not.toHaveBeenCalled();
  });

  it("names the open factory only when it exists in the organization", async () => {
    readNavigationMock.mockResolvedValue({ factoryId: "made-up" });
    readFactoryDefinitionMock.mockResolvedValue(undefined);
    slow();
    await watchAgentCall(
      {
        action: "describe-workflow-node-catalog",
        input: {},
        context: agent,
        slow: true,
      },
      async (watch) => watch.inOrg("org-1"),
    );

    expect(readFactoryDefinitionMock).toHaveBeenCalledWith("org-1", "made-up");
    expect(recordTripwireMock.mock.calls[0]?.[0]).toMatchObject({
      scope: { orgId: "org-1", factoryId: "product-feedback" },
      details: { factorySource: "default" },
    });

    recordTripwireMock.mockReset();
    readNavigationMock.mockResolvedValue({ factoryId: "support-triage" });
    readFactoryDefinitionMock.mockResolvedValue({ id: "support-triage" });
    slow();
    await watchAgentCall(
      {
        action: "describe-workflow-node-catalog",
        input: {},
        context: agent,
        slow: true,
      },
      async (watch) => watch.inOrg("org-1"),
    );

    expect(recordTripwireMock.mock.calls[0]?.[0]).toMatchObject({
      scope: { orgId: "org-1", factoryId: "support-triage" },
      details: { factorySource: "navigation" },
    });
  });
});
