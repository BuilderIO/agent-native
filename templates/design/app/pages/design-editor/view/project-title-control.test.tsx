// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

import { BuiltFromItem } from "./project-title-control";

const query = vi.hoisted(() => ({
  data: undefined as unknown,
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (...args: unknown[]) => {
    query.useActionQuery(...args);
    return { data: query.data };
  },
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
  query.useActionQuery.mockClear();
});
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function openMenu() {
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
          createElement(BuiltFromItem, { brief }),
        ),
      ),
    );
  });
  cleanup = () => act(async () => root.unmount()).then(() => host.remove());
  const link = document.body.querySelector("a");
  if (!link) throw new Error("Missing Built from link");
  return link;
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
      expect.objectContaining({ method: "GET" }),
    );
    expect(link.textContent).toBe(
      "designEditor.fileMenu.builtFrom: Spring launch brief",
    );
    expect(link.getAttribute("href")).toBe(brief.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a generic label while the title loads or when the viewer can't read the page", async () => {
    const link = await openMenu();

    expect(link.textContent).toBe("designEditor.fileMenu.builtFromPage");
    expect(link.getAttribute("href")).toBe(brief.url);
  });
});
