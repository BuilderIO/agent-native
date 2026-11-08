// @vitest-environment happy-dom

import type { DesignBrief } from "@shared/design-briefs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

import {
  BuiltFromItem,
  renderProjectTitleControl,
} from "./project-title-control";

const query = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: false,
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (...args: unknown[]) => {
    query.useActionQuery(...args);
    return { data: query.data, isError: query.isError };
  },
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { title?: string }) =>
    values?.title ? `${key}: ${values.title}` : key,
}));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const brief = {
  source: "content",
  id: "page-one",
  url: "https://content.example.com/_agent-native/open?documentId=page-one",
} as const;

let cleanup: (() => Promise<void>) | undefined;
beforeEach(() => {
  query.data = undefined;
  query.isError = false;
  query.useActionQuery.mockClear();
});
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function openMenu(target: DesignBrief = brief) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        DropdownMenu,
        { open: true },
        createElement(
          DropdownMenuContent,
          null,
          createElement(BuiltFromItem, { brief: target }),
        ),
      ),
    );
  });
  cleanup = () => act(async () => root.unmount()).then(() => host.remove());
  const item = document.body.querySelector('[role="menuitem"]');
  if (!item) throw new Error("Missing Built from item");
  return item;
}

function expectUnlinked(item: Element) {
  expect(item.textContent).toBe("designEditor.fileMenu.builtFromPage");
  expect(item.tagName).not.toBe("A");
  expect(item.querySelector("a")).toBeNull();
  expect(item.getAttribute("aria-disabled")).toBe("true");
}

describe("Built from link", () => {
  it("reads the page title from Content as the viewer and links to the page", async () => {
    query.data = {
      id: "page-one",
      title: "Spring launch brief",
      url: brief.url,
      context: "Content page: the brief",
    };
    const link = await openMenu();

    expect(query.useActionQuery).toHaveBeenCalledWith(
      "read-composer-source",
      { source: "content", operation: "read", id: "page-one", page: 1 },
      expect.objectContaining({ method: "GET", refetchOnMount: "always" }),
    );
    expect(link.textContent).toBe(
      "designEditor.fileMenu.builtFrom: Spring launch brief",
    );
    expect(link.getAttribute("href")).toBe(brief.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows an unlinked generic label while the page loads or when the viewer can't read it", async () => {
    expectUnlinked(await openMenu());
  });

  it("drops a cached title when reading the page again fails", async () => {
    query.data = {
      id: "page-one",
      title: "Spring launch brief",
      url: brief.url,
      context: "Content page: the brief",
    };
    query.isError = true;

    expectUnlinked(await openMenu());
  });

  it("puts the page's title only on the link Content returned for it", async () => {
    query.data = {
      id: "page-one",
      title: "Spring launch brief",
      url: brief.url,
      context: "Content page: the brief",
    };
    const link = await openMenu({
      ...brief,
      url: "https://elsewhere.example.com/not-the-brief",
    });

    expect(link.textContent).toBe(
      "designEditor.fileMenu.builtFrom: Spring launch brief",
    );
    expect(link.getAttribute("href")).toBe(brief.url);
  });

  it("doesn't link when Content's link isn't a full web address", async () => {
    query.data = {
      id: "page-one",
      title: "Spring launch brief",
      url: "/_agent-native/open?documentId=page-one",
      context: "Content page: the brief",
    };

    expectUnlinked(await openMenu());
  });
});

async function renderTitleForViewer(briefs: DesignBrief[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props = {
    editorCore: { t: (key: string) => key, id: "design-one" },
    editorGenerationAndAccess: {
      canEditDesign: false,
      canShareDesign: false,
      duplicateDesignMutation: { isPending: false },
    },
    editorFilesAndSaving: { titleEditing: false },
    editorHistory: {},
    editorLiveEditsAndPresence: {},
    editorLayoutAndStructure: {},
    editorSourceAndSync: {},
    design: { title: "Signup screen", data: { briefs } },
    widgetEmbed: false,
  } as unknown as Parameters<typeof renderProjectTitleControl>[0];
  await act(async () => {
    root.render(renderProjectTitleControl(props));
  });
  cleanup = () => act(async () => root.unmount()).then(() => host.remove());
  return host;
}

describe("Design title for someone who can only view the design", () => {
  it("opens a menu with only the pages the design was built from", async () => {
    query.data = {
      id: "page-one",
      title: "Spring launch brief",
      url: brief.url,
      context: "Content page: the brief",
    };
    const host = await renderTitleForViewer([brief]);
    const trigger = host.querySelector("button");
    if (!trigger) throw new Error("Missing title menu");
    expect(trigger.textContent).toBe("Signup screen");

    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    const items = document.body.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe(
      "designEditor.fileMenu.builtFrom: Spring launch brief",
    );
    expect(items[0].getAttribute("href")).toBe(brief.url);
  });

  it("shows the plain title when the design wasn't built from a page", async () => {
    const host = await renderTitleForViewer([]);

    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toBe("Signup screen");
  });
});
