// @vitest-environment happy-dom

import type { DesignScreenData } from "@shared/design-screen-block";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { designScreenBlock } from "./DesignScreenBlock";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const hooks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  options: {} as Record<string, Record<string, unknown> | undefined>,
  session: null as { email: string } | null,
  callAction: vi.fn(),
  refetch: vi.fn(),
  updatedAt: 1,
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useRef } = await import("react");
  return {
    callAction: hooks.callAction,
    useSession: () => ({ session: hooks.session }),
    useActionQuery: (
      name: string,
      _params: unknown,
      options?: Record<string, unknown>,
    ) => {
      useRef(name);
      hooks.options[name] = options;
      return {
        data: options?.enabled ? hooks.queries[name] : undefined,
        refetch: hooks.refetch,
        dataUpdatedAt: hooks.updatedAt,
      };
    },
  };
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
  useLocale: () => ({ locale: "en-US" }),
}));

const tracked = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: tracked,
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

const MEDIA_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SCREEN_URL = "https://design.example.test/design/checkout?screen=pay";

function screen(overrides: Partial<DesignScreenData> = {}): DesignScreenData {
  return {
    design: {
      id: "checkout",
      title: "Checkout",
      url: "https://design.example.test/design/checkout",
      visibility: "org",
    },
    screen: {
      id: "pay",
      name: "Pay",
      width: 390,
      fingerprint: "0123456789ab",
      url: SCREEN_URL,
    },
    image: {
      src: `/api/private-media/${MEDIA_ID}`,
      width: 780,
      height: 1688,
      alt: "The Pay screen from the Checkout design in Design, at 390 pixels wide.",
    },
    capturedAt: "2026-11-20T16:40:00.000Z",
    capturedBy: "Ada",
    ...overrides,
  };
}

const PICTURE_ALT = `designScreen.pictureAlt ${JSON.stringify({
  screen: "Pay",
  design: "Checkout",
  width: 390,
})}`;

function status(fingerprint: string | null, openComments = 0) {
  return {
    designs: [
      {
        designId: "checkout",
        status: {
          design: { id: "checkout", title: "Checkout", visibility: "org" },
          screens: [{ id: "pay", fingerprint, openComments }],
        },
      },
    ],
  };
}

let root: Root | null = null;
let container: HTMLDivElement;

function renderRead(data: unknown) {
  const Read = designScreenBlock.Read;
  act(() =>
    defined(root).render(
      <Read
        data={data as DesignScreenData}
        blockId="design-screen-1a2b3c4d"
        ctx={{ dialect: "nfm", documentId: "doc_1", canEdit: false } as never}
      />,
    ),
  );
}

function renderEdit(data: unknown, onChange = vi.fn()) {
  const Edit = defined(designScreenBlock.Edit);
  act(() =>
    defined(root).render(
      <Edit
        data={data as DesignScreenData}
        onChange={onChange}
        editable
        blockId="design-screen-1a2b3c4d"
        ctx={{ dialect: "nfm", documentId: "doc_1", canEdit: true } as never}
      />,
    ),
  );
  return onChange;
}

function refreshButton() {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "designScreen.refresh",
  );
}

beforeEach(() => {
  hooks.queries = {};
  hooks.options = {};
  hooks.session = { email: "reader@example.test" };
  hooks.callAction.mockReset();
  hooks.refetch.mockReset();
  hooks.updatedAt = 1;
  tracked.mockReset();
  for (const fn of Object.values(toasts)) fn.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

describe("DesignScreen for readers", () => {
  it("shows the picture from the page's private images, described for screen readers in their language", () => {
    renderRead(screen());
    const figure = defined(container.querySelector("figure"));
    const titleId = defined(figure.getAttribute("aria-labelledby"));
    expect(document.getElementById(titleId)?.textContent).toBe("Pay");
    const image = defined(container.querySelector("img"));
    expect(image.getAttribute("src")).toContain(
      `/api/private-media/${MEDIA_ID}`,
    );
    expect(image.getAttribute("alt")).toBe(PICTURE_ALT);
    expect(image.getAttribute("width")).toBe("780");
    expect(image.getAttribute("height")).toBe("1688");
  });

  it("shows a phone screen no wider than the phone", () => {
    renderRead(screen());
    const picture = defined(container.querySelector("img")?.closest("button"));
    expect(picture.style.maxWidth).toBe("390px");
  });

  it("opens the picture full size", () => {
    renderRead(screen());
    const picture = defined(container.querySelector("img")?.closest("button"));
    expect(picture.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => picture.click());
    const dialog = defined(
      document.body.querySelector('[role="dialog"].media-lightbox'),
    );
    expect(dialog.querySelector("img")?.getAttribute("src")).toContain(
      `/api/private-media/${MEDIA_ID}`,
    );
  });

  it("stamps the design, width, day and who pinned it", () => {
    renderRead(screen());
    expect(container.textContent).toContain(
      'designScreen.design {"design":"Checkout"}',
    );
    expect(container.textContent).toContain('designScreen.width {"width":390}');
    expect(container.textContent).toContain(
      'designScreen.pinnedOnBy {"date":"Nov 20, 2026","name":"Ada"}',
    );
  });

  it("links back to the screen in Design", () => {
    renderRead(screen());
    const link = defined(
      container.querySelector<HTMLAnchorElement>(`a[href="${SCREEN_URL}"]`),
    );
    expect(link.textContent).toBe("designScreen.openInDesign");
    link.addEventListener("click", (event) => event.preventDefault());
    act(() => link.click());
    expect(tracked).toHaveBeenCalledWith("design_screen_opened", {});
  });

  it("tells a reader who can open the design when the screen changed, and links its open comments", () => {
    hooks.queries["get-design-screen-status"] = status("ba9876543210", 3);
    renderRead(screen());
    expect(hooks.options["get-design-screen-status"]).toMatchObject({
      method: "POST",
      enabled: true,
    });
    expect(container.textContent).toContain("designScreen.changed");
    expect(container.textContent).not.toContain("designScreen.changedRefresh");
    const comments = [...container.querySelectorAll("a")].find((link) =>
      link.textContent.startsWith("designScreen.openComments"),
    );
    expect(comments?.textContent).toBe('designScreen.openComments {"count":3}');
    expect(comments?.getAttribute("href")).toBe(SCREEN_URL);
    expect(refreshButton()).toBeUndefined();
  });

  it("names one open comment in the singular", () => {
    hooks.queries["get-design-screen-status"] = status("0123456789ab", 1);
    renderRead(screen());
    expect(container.textContent).toContain("designScreen.openCommentsOne");
    expect(container.textContent).not.toContain("designScreen.changed");
  });

  it("asks Design nothing for someone signed out, such as a public page's reader", () => {
    hooks.session = null;
    hooks.queries["get-design-screen-status"] = status("ba9876543210", 3);
    renderRead(screen());
    expect(hooks.options["get-design-screen-status"]).toMatchObject({
      enabled: false,
    });
    expect(container.textContent).not.toContain("designScreen.changed");
    expect(container.textContent).not.toContain("designScreen.openComments");
  });

  it("says the picture didn't load rather than showing a broken image", () => {
    renderRead(screen());
    const image = defined(container.querySelector("img"));
    act(() => {
      image.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    const fallback = defined(container.querySelector('[role="img"]'));
    expect(fallback.getAttribute("aria-label")).toBe(PICTURE_ALT);
    expect(fallback.textContent).toBe("designScreen.imageFailed");
  });

  it("tries a new picture even after the old one didn't load", () => {
    renderRead(screen());
    act(() => {
      defined(container.querySelector("img")).dispatchEvent(new Event("error"));
    });
    renderRead(
      screen({
        image: {
          ...screen().image,
          src: "/api/private-media/7c9e6679-7425-40de-944b-e07fc1f90ae7",
        },
      }),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );
  });

  it("shows nothing from a tag whose picture isn't one of the page's private images", () => {
    renderRead(
      screen({
        image: { ...screen().image, src: "https://tracker.example/pixel.png" },
      }),
    );
    expect(container.textContent).toContain("designScreen.unreadable");
    expect(container.querySelector("img")).toBeNull();
    expect(hooks.options).not.toHaveProperty("get-design-screen-status");
  });
});

describe("DesignScreen for editors", () => {
  it("says when the screen changed in Design since the picture", () => {
    hooks.queries["get-design-screen-status"] = status("ba9876543210");
    renderEdit(screen());
    expect(container.textContent).toContain("designScreen.changedRefresh");
  });

  it("says when the screen is gone from its design, and offers no refresh", () => {
    hooks.queries["get-design-screen-status"] = status(null, 2);
    renderEdit(screen());
    expect(container.textContent).toContain("designScreen.screenGone");
    expect(container.textContent).not.toContain("designScreen.openComments");
    expect(refreshButton()).toBeUndefined();
  });

  it("refreshes the picture in place, at the width it was pinned at", async () => {
    const fresh = screen({
      screen: { ...screen().screen, fingerprint: "ba9876543210" },
      capturedAt: "2026-11-21T09:00:00.000Z",
    });
    hooks.callAction.mockResolvedValue({ status: "captured", screen: fresh });
    const onChange = renderEdit(screen());
    await act(async () => defined(refreshButton()).click());
    expect(hooks.callAction).toHaveBeenCalledWith("capture-design-screen", {
      documentId: "doc_1",
      designId: "checkout",
      screenId: "pay",
      width: 390,
      purpose: "refresh",
      blockId: "design-screen-1a2b3c4d",
    });
    expect(onChange).toHaveBeenCalledWith(fresh);
    expect(hooks.refetch).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalled();
  });

  it("weighs only a status read after the new picture once it is refreshed", async () => {
    const fresh = screen({
      screen: { ...screen().screen, fingerprint: "ba9876543210" },
    });
    hooks.queries["get-design-screen-status"] = status("0123456789ab");
    hooks.callAction.mockResolvedValue({ status: "captured", screen: fresh });
    const onChange = renderEdit(screen());
    await act(async () => defined(refreshButton()).click());
    renderEdit(fresh, onChange);
    expect(container.textContent).not.toContain("designScreen.changedRefresh");

    hooks.updatedAt = Date.now() + 60_000;
    hooks.queries["get-design-screen-status"] = status("ffffffffffff");
    renderEdit(fresh, onChange);
    expect(container.textContent).toContain("designScreen.changedRefresh");
  });

  it("asks before a refresh that would show the screen to more people", async () => {
    hooks.callAction.mockResolvedValueOnce({
      status: "needs_confirmation",
      design: { title: "Checkout" },
    });
    const onChange = renderEdit(screen());
    await act(async () => defined(refreshButton()).click());
    expect(onChange).not.toHaveBeenCalled();
    expect(toasts.warning).toHaveBeenCalledWith(
      'designScreen.confirmWider {"design":"Checkout"}',
      expect.anything(),
    );

    hooks.callAction.mockResolvedValueOnce({
      status: "captured",
      screen: screen(),
    });
    const [, options] = toasts.warning.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    await act(async () => options.action.onClick());
    expect(hooks.callAction).toHaveBeenLastCalledWith(
      "capture-design-screen",
      expect.objectContaining({ acknowledgeWiderAudience: true }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("says why a refresh failed", async () => {
    hooks.callAction.mockRejectedValue(new Error("Design didn't answer."));
    const onChange = renderEdit(screen());
    await act(async () => defined(refreshButton()).click());
    expect(onChange).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith("designScreen.refreshFailed", {
      description: "Design didn't answer.",
    });
  });

  it("says why in the page's own words when the action names the failure", async () => {
    hooks.callAction.mockRejectedValue(
      Object.assign(new Error("Something went wrong. Try again."), {
        errorCode: "design_unreachable",
      }),
    );
    renderEdit(screen());
    await act(async () => defined(refreshButton()).click());
    expect(toasts.error).toHaveBeenCalledWith("designScreen.refreshFailed", {
      description: "designScreen.errorUnreachable",
    });
  });

  it.each([
    ["design_screen_too_large", "designScreen.errorTooLarge"],
    ["design_screen_render_timeout", "designScreen.errorRenderTimeout"],
  ])(
    "gives Design's own reason in the page's words when Design names it (%s)",
    async (designCode, message) => {
      hooks.callAction.mockRejectedValue(
        Object.assign(new Error("Something went wrong. Try again."), {
          errorCode: "design_refused",
          details: { designCode },
        }),
      );
      renderEdit(screen());
      await act(async () => defined(refreshButton()).click());
      expect(toasts.error).toHaveBeenCalledWith("designScreen.refreshFailed", {
        description: message,
      });
    },
  );

  it.each([
    [
      "design_screen_storage_unavailable",
      "designScreen.errorStorageUnavailable",
    ],
    ["design_screen_image_invalid", "designScreen.errorUnreadableAnswer"],
  ])(
    "says in the page's words when Content couldn't keep the picture (%s)",
    async (errorCode, message) => {
      hooks.callAction.mockRejectedValue(
        Object.assign(new Error("Private media storage isn't set up."), {
          errorCode,
        }),
      );
      renderEdit(screen());
      await act(async () => defined(refreshButton()).click());
      expect(toasts.error).toHaveBeenCalledWith("designScreen.refreshFailed", {
        description: message,
      });
    },
  );
});
