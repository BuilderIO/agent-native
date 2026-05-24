// @vitest-environment happy-dom
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "./ShareButton.js";

const shareMutate = vi.hoisted(() => vi.fn());
const otherMutate = vi.hoisted(() => vi.fn());
const refetchShares = vi.hoisted(() => vi.fn(async () => undefined));
const sharesData = vi.hoisted(() => ({
  current: {
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    role: "owner",
    shares: [],
  },
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: () => ({
    data: sharesData.current,
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
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => (
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
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      shares: [],
    };
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

  it("shows the copy action for share URLs regardless of visibility", async () => {
    // Mirrors Google Slides: the copy button is always live. Access is
    // enforced when the recipient opens the URL, not by hiding the link in
    // the share dialog.
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrl="https://slides.agent-native.com/deck/deck-1"
          />
        </QueryClientProvider>,
      );
    });

    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Copy",
      ),
    ).toBe(true);
  });

  it("renders both primary and secondary share URLs", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrl="https://slides.agent-native.com/deck/deck-1"
            shareUrlLabel="Editor link"
            secondaryShareUrl="https://slides.agent-native.com/p/deck-1"
            secondaryShareUrlLabel="Presentation link"
          />
        </QueryClientProvider>,
      );
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const editorInput = inputs.find(
      (i) => i.value === "https://slides.agent-native.com/deck/deck-1",
    );
    const presentationInput = inputs.find(
      (i) => i.value === "https://slides.agent-native.com/p/deck-1",
    );
    expect(editorInput).toBeTruthy();
    expect(presentationInput).toBeTruthy();
  });

  it("can customize access labels and move the share URL to the top", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="form"
            resourceId="form-1"
            shareUrl="https://forms.agent-native.com/f/form-1"
            shareUrlLabel="Public response link"
            shareUrlPlacement="top"
            peopleAccessLabel="People with editing access"
            generalAccessLabel="General editing access"
          />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("People with editing access");
    expect(text).toContain("General editing access");
    expect(text.indexOf("Public response link")).toBeLessThan(
      text.indexOf("People with editing access"),
    );
  });

  it("searches org members on the server and selects a suggestion with the keyboard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/_agent-native/org/members")) {
        return Response.json({
          members: [{ email: "akash@builder.io", role: "member" }],
          hasMore: false,
          nextOffset: null,
        });
      }
      return Response.json({ members: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="form"
            resourceId="form-1"
            resourceTitle="Hackathon"
          />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "aka");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    const memberSearchCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/_agent-native/org/members"),
    );
    expect(String(memberSearchCall?.[0])).toContain("search=aka");
    expect(String(memberSearchCall?.[0])).toContain("limit=25");
    expect(container.textContent).toContain("akash@builder.io");

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(input.value).toBe("akash@builder.io");
  });

  it("requests the next org-member page from the share autocomplete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          members: [{ email: "first@builder.io", role: "member" }],
          hasMore: true,
          nextOffset: 25,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          members: [{ email: "second@builder.io", role: "member" }],
          hasMore: false,
          nextOffset: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="form" resourceId="form-1" />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "first");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    const loadMore = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Load more",
    );
    if (!loadMore) throw new Error("Load more button not found");

    act(() => {
      loadMore.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("offset=25");
    expect(container.textContent).toContain("second@builder.io");
  });
});
