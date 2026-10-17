// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("loads mobile translation and chat transport with a non-DOM window global", async () => {
  vi.resetModules();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", undefined);

  const localization = await import("./i18n.js");
  expect(localization.AgentNativeI18nProvider).toBeTypeOf("function");
  expect(localization.useT).toBeTypeOf("function");

  const shared = await import("../shared/index.js");
  expect(shared.normalizeConnectRequiredResult).toBeTypeOf("function");

  const transport = await import("./agentkit-chat/transport.js");
  expect(transport.createAgentNativeAgentKitTransport).toBeTypeOf("function");
});

it("reads and subscribes to chat readiness with a non-DOM window global", async () => {
  vi.resetModules();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", undefined);
  const readiness = await import("./agent-engine-readiness.js");
  const fetchStatus = vi.fn(async () => Response.json({ chatEligible: true }));
  const source = {
    statusUrl: "https://mobile.example.test/_agent-native/agent-engine/status",
    fetch: fetchStatus,
  };
  const listener = vi.fn();

  expect(readiness.getAgentEngineReadiness(source)).toBe("unknown");
  const unsubscribe = readiness.subscribeAgentEngineReadiness(listener, {
    source,
  });
  expect(await readiness.ensureAgentEngineReadiness({ source })).toBe(
    "configured",
  );
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  fetchStatus.mockImplementation(async () =>
    Response.json({ chatEligible: false }),
  );
  expect(
    await readiness.ensureAgentEngineReadiness({ source, fresh: true }),
  ).toBe("missing");
  expect(listener).toHaveBeenCalledOnce();
  expect(
    readiness.agentEngineStatusUrlForChatApi(
      "https://mobile.example.test/_agent-native/agent-chat",
    ),
  ).toBe("https://mobile.example.test/_agent-native/agent-engine/status");
});
