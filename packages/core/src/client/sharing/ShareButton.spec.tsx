// @vitest-environment happy-dom
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "./ShareButton.js";

const shareMutate = vi.hoisted(() => vi.fn());
const otherMutate = vi.hoisted(() => vi.fn());
const refetchShares = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../use-action.js", () => ({
  useActionQuery: () => ({
    data: {
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      shares: [],
    },
    refetch: refetchShares,
  }),
  useActionMutation: (name: string) => ({
    mutate: name === "share-resource" ? shareMutate : otherMutate,
  }),
}));

vi.mock("../components/ui/popover.js", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ShareButton", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          members: [],
        }),
      ),
    );
    shareMutate.mockReset();
    otherMutate.mockReset();
    refetchShares.mockClear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("submits a typed email invite when Done is clicked", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            resourceTitle="Launch notes"
            shareUrl="https://content.agent-native.com/page/doc-1"
          />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "teammate@example.com");

    const done = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Done",
    );
    if (!done) throw new Error("Done button not found");

    act(() => {
      done.click();
    });

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "document",
        resourceId: "doc-1",
        principalType: "user",
        principalId: "teammate@example.com",
        role: "viewer",
        notify: true,
        resourceUrl: "https://content.agent-native.com/page/doc-1",
      }),
      expect.any(Object),
    );
  });
});
