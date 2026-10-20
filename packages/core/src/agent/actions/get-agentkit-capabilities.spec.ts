import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("../../agentkit/capabilities.js", () => ({
  listAgentKitCapabilities: mocks.list,
}));

import action from "./get-agentkit-capabilities.js";

describe("get-agentkit-capabilities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an authenticated Design or Slides app context", async () => {
    await expect(action.run({}, { appId: "design" })).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "unauthorized",
    });
    await expect(
      action.run({}, { appId: "templates", userEmail: "a@example.test" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "agentkit_capabilities_unsupported_app",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("derives app scope from the authenticated runtime and returns safe metadata", async () => {
    const result = {
      sources: { figma: { available: true } },
      integrations: [{ id: "github", label: "GitHub", kind: "provider-api" }],
    };
    mocks.list.mockResolvedValue(result);

    await expect(
      action.run(
        {},
        {
          appId: "design",
          userEmail: "member@example.test",
          orgId: "org-1",
        },
      ),
    ).resolves.toEqual(result);
    expect(mocks.list).toHaveBeenCalledWith("design", {
      userEmail: "member@example.test",
      orgId: "org-1",
    });
    expect(action).toMatchObject({
      agentTool: false,
      toolCallable: false,
      http: { method: "GET" },
      readOnly: true,
    });
  });
});
