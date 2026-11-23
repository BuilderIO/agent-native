// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import messages from "@/i18n/en-US";

import { AgentPane } from "./AgentPane";

it("nests the conversation in a thread column that fills the agent pane", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AgentPane
        agentPane={<div>Current conversation</div>}
        agentComposer={<div>Composer</div>}
      />,
    );
  });
  const pane = host.querySelector(".nb-agent-pane");
  const column = pane?.querySelector(":scope > .nb-agent-thread-column");
  expect(column).not.toBeNull();
  expect(column?.querySelector(".nb-agent-slot")?.textContent).toBe(
    "Current conversation",
  );
  expect(column?.querySelector(".nb-agent-composer-slot")?.textContent).toBe(
    "Composer",
  );
  await act(async () => root.unmount());
  host.remove();
});

it("uses i18n messages for fallback empty state and composer labels", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages }}
        persistPreference={false}
      >
        <AgentPane agentPane={undefined} agentComposer={undefined} />
      </AgentNativeI18nProvider>,
    );
  });
  expect(host.querySelector("h2")?.textContent).toBe(messages.analytics.ask.title);
  expect(
    host.querySelector("textarea")?.getAttribute("placeholder"),
  ).toBe(messages.analytics.ask.paneComposerPlaceholder);
  expect(
    host.querySelector(".nb-agent-suggestion span")?.textContent,
  ).toBe(messages.analytics.ask.contextBannerMessage);
  await act(async () => root.unmount());
  host.remove();
});
