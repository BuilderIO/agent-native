// @vitest-environment happy-dom

import type { DesignBrief } from "@shared/design-briefs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

import {
  BuiltFromItems,
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
const secondBrief = {
  source: "content",
  id: "page-two",
  url: "https://content.example.com/_agent-native/open?documentId=page-two",
} as const;

const PAGE_URL = "https://content.example.com/page/page-one";
const launchBrief = {
  status: "available",
  app: "content",
  kind: "page",
  title: "Spring launch brief",
  url: PAGE_URL,
} as const;
const unavailable = { status: "unavailable" } as const;

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

async function openMenu(briefs: DesignBrief[] = [brief]) {
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
          createElement(BuiltFromItems, { briefs }),
        ),
      ),
    );
  });
  cleanup = () => act(async () => root.unmount()).then(() => host.remove());
  return Array.from(document.body.querySelectorAll('[role="menuitem"]'));
}

function expectUnlinked(item: Element | undefined) {
  if (!item) throw new Error("Missing Built from item");
  expect(item.textContent).toBe("designEditor.fileMenu.builtFromPage");
  expect(item.tagName).not.toBe("A");
  expect(item.querySelector("a")).toBeNull();
  expect(item.getAttribute("aria-disabled")).toBe("true");
}

function expectLaunchBriefLink(item: Element | undefined) {
  if (!item) throw new Error("Missing Built from item");
  expect(item.textContent).toBe(
    "designEditor.fileMenu.builtFrom: Spring launch brief",
  );
  expect(item.getAttribute("href")).toBe(PAGE_URL);
  expect(item.getAttribute("target")).toBe("_blank");
  expect(item.getAttribute("rel")).toBe("noopener noreferrer");
}

describe("Built from link", () => {
  it("reads the page title from Content as the viewer and links to the page", async () => {
    query.data = { summaries: [launchBrief] };
    const [link] = await openMenu();

    expect(query.useActionQuery).toHaveBeenCalledWith(
      "read-brief-titles",
      { ids: ["page-one"] },
      expect.objectContaining({ method: "GET", refetchOnMount: "always" }),
    );
    expectLaunchBriefLink(link);
  });

  it("asks for every page in one read and shows each answer in its page's place", async () => {
    query.data = { summaries: [unavailable, launchBrief] };
    const [first, second] = await openMenu([secondBrief, brief]);

    expect(query.useActionQuery).toHaveBeenCalledTimes(1);
    expect(query.useActionQuery).toHaveBeenCalledWith(
      "read-brief-titles",
      { ids: ["page-two", "page-one"] },
      expect.anything(),
    );
    expectUnlinked(first);
    expectLaunchBriefLink(second);
  });

  it("shows an unlinked generic label while the titles load", async () => {
    expectUnlinked((await openMenu())[0]);
  });

  it("shows an unlinked generic label when the viewer can't open the page", async () => {
    query.data = { summaries: [unavailable] };

    expectUnlinked((await openMenu())[0]);
  });

  it("drops a cached title when reading the titles again fails", async () => {
    query.data = { summaries: [launchBrief] };
    query.isError = true;

    expectUnlinked((await openMenu())[0]);
  });

  it("never links to the stored link", async () => {
    query.data = { summaries: [launchBrief] };
    const [link] = await openMenu([
      { ...brief, url: "https://elsewhere.example.com/not-the-brief" },
    ]);

    expectLaunchBriefLink(link);
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
    root.render(
      createElement(TooltipProvider, null, renderProjectTitleControl(props)),
    );
  });
  cleanup = () => act(async () => root.unmount()).then(() => host.remove());
  return host;
}

describe("Design title for someone who can only view the design", () => {
  it("opens a menu with only the pages the design was built from", async () => {
    query.data = { summaries: [launchBrief] };
    const host = await renderTitleForViewer([brief]);
    const trigger = host.querySelector("button");
    if (!trigger) throw new Error("Missing title menu");
    expect(trigger.textContent).toBe("Signup screen");

    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    const items = Array.from(
      document.body.querySelectorAll('[role="menuitem"]'),
      (item) => [item.textContent, item.getAttribute("href")],
    );
    expect(items).toEqual([
      ["designEditor.fileMenu.builtFrom: Spring launch brief", PAGE_URL],
    ]);
  });

  it("shows the plain title, and asks Content nothing, when the design wasn't built from a page", async () => {
    const host = await renderTitleForViewer([]);

    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toBe("Signup screen");
    expect(query.useActionQuery).not.toHaveBeenCalled();
  });
});
