import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Templates from "@/pages/Templates";

import {
  getBuiltInDeckTemplate,
  listBuiltInDeckTemplateSummaries,
} from "../../../server/lib/deck-templates";
import { DeckTemplateLibrary } from "./DeckTemplateLibrary";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  retry: vi.fn(),
  engine: vi.fn(),
  listError: false,
  listLoading: false,
  empty: false,
  invalidDetail: false,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  useActionQuery: (name: string, args: Record<string, unknown>) =>
    mocks.query(name, args),
  useActionMutation: () => ({ mutateAsync: mocks.create }),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentEngineConfigured: mocks.engine,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: { title?: string; current?: number }) =>
    key === "templatesPage.actions"
      ? `Actions ${params?.title ?? ""}`
      : key === "templatesPage.slidePosition"
        ? `Slide ${params?.current ?? 0}`
        : key,
}));
vi.mock("@agent-native/toolkit/app-shell", async (original) => ({
  ...(await original<typeof import("@agent-native/toolkit/app-shell")>()),
  useSetPageTitle: vi.fn(),
}));

function Location() {
  return (
    <output data-testid="location">
      {useLocation().pathname}
      {useLocation().search}
    </output>
  );
}
function mount({ home = false, entry = "/templates", page = false } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Location />
        <Routes>
          <Route
            path="/templates"
            element={page ? <Templates /> : <DeckTemplateLibrary />}
          />
          <Route
            path="/home"
            element={
              <>
                <textarea
                  aria-label="Home prompt"
                  defaultValue="Keep my draft"
                />
                <DeckTemplateLibrary home={home} />
              </>
            }
          />
          <Route path="/deck/:id" element={<div>Editable deck</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const catalog = listBuiltInDeckTemplateSummaries(true);
const first = catalog[0];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listError = false;
  mocks.listLoading = false;
  mocks.empty = false;
  mocks.invalidDetail = false;
  mocks.engine.mockImplementation(() => {
    throw new Error("Template copies must not require an AI provider");
  });
  mocks.create.mockResolvedValue({ id: "new-editable-deck" });
  mocks.query.mockImplementation(
    (name: string, args: Record<string, unknown>) => {
      if (name === "list-deck-templates") {
        const filtered = catalog.filter(
          (item) =>
            typeof args.search !== "string" ||
            item.title.toLowerCase().includes(args.search.toLowerCase()),
        );
        return {
          data:
            mocks.listError || mocks.listLoading
              ? undefined
              : {
                  templates: mocks.empty
                    ? []
                    : filtered.slice(0, Number(args.pageSize)),
                  total: filtered.length,
                },
          isLoading: mocks.listLoading,
          isError: mocks.listError,
          error: mocks.listError ? new Error("Catalog unavailable") : null,
          refetch: mocks.retry,
        };
      }
      const template = getBuiltInDeckTemplate(String(args.id));
      return {
        data: mocks.invalidDetail
          ? { title: first.title, slides: [] }
          : template,
        isError: !template,
        error: !template ? new Error("Template not found") : null,
        refetch: mocks.retry,
      };
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("real starter template library", () => {
  it("shows four real home previews, without fetching six details", () => {
    const view = mount({ home: true, entry: "/home" });
    expect(view.container.querySelectorAll("iframe")).toHaveLength(4);
    expect(
      mocks.query.mock.calls.every(([name]) => name === "list-deck-templates"),
    ).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(
      "list-deck-templates",
      expect.objectContaining({ pageSize: 4, includePreview: "true" }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("lists all six gallery templates and sandboxes the 960 by 540 artwork with no default body margin", () => {
    const view = mount();
    const frames = view.container.querySelectorAll("iframe");
    expect(frames).toHaveLength(6);
    expect(frames[0].getAttribute("sandbox")).toBe("");
    expect(frames[0].srcdoc).toContain("margin:0");
    expect(frames[0].srcdoc).toContain(first.previewHtml);
    expect(frames[0].className).toBe("deck-template-preview-frame");
    expect(frames[0].srcdoc).toContain("width:960px;height:540px");
  });
  it("opens the shared inset modal preview from the caption menu without copying or losing the home draft", async () => {
    mount({ home: true, entry: "/home" });
    const draft = screen.getByRole("textbox", { name: "Home prompt" });
    const trigger = screen.getByRole("button", {
      name: `Actions ${first.title}`,
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "templatesPage.previewAction",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByTestId("location").textContent).toContain(
      `templateId=${first.id}`,
    );
    expect(dialog.querySelector('[data-size="viewport"]')).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "templatesPage.useTemplate" }),
    ).toBeNull();
    await waitFor(
      () => expect(dialog.querySelector(".fmd-slide")).toBeTruthy(),
      { timeout: 5000 },
    );
    const firstContent = dialog.querySelector(".fmd-slide")!.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Slide 2" }));
    await waitFor(() =>
      expect(dialog.querySelector(".fmd-slide")!.textContent).not.toBe(
        firstContent,
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Slide 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "comments.close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("location").textContent).toBe("/home");
    expect(screen.getByRole("textbox", { name: "Home prompt" })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe("Keep my draft");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it.each(["/templates", "/home"])(
    "clicking a thumbnail on %s directly copies and opens without a dialog or AI gate",
    async (entry) => {
      mount({ entry, home: entry === "/home" });
      fireEvent.click(screen.getByRole("button", { name: first.title }));
      expect(mocks.create).toHaveBeenCalledWith({
        templateId: first.id,
        newId: expect.any(String),
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      await screen.findByText("Editable deck");
      expect(mocks.engine).not.toHaveBeenCalled();
      expect(screen.getByTestId("location").textContent).toBe(
        "/deck/new-editable-deck",
      );
    },
  );
  it("opens a direct/reloaded preview URL as a read-only viewer without creating a deck", async () => {
    mount({ entry: `/templates?templateId=${first.id}` });
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(dialog.querySelector(".fmd-slide")).toBeTruthy(),
    );
    expect(
      screen.getByRole("navigation", { name: "header.slides" }),
    ).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "templatesPage.useTemplate" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "templatesPage.previous" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "templatesPage.next" }),
    ).toBeNull();
  });
  it("prevents duplicate clicks, retains the draft on failure, and retries the same copy ID", async () => {
    let reject!: (cause: Error) => void;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    mount({ home: true, entry: "/home" });
    const draft = screen.getByRole("textbox", { name: "Home prompt" });
    const card = screen.getByRole("button", { name: first.title });
    fireEvent.click(card);
    fireEvent.click(card);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.getByText("templatesPage.opening")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => reject(new Error("Unable to save deck")));
    expect(screen.getByRole("alert").textContent).toContain(
      "Unable to save deck",
    );
    expect(screen.getByTestId("location").textContent).toBe("/home");
    expect(screen.getByRole("textbox", { name: "Home prompt" })).toBe(draft);
    fireEvent.click(screen.getByRole("button", { name: "home.retry" }));
    await screen.findByText("Editable deck");
    expect(mocks.create.mock.calls[1][0]).toEqual(
      mocks.create.mock.calls[0][0],
    );
  });
  it("shows malformed empty detail as a retryable error, never a blank ready viewer", () => {
    mocks.invalidDetail = true;
    mount({ entry: `/templates?templateId=${first.id}` });
    expect(screen.getByRole("alert").textContent).toContain(
      "templatesPage.loadFailed",
    );
    expect(
      screen.queryByRole("button", { name: "templatesPage.useTemplate" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "home.retry" }));
    expect(mocks.retry).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("distinguishes a failed library read from an empty library and offers retry", () => {
    mocks.listError = true;
    mount();
    expect(screen.getByRole("alert").textContent).toContain(
      "Catalog unavailable",
    );
    expect(screen.queryByText("templatesPage.empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "home.retry" }));
    expect(mocks.retry).toHaveBeenCalled();
  });
  it("shows loading geometry and a successful empty result distinctly", () => {
    mocks.listLoading = true;
    const loading = mount();
    expect(
      screen.getByRole("status", { name: "templatesPage.loading" }),
    ).toBeTruthy();
    loading.unmount();
    mocks.listLoading = false;
    mocks.empty = true;
    mount();
    expect(screen.getByText("templatesPage.empty")).toBeTruthy();
  });
  it("keeps searchable gallery state in the URL for reloads", async () => {
    mount({ page: true, entry: "/templates?search=missing" });
    const search = screen.getByRole("textbox", {
      name: "templatesPage.searchPlaceholder",
    });
    expect((search as HTMLInputElement).value).toBe("missing");
    fireEvent.change(search, { target: { value: "pitch" } });
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/templates?search=pitch",
      ),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      "list-deck-templates",
      expect.objectContaining({ search: "pitch", pageSize: 6 }),
    );
    expect(document.querySelector("main")).toBeNull();
  });
});
