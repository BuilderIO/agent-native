// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: () => null,
  AgentChatSurface: ({
    composerContextBannerSlot,
  }: {
    composerContextBannerSlot?: ReactNode;
  }) => <div>{composerContextBannerSlot}</div>,
}));

import { WorkspaceAgent } from "./WorkspaceAgent";

it("report B-NOTEBOOK-CONTEXT-LINK: opens setup from the notebook composer", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <MemoryRouter
          basename="/analytics-2"
          initialEntries={["/analytics-2/project/p1"]}
        >
          <WorkspaceAgent mode="notebook" orgId="org-1" />
        </MemoryRouter>
      </AgentNativeI18nProvider>,
    ),
  );
  expect(host.textContent).toContain("Get better answers in < 5 minutes");
  const link = host.querySelector<HTMLAnchorElement>("a");
  expect(link?.textContent).toBe("Add context");
  expect(link?.getAttribute("href")).toBe("/analytics-2/context-studio/setup");
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  act(() => root.unmount());
  host.remove();
});
