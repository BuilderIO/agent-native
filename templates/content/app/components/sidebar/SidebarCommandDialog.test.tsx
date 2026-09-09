// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SidebarCommandDialog from "./SidebarCommandDialog";

const mocks = vi.hoisted(() => ({
  document: vi.fn(),
  commands: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.commands,
}));
vi.mock("@/hooks/use-documents", () => ({
  useDocument: mocks.document,
  useUpdateDocument: () => ({ mutateAsync: mocks.update, isPending: false }),
  useMoveDocument: () => ({ mutateAsync: mocks.move, isPending: false }),
}));
vi.mock("@/components/editor/VisualEditor", () => ({
  VisualEditor: ({ content }: { content: string }) => (
    <div data-preview>{content}</div>
  ),
}));

const initialDocument = {
  id: "page",
  title: "Stale sidebar title",
  content: "Stale sidebar body",
  parentId: null,
  canEdit: true,
} as Document;

let root: Root;
let container: HTMLDivElement;
let documentQuery: ReturnType<typeof loadedQuery>;
let commandQuery: ReturnType<typeof loadedQuery>;

function loadedQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isFetchedAfterMount: true,
    isError: false,
    refetch: vi.fn(),
  };
}

async function render(command: "preview" | "rename" | "move") {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <SidebarCommandDialog
          document={initialDocument}
          command={command}
          onClose={vi.fn()}
          returnFocus={vi.fn()}
        />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  documentQuery = loadedQuery({
    ...initialDocument,
    title: "Cached secret title",
    content: "Cached secret body",
  });
  commandQuery = loadedQuery({
    title: "Authoritative current title",
    writeReason: null,
    destinations: [],
    canMoveToRoot: true,
  });
  mocks.document.mockImplementation(() => documentQuery);
  mocks.commands.mockImplementation(() => commandQuery);
  mocks.update.mockResolvedValue({ id: "page" });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("sidebar command authority", () => {
  it("withholds cached preview payload until the first authoritative fetch completes", async () => {
    documentQuery.isFetching = true;
    documentQuery.isFetchedAfterMount = false;
    await render("preview");
    expect(document.body.textContent).not.toContain("Cached secret");
    expect(document.querySelector("[data-preview]")).toBeNull();

    documentQuery = loadedQuery({
      ...initialDocument,
      title: "Fresh title",
      content: "Fresh body",
    });
    await render("preview");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-preview]")?.textContent).toBe(
        "Fresh body",
      ),
    );
    expect(document.body.textContent).toContain("Fresh title");
  });

  it("does not reveal cached title or body after an access failure", async () => {
    documentQuery.isError = true;
    await render("preview");
    expect(document.body.textContent).toContain("sidebarCommands.unavailable");
    expect(document.body.textContent).not.toContain("Cached secret");
    expect(document.querySelector("[data-preview]")).toBeNull();
  });

  it("uses the authoritative rename title and preserves the user's edit across refetches", async () => {
    await render("rename");
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="sidebarCommands.name"]',
    )!;
    expect(input.value).toBe("Authoritative current title");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "My revised title");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    commandQuery = loadedQuery({
      title: "Another fetched title",
      writeReason: null,
      destinations: [],
      canMoveToRoot: true,
    });
    await render("rename");
    expect(input.value).toBe("My revised title");
    await act(async () => {
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(mocks.update).toHaveBeenCalledWith({
      id: "page",
      title: "My revised title",
    });
  });

  it.each(["rename", "move"] as const)(
    "never exposes a mutation for denied %s authority",
    async (command) => {
      commandQuery = loadedQuery({
        title: "Current title",
        writeReason: "readOnly",
        destinations: [{ id: "target", title: "Destination" }],
        canMoveToRoot: true,
      });
      await render(command);
      expect(document.body.textContent).toContain("sidebarCommands.readOnly");
      expect(document.querySelector("form")).toBeNull();
      expect(document.querySelector("input")).toBeNull();
      await act(async () => {
        for (const button of document.querySelectorAll("button"))
          button.click();
      });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.move).not.toHaveBeenCalled();
    },
  );
});
