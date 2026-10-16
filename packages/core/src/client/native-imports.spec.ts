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
