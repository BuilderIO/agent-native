// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BuilderDsiGate } from "./BuilderDsiGate.js";
import { callAction } from "./use-action.js";

const state = vi.hoisted(() => ({
  session: { email: "one@example.test", orgId: "test-org" } as {
    email: string;
    orgId: string;
  } | null,
  status: "authenticated",
  connected: undefined as undefined | (() => Promise<void>),
  retrySession: vi.fn(),
  start: vi.fn(),
}));
vi.mock("./use-session.js", () => ({
  useSession: () => ({
    session: state.session,
    status: state.status,
    retry: state.retrySession,
  }),
}));
vi.mock("./use-action.js", () => ({ callAction: vi.fn() }));
vi.mock("./i18n.js", () => ({ useT: () => (key: string) => key }));
vi.mock("./settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: (options: { onConnected: () => Promise<void> }) => {
    state.connected = options.onConnected;
    return {
      configured: true,
      connecting: false,
      error: null,
      start: state.start,
    };
  },
}));
vi.mock("./settings/BuilderConnectPopover.js", () => ({
  BuilderConnectPopover: ({ children }: { children: React.ReactElement }) =>
    React.cloneElement(children, { onClick: state.start } as any),
}));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const back = vi.fn();
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <BuilderDsiGate onBack={back}>
          <span>Authoring workspace</span>
        </BuilderDsiGate>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.session = { email: "one@example.test", orgId: "test-org" };
  state.status = "authenticated";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
it("only mounts authoring after the server confirms access", async () => {
  vi.mocked(callAction).mockResolvedValue({ status: "ready", eligible: true });
  await render();
  expect(container.textContent).toBe("Authoring workspace");
});
it("does not accept a generally configured/shared Builder connection", async () => {
  vi.mocked(callAction).mockResolvedValue({
    status: "missing",
    eligible: false,
  });
  await render();
  expect(container.textContent).not.toContain("Authoring workspace");
  expect(container.textContent).toContain("agentChat.dsi.connectRequired");
  const buttons = [...container.querySelectorAll("button")];
  await act(async () =>
    buttons
      .find((button) => button.textContent?.includes("connectBuilder"))!
      .click(),
  );
  expect(state.start).toHaveBeenCalledOnce();
  await act(async () => buttons[0].click());
  expect(back).toHaveBeenCalledOnce();
});
it("rechecks the server after connection and returns to the same surface", async () => {
  vi.mocked(callAction).mockResolvedValue({
    status: "reconnect_required",
    eligible: true,
  });
  await render();
  expect(container.textContent).toContain(
    "agentChat.recovery.reconnectBuilder",
  );
  vi.mocked(callAction).mockResolvedValue({ status: "ready", eligible: true });
  await act(async () => {
    await state.connected!();
  });
  await render();
  expect(container.textContent).toBe("Authoring workspace");
});
it("does not reuse another signed-in person's approval", async () => {
  vi.mocked(callAction).mockResolvedValue({ status: "ready", eligible: true });
  await render();
  expect(container.textContent).toBe("Authoring workspace");
  state.session = { email: "two@example.test", orgId: "test-org" };
  vi.mocked(callAction).mockResolvedValue({
    status: "missing",
    eligible: false,
  });
  await render();
  expect(container.textContent).not.toContain("Authoring workspace");
});
it("closes authoring on disconnect or an unverifiable account", async () => {
  vi.mocked(callAction).mockResolvedValue({ status: "ready", eligible: true });
  await render();
  vi.mocked(callAction).mockRejectedValue(new Error("unavailable"));
  await act(async () => {
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
  });
  await render();
  expect(container.textContent).not.toContain("Authoring workspace");
  expect(container.textContent).toContain("agentChat.dsi.accessUnavailable");
  expect(container.textContent).toContain("agentChat.common.retry");
});
it("does not query or start Builder for a signed-out visitor", async () => {
  state.status = "unauthenticated";
  state.session = null;
  await render();
  expect(callAction).not.toHaveBeenCalled();
  expect(container.textContent).toContain("agentChat.auth.logIn");
  expect(state.start).not.toHaveBeenCalled();
});
