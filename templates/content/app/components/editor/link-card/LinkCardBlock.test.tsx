// @vitest-environment happy-dom

import type { BlockRenderContext } from "@agent-native/core/blocks/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { linkCardBlock } from "./LinkCardBlock";

const hooks = vi.hoisted(() => ({
  callAction: vi.fn(),
  session: {
    session: { email: "reader@example.test" } as {
      email: string;
      orgId?: string;
    } | null,
    status: "authenticated",
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: hooks.callAction,
  useSession: () => hooks.session,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));

const DESIGN = "https://design.example.test/design/launch_1";
const SLIDES = "https://slides.example.test/deck/q3";

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function show(items: Array<{ app: string; url: string }>) {
  const Read = linkCardBlock.Read;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {items.map((data, index) => (
          <Read
            key={index}
            data={data as never}
            blockId={`link-card-${index}`}
            ctx={{} as BlockRenderContext}
          />
        ))}
      </QueryClientProvider>,
    );
  });
}

async function render(items: Array<{ app: string; url: string }>) {
  await show(items);
  await vi.waitFor(() => {
    for (const card of cards()) {
      expect(card.dataset.linkCardState).not.toBe("loading");
    }
  });
}

function answer(title: string, answeredFor: Record<string, unknown> = {}) {
  return {
    reader: "reader@example.test",
    readerOrg: null,
    ...answeredFor,
    summaries: [
      {
        status: "available",
        app: "design",
        kind: "design",
        title,
        url: DESIGN,
      },
    ],
  };
}

function cards() {
  return [...container.querySelectorAll<HTMLElement>("[data-link-card]")];
}

function card(index: number): HTMLElement {
  return container
    .querySelectorAll<HTMLElement>("[data-link-card]")
    .item(index);
}

beforeEach(() => {
  hooks.callAction.mockReset();
  hooks.session = {
    session: { email: "reader@example.test" },
    status: "authenticated",
  };
  client = new QueryClient();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  vi.useRealTimers();
});

describe("link card", () => {
  it("shows the title the owning app gave this reader, and opens the link", async () => {
    hooks.callAction.mockResolvedValue({
      reader: "reader@example.test",
      summaries: [
        {
          status: "available",
          app: "design",
          kind: "design",
          title: "Launch page",
          url: DESIGN,
        },
        { status: "unavailable" },
      ],
    });
    await render([
      { app: "design", url: DESIGN },
      { app: "slides", url: SLIDES },
    ]);
    expect(hooks.callAction).toHaveBeenCalledTimes(1);
    expect(hooks.callAction).toHaveBeenCalledWith("read-link-summaries", {
      links: [DESIGN, SLIDES],
    });
    const design = card(0);
    const slides = card(1);
    expect(design.getAttribute("href")).toBe(DESIGN);
    expect(design.getAttribute("target")).toBe("_blank");
    expect(design.dataset.linkCardState).toBe("available");
    expect(design.textContent).toContain("Launch page");
    expect(design.textContent).toContain(
      "Design · design.example.test/design/launch_1",
    );
    expect(slides.dataset.linkCardState).toBe("untitled");
    expect(slides.textContent).toBe("Slidesslides.example.test/deck/q3");
  });

  it("drops a title answered for someone other than this reader", async () => {
    hooks.callAction.mockResolvedValue({
      reader: "someone-else@example.test",
      summaries: [
        {
          status: "available",
          app: "design",
          kind: "design",
          title: "Someone else's launch page",
          url: DESIGN,
        },
      ],
    });
    await render([{ app: "design", url: DESIGN }]);
    expect(card(0).dataset.linkCardState).toBe("untitled");
    expect(container.textContent).not.toContain("launch page");
  });

  it("drops a title answered for this reader in another organization", async () => {
    hooks.session = {
      session: { email: "reader@example.test", orgId: "org_1" },
      status: "authenticated",
    };
    hooks.callAction.mockResolvedValue(
      answer("Org two's launch page", { readerOrg: "org_2" }),
    );
    await render([{ app: "design", url: DESIGN }]);
    expect(card(0).dataset.linkCardState).toBe("untitled");
    expect(container.textContent).not.toContain("launch page");
  });

  it("shows the title answered for this reader in their organization", async () => {
    hooks.session = {
      session: { email: "reader@example.test", orgId: "org_1" },
      status: "authenticated",
    };
    hooks.callAction.mockResolvedValue(
      answer("Launch page", { readerOrg: "org_1" }),
    );
    await render([{ app: "design", url: DESIGN }]);
    expect(card(0).textContent).toContain("Launch page");
  });

  it.each(["refuses", "fails"])(
    "asks again before showing a title over a minute old, and drops it when the ask %s",
    async (outcome) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      hooks.callAction.mockResolvedValueOnce(answer("Launch page"));
      await render([{ app: "design", url: DESIGN }]);
      expect(card(0).textContent).toContain("Launch page");
      act(() => root.render(null));
      vi.setSystemTime(Date.now() + 61_000);
      let finish = () => {};
      hooks.callAction.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === "fails"
              ? reject(new Error("Request failed"))
              : resolve({
                  ...answer(""),
                  summaries: [{ status: "unavailable" }],
                });
        }),
      );
      await show([{ app: "design", url: DESIGN }]);
      await vi.waitFor(() => expect(hooks.callAction).toHaveBeenCalledTimes(2));
      expect(card(0).dataset.linkCardState).toBe("loading");
      expect(container.textContent).not.toContain("Launch page");
      finish();
      await vi.waitFor(() =>
        expect(card(0).dataset.linkCardState).toBe("untitled"),
      );
      expect(container.textContent).not.toContain("Launch page");
    },
  );

  it("forgets a title a minute after its card is gone", async () => {
    hooks.callAction.mockResolvedValue(answer("Launch page"));
    await render([{ app: "design", url: DESIGN }]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => root.render(null));
    vi.advanceTimersByTime(59_000);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("shows no query or hash, where a link could carry a token", async () => {
    hooks.callAction.mockRejectedValue(new Error("Request failed"));
    await render([
      { app: "slides", url: `${SLIDES}?slide=4#top` },
      { app: "clips", url: "https://clips.example.test/share/c1?token=fake" },
      { app: "clips", url: "not a link ?token=fake" },
    ]);
    expect(card(0).textContent).toBe("Slidesslides.example.test/deck/q3");
    expect(card(0).getAttribute("href")).toBe(`${SLIDES}?slide=4#top`);
    expect(card(1).textContent).toBe("clips.example.test/share/c1");
    expect(container.textContent).not.toContain("fake");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("shows the untitled card when the owning app doesn't answer", async () => {
    hooks.callAction.mockRejectedValue(new Error("Request failed (502)"));
    await render([{ app: "design", url: DESIGN }]);
    const design = card(0);
    expect(design.dataset.linkCardState).toBe("untitled");
    expect(design.textContent).toBe(
      "Designdesign.example.test/design/launch_1",
    );
  });

  it("asks nothing for a signed-out reader", async () => {
    hooks.session = { session: null, status: "unauthenticated" };
    await render([{ app: "design", url: DESIGN }]);
    expect(hooks.callAction).not.toHaveBeenCalled();
    expect(card(0).dataset.linkCardState).toBe("untitled");
  });

  it("never makes a link it can't read clickable", async () => {
    await render([{ app: "design", url: "javascript:alert(1)" }]);
    expect(hooks.callAction).not.toHaveBeenCalled();
    expect(container.querySelector("a")).toBeNull();
  });
});
