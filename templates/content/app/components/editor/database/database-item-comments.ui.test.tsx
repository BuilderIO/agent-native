// @vitest-environment happy-dom

import type { ContentDatabaseItem } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  DatabaseItemCommentsContext,
  DatabaseRowCommentCount,
} from "./database-item-comments";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const row = (comments?: ContentDatabaseItem["comments"]) =>
  ({
    id: "item-1",
    databaseId: "db-1",
    document: { id: "row-1", title: "Launch plan" },
    properties: [],
    ...(comments ? { comments } : {}),
  }) as unknown as ContentDatabaseItem;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const openComments = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openComments.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(children: ReactNode, provided = true) {
  await act(async () =>
    root.render(
      <TooltipProvider>
        {provided ? (
          <DatabaseItemCommentsContext.Provider value={openComments}>
            {children}
          </DatabaseItemCommentsContext.Provider>
        ) : (
          children
        )}
      </TooltipProvider>,
    ),
  );
}

describe("Comment markers in a Collection table", () => {
  it("shows a row's open count and opens its Comments", async () => {
    const item = row({
      open: 3,
      properties: { status: { open: 1, latestThreadId: "t-status" } },
    });
    await render(<DatabaseRowCommentCount item={item} />);
    const count = container.querySelector<HTMLButtonElement>(
      "[data-database-row-comments]",
    )!;
    expect(count.textContent).toBe("3");
    expect(count.getAttribute("aria-label")).toBe(
      'comments.openRowComments:{"count":3,"title":"Launch plan"}',
    );
    await act(async () => count.click());
    expect(openComments).toHaveBeenCalledWith(item, null);
  });

  it("shows nothing for a row without open threads, or outside a Collection", async () => {
    await render(<DatabaseRowCommentCount item={row()} />);
    expect(container.querySelector("[data-database-row-comments]")).toBeNull();
    await render(
      <DatabaseRowCommentCount item={row({ open: 1, properties: {} })} />,
      false,
    );
    expect(container.querySelector("[data-database-row-comments]")).toBeNull();
  });
});
