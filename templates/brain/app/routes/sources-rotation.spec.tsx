// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rotate: vi.fn(async () => ({
    source: { id: "clips-source", provider: "clips" },
    sourceKey: "returned-identity",
    ingestToken: "one-time-token",
  })),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-sources"
        ? {
            sources: [
              {
                id: "clips-source",
                title: "Clips source",
                provider: "clips",
                hasIngestSourceKey: true,
                config: {},
              },
              {
                id: "no-key",
                title: "No key",
                provider: "generic",
                hasIngestSourceKey: false,
                config: {},
              },
              {
                id: "slack",
                title: "Slack",
                provider: "slack",
                hasIngestSourceKey: true,
                config: {},
              },
            ],
          }
        : undefined,
    isLoading: false,
  }),
  useActionMutation: (name: string) => ({
    mutate: vi.fn(),
    mutateAsync:
      name === "rotate-source-ingest-token" ? fixture.rotate : vi.fn(),
    isPending: false,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: () => null,
}));
vi.mock("@agent-native/toolkit/app/sharing/VisibilityBadge", () => ({
  VisibilityBadge: () => null,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import SourcesRoute from "./sources";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("offers rotation only for configured ingest sources and displays the returned identity and token", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <SourcesRoute />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });
    const buttons = [...host.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("sources.rotateIngestToken"),
    );
    expect(buttons).toHaveLength(1);
    await act(async () => {
      buttons[0].click();
    });
    expect(fixture.rotate).toHaveBeenCalledWith({ sourceId: "clips-source" });
    expect(
      document.querySelector<HTMLInputElement>("#ingest-handoff-source-key")
        ?.value,
    ).toBe("returned-identity");
    expect(
      document.querySelector<HTMLInputElement>("#ingest-handoff-ingest-token")
        ?.value,
    ).toBe("one-time-token");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
