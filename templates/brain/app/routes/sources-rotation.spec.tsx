// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rotate: vi.fn(async (_variables: { sourceId: string }) => ({
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
  useActionMutation: (name: string) => {
    const [isPending, setPending] = React.useState(false);
    const [isError, setError] = React.useState(false);
    const mutateAsync = async (variables: { sourceId: string }) => {
      setPending(true);
      setError(false);
      try {
        return await fixture.rotate(variables);
      } catch (error) {
        setError(true);
        throw error;
      } finally {
        setPending(false);
      }
    };
    return {
      mutate: (
        variables: { sourceId: string },
        options?: {
          onSuccess?: (
            result: Awaited<ReturnType<typeof fixture.rotate>>,
          ) => void;
          onSettled?: () => void;
        },
      ) => {
        void mutateAsync(variables)
          .then(options?.onSuccess, () => {})
          .finally(options?.onSettled);
      },
      mutateAsync:
        name === "rotate-source-ingest-token" ? mutateAsync : vi.fn(),
      isPending,
      isError,
    };
  },
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
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import SourcesRoute from "./sources";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("prevents overlapping rotations while a token is pending", async () => {
  fixture.rotate.mockClear();
  let resolveRotation: (
    value: Awaited<ReturnType<typeof fixture.rotate>>,
  ) => void = () => {
    throw new Error("Rotation was not started");
  };
  fixture.rotate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRotation = resolve;
      }),
  );
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
    const button = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("sources.rotateIngestToken"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      button?.click();
    });
    expect(fixture.rotate).toHaveBeenCalledTimes(1);
    expect(button?.disabled).toBe(true);
    await act(async () => {
      resolveRotation({
        source: { id: "clips-source", provider: "clips" },
        sourceKey: "returned-identity",
        ingestToken: "one-time-token",
      });
    });
    expect(
      document.querySelector<HTMLInputElement>("#ingest-handoff-ingest-token")
        ?.value,
    ).toBe("one-time-token");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows the existing failure state and allows retrying a failed rotation", async () => {
  fixture.rotate.mockClear();
  fixture.rotate.mockRejectedValueOnce(new Error("Rotation failed"));
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
    const button = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("sources.rotateIngestToken"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
    expect(host.textContent).toContain("sources.actionFailedTitle");
    expect(document.querySelector("#ingest-handoff-ingest-token")).toBeNull();
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button?.click();
    });
    expect(fixture.rotate).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector<HTMLInputElement>("#ingest-handoff-ingest-token")
        ?.value,
    ).toBe("one-time-token");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("offers rotation only for configured ingest sources and displays the returned identity and token", async () => {
  fixture.rotate.mockClear();
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
