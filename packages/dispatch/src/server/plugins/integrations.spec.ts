import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createIntegrationsPlugin: vi.fn(),
  integrationsPlugin: vi.fn(),
  getDispatchConfig: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  createIntegrationsPlugin: mocks.createIntegrationsPlugin,
}));

vi.mock("../../actions/index.js", () => ({
  dispatchActions: { ask_app: {} },
}));

vi.mock("../index.js", () => ({
  getDispatchConfig: mocks.getDispatchConfig,
}));

vi.mock("../lib/dispatch-integrations.js", () => ({
  beforeDispatchProcess: vi.fn(),
  resolveDispatchExecutionContext: vi.fn(),
}));

describe("Dispatch integrations plugin", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createIntegrationsPlugin.mockReset();
    mocks.integrationsPlugin.mockReset();
    mocks.getDispatchConfig.mockReset();
    mocks.createIntegrationsPlugin.mockReturnValue(mocks.integrationsPlugin);
    mocks.getDispatchConfig.mockReturnValue({});
  });

  it("routes delegation from the prompt resource context without a peer roster", async () => {
    const { default: dispatchIntegrationsPlugin } =
      await import("./integrations.js");
    const nitroApp = {};

    await dispatchIntegrationsPlugin(nitroApp);

    expect(mocks.createIntegrationsPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "dispatch",
        systemPrompt: expect.stringContaining(
          'search with describe-workspace-apps query="<capability>"',
        ),
      }),
    );
    const options = mocks.createIntegrationsPlugin.mock.calls[0][0];
    expect(options.systemPrompt).not.toContain(
      "Apps you can delegate to include",
    );
    expect(options.systemPrompt).toContain("the relevant-apps context");
    expect(options.systemPrompt).not.toContain("available-apps context");
    expect(options.systemPrompt).not.toContain("slides (decks/presentations)");
    expect(mocks.integrationsPlugin).toHaveBeenCalledWith(nitroApp);
  });
});
