// @vitest-environment happy-dom

import type {
  BuilderArticleAutosaveStatus,
  BuilderArticleRowStatus,
} from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runMutate,
  setMutate,
  running,
  runErrors,
  runner,
  listed,
  targets,
  polls,
} = vi.hoisted(() => ({
  runMutate: vi.fn(),
  setMutate: vi.fn(),
  running: { ids: new Set<string>() },
  runErrors: { byId: new Map<string, string>() },
  runner: vi.fn<(rows: BuilderArticleRowStatus[] | undefined) => void>(),
  listed: {
    data: undefined as { rows: BuilderArticleRowStatus[] } | undefined,
  },
  targets: vi.fn<(target: unknown) => void>(),
  polls: vi.fn<(poll: boolean) => void>(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/hooks/use-builder-article-autosave", () => ({
  builderArticleAutosaveRows: (
    data: { rows?: BuilderArticleRowStatus[] } | undefined,
  ) => (Array.isArray(data?.rows) ? data.rows : []),
  builderArticleRowIdentity: (row: BuilderArticleRowStatus) => ({
    rowDocumentId: row.documentId,
    databaseId: row.databaseId,
    sourceId: row.sourceId,
  }),
  builderArticleRowTarget: (
    rowDocumentId: string,
    databaseId: string | null | undefined,
  ) => (databaseId ? { rowDocumentId, databaseId } : { rowDocumentId }),
  useBuilderArticleAutosaves: (
    target: unknown,
    options: { poll?: boolean } = {},
  ) => {
    targets(target);
    polls(options.poll ?? true);
    return { data: listed.data };
  },
  useBuilderArticleAutosaveRunner: runner,
  useBuilderAutosaveRunError: (documentId: string) =>
    runErrors.byId.get(documentId) ?? null,
  useBuilderAutosaveRunning: (documentId: string) =>
    running.ids.has(documentId),
  useRunBuilderArticleAutosave: () => ({ mutate: runMutate, isPending: false }),
  useSetBuilderArticleAutosave: () => ({ mutate: setMutate, isPending: false }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { AutoSyncToggle } from "../AutoSyncToggle";
import {
  BuilderArticleAutosavePanel,
  BuilderArticleAutosavePanelView,
  BuilderArticleAutosaveRunner,
  BuilderArticleCellStatus,
  BuilderArticleCellStatusView,
  BuilderArticleRowAutosaveRunner,
  builderAutosaveView,
} from "./BuilderArticleAutosave";

const t = (key: string) => key;

function status(
  overrides: Partial<BuilderArticleAutosaveStatus> = {},
): BuilderArticleAutosaveStatus {
  return {
    enabled: true,
    state: "saved",
    reason: null,
    error: null,
    lastSavedAt: "2026-06-29T15:00:00.000Z",
    due: false,
    dueSoon: false,
    canSave: true,
    ...overrides,
  };
}

function row(
  autosave: BuilderArticleAutosaveStatus | null = status(),
): BuilderArticleRowStatus {
  return {
    documentId: "doc-row",
    databaseId: "db-builder",
    sourceId: "src-builder",
    databaseItemId: "item-1",
    entryId: "entry-1",
    builderUrl: "https://builder.io/content/entry-1",
    autosave,
  };
}

describe("Builder article autosave", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    runMutate.mockReset();
    setMutate.mockReset();
    runner.mockReset();
    targets.mockReset();
    polls.mockReset();
    listed.data = undefined;
    running.ids = new Set();
    runErrors.byId = new Map();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function render(node: ReactNode) {
    act(() => root.render(<TooltipProvider>{node}</TooltipProvider>));
  }

  const switchButton = () =>
    container.querySelector<HTMLButtonElement>('[role="switch"]');

  it("runs a row page's saves only for someone who can edit it", () => {
    const due = row(status({ due: true }));
    listed.data = { rows: [due] };

    render(<BuilderArticleRowAutosaveRunner documentId="doc-row" canEdit />);
    render(<BuilderArticleRowAutosaveRunner documentId="doc-row" canEdit />);
    expect(runner).toHaveBeenLastCalledWith([due]);
    const [first, second] = runner.mock.calls.map(([rows]) => rows);
    expect(second).toBe(first);
    expect(container.textContent).toBe("");

    render(
      <BuilderArticleRowAutosaveRunner documentId="doc-row" canEdit={false} />,
    );
    expect(runner).toHaveBeenLastCalledWith(undefined);
  });

  it("polls a collection's save status once, from its runner, for everyone", () => {
    const due = row(status({ due: true }));
    listed.data = { rows: [due] };

    render(
      <>
        <BuilderArticleAutosaveRunner
          collectionDocumentId="db-doc"
          canEdit={false}
        />
        <BuilderArticleCellStatus
          collectionDocumentId="db-doc"
          documentId="doc-row"
          canEdit={false}
        />
        <BuilderArticleCellStatus
          collectionDocumentId="db-doc"
          documentId="doc-other"
          canEdit={false}
        />
      </>,
    );
    expect(polls.mock.calls).toEqual([[true], [false], [false]]);
    expect(runner).toHaveBeenLastCalledWith(undefined);

    render(
      <BuilderArticleAutosaveRunner collectionDocumentId="db-doc" canEdit />,
    );
    expect(runner).toHaveBeenLastCalledWith([due]);
  });

  it("leaves a row page's polling to its runner", () => {
    listed.data = { rows: [row()] };

    render(
      <>
        <BuilderArticleRowAutosaveRunner documentId="doc-row" canEdit />
        <BuilderArticleAutosavePanel documentId="doc-row" canEdit />
      </>,
    );
    expect(polls.mock.calls).toEqual([[true], [false]]);
  });

  it("asks for the row in the Builder collection the page shows", () => {
    render(
      <BuilderArticleRowAutosaveRunner
        documentId="doc-row"
        databaseId="db-builder"
        canEdit
      />,
    );
    expect(targets).toHaveBeenLastCalledWith({
      rowDocumentId: "doc-row",
      databaseId: "db-builder",
    });

    render(
      <BuilderArticleRowAutosaveRunner
        documentId="doc-row"
        databaseId={null}
        canEdit
      />,
    );
    expect(targets).toHaveBeenLastCalledWith({ rowDocumentId: "doc-row" });
  });

  it("renders the shared switch as a focusable switch that flips its value", () => {
    const onCheckedChange = vi.fn();
    render(
      <AutoSyncToggle
        label="Save to Builder"
        checked
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = switchButton();
    expect(toggle?.tagName).toBe("BUTTON");
    expect(toggle?.type).toBe("button");
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(toggle?.textContent).toBe("Save to Builder");
    toggle?.focus();
    expect(document.activeElement).toBe(toggle);
    act(() => toggle?.click());
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("shows a saved article's status, link and switch on its page", () => {
    render(<BuilderArticleAutosavePanelView row={row()} canEdit />);

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "builderAutosave.stateSaved",
    );
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.href).toBe("https://builder.io/content/entry-1");
    expect(link?.target).toBe("_blank");
    expect(link?.textContent).toContain("builderAutosave.openInBuilder");
    expect(switchButton()?.getAttribute("aria-checked")).toBe("true");

    act(() => switchButton()?.click());
    expect(setMutate).toHaveBeenCalledWith(
      {
        rowDocumentId: "doc-row",
        databaseId: "db-builder",
        sourceId: "src-builder",
        enabled: false,
      },
      expect.anything(),
    );
  });

  it("offers Retry after a failed save", () => {
    render(
      <BuilderArticleAutosavePanelView
        row={row(
          status({
            state: "failed",
            reason: "save_failed",
            error: "Builder returned 500.",
          }),
        )}
        canEdit
      />,
    );

    expect(container.textContent).toContain("builderAutosave.stateFailed");
    expect(container.textContent).toContain(
      "builderAutosave.reasonSaveFailed Builder returned 500.",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "builderAutosave.retry",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(runMutate).toHaveBeenCalledWith(
      {
        rowDocumentId: "doc-row",
        databaseId: "db-builder",
        sourceId: "src-builder",
        retry: true,
      },
      expect.anything(),
    );
  });

  it("says a published article goes through Review Builder update, with no switch", () => {
    render(
      <BuilderArticleAutosavePanelView
        row={row(
          status({
            enabled: false,
            state: "review",
            reason: "published",
          }),
        )}
        canEdit
      />,
    );

    expect(container.textContent).toContain("builderAutosave.stateReview");
    expect(container.textContent).toContain("builderAutosave.reasonPublished");
    expect(switchButton()).toBeNull();
  });

  it("shows only the Builder link for an article that was already in Builder", () => {
    render(<BuilderArticleAutosavePanelView row={row(null)} canEdit />);

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(switchButton()).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://builder.io/content/entry-1",
    );
  });

  it("hides the switch from people who can't edit the article", () => {
    render(<BuilderArticleAutosavePanelView row={row()} canEdit={false} />);
    expect(switchButton()).toBeNull();
  });

  it.each([
    ["to people who can't edit", true, false],
    ["when the caller can't save that row", false, true],
  ])("shows a failed save without Retry %s", (_when, canSave, canEdit) => {
    const failed = row(
      status({ state: "failed", reason: "save_failed", canSave }),
    );
    render(
      <>
        <BuilderArticleAutosavePanelView row={failed} canEdit={canEdit} />
        <BuilderArticleCellStatusView row={failed} canEdit={canEdit} />
      </>,
    );

    expect(container.textContent).toContain("builderAutosave.stateFailed");
    expect(
      container.querySelector('button[aria-label="builderAutosave.retry"]'),
    ).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "builderAutosave.retry",
      ),
    ).toBe(false);
    expect(
      container.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toBe("builderAutosave.stateFailed");
  });

  it("puts a focusable status and Builder link in the table cell", () => {
    render(
      <BuilderArticleCellStatusView
        row={row(
          status({ state: "waiting", reason: "builder_editor_changes" }),
        )}
        canEdit
      />,
    );

    const icon = container.querySelector<HTMLElement>('[role="img"]');
    expect(icon?.getAttribute("aria-label")).toBe(
      "builderAutosave.stateWaiting",
    );
    expect(icon?.tabIndex).toBe(0);
    icon?.focus();
    expect(document.activeElement).toBe(icon);
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("aria-label")).toBe(
      "builderAutosave.openInBuilder",
    );
    expect(link?.getAttribute("href")).toBe(
      "https://builder.io/content/entry-1",
    );
  });

  it("makes a failed cell a Retry button that doesn't open the row", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <BuilderArticleCellStatusView
          row={row(status({ state: "failed", reason: "save_failed" }))}
          canEdit
        />
      </div>,
    );

    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="builderAutosave.retry"]',
    );
    expect(retry).not.toBeNull();
    act(() => retry?.click());
    expect(runMutate).toHaveBeenCalledWith(
      {
        rowDocumentId: "doc-row",
        databaseId: "db-builder",
        sourceId: "src-builder",
        retry: true,
      },
      expect.anything(),
    );
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("shows a save that didn't run as failed, with a retry", () => {
    runErrors.byId = new Map([["doc-row", "Network error"]]);
    render(
      <BuilderArticleCellStatusView row={row(status({ due: true }))} canEdit />,
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="builderAutosave.retry"]',
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(runMutate).toHaveBeenCalledWith(
      expect.objectContaining({ rowDocumentId: "doc-row", retry: true }),
      expect.anything(),
    );
  });

  it("shows a row as saving while its save runs", () => {
    running.ids = new Set(["doc-row"]);
    render(<BuilderArticleCellStatusView row={row()} canEdit />);
    expect(
      container.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toBe("builderAutosave.stateSaving");
  });
});

describe("builderAutosaveView", () => {
  it("names what each stop is waiting on", () => {
    expect(
      builderAutosaveView(
        status({ state: "waiting", reason: "checking_last_save" }),
        false,
        t,
      ),
    ).toMatchObject({
      tone: "waiting",
      label: "builderAutosave.stateWaiting",
      detail: "builderAutosave.reasonCheckingLastSave",
      canRetry: false,
    });
    expect(
      builderAutosaveView(
        status({ state: "waiting", reason: "builder_body_unread" }),
        false,
        t,
      ),
    ).toMatchObject({
      tone: "waiting",
      label: "builderAutosave.stateWaiting",
      detail: "builderAutosave.reasonBuilderBodyUnread",
      canRetry: false,
    });
    expect(
      builderAutosaveView(
        status({
          state: "failed",
          reason: "builder_body_unreadable",
          error: "Builder no longer returns this source entry.",
        }),
        false,
        t,
      ),
    ).toMatchObject({
      tone: "error",
      label: "builderAutosave.stateFailed",
      detail:
        "builderAutosave.reasonBuilderBodyUnreadable Builder no longer returns this source entry.",
      canRetry: true,
    });
    expect(
      builderAutosaveView(
        status({
          state: "failed",
          reason: "builder_changed",
          error: "Title changed in Builder since you edited it.",
        }),
        false,
        t,
      ),
    ).toMatchObject({
      tone: "error",
      detail: "builderAutosave.reasonBuilderChanged",
      canRetry: true,
    });
    expect(
      builderAutosaveView(
        status({ state: "review", reason: "unconfirmed_save" }),
        true,
        t,
      ),
    ).toMatchObject({
      tone: "muted",
      label: "builderAutosave.stateReview",
      detail: "builderAutosave.reasonUnconfirmedSave",
      canRetry: false,
    });
    expect(
      builderAutosaveView(status({ enabled: false, state: "idle" }), false, t),
    ).toMatchObject({ label: "builderAutosave.stateOff", canRetry: false });
    expect(
      builderAutosaveView(status({ due: true }), false, t, "Network error"),
    ).toMatchObject({
      tone: "error",
      label: "builderAutosave.stateFailed",
      detail: "builderAutosave.reasonRunFailed Network error",
      canRetry: true,
    });
    expect(
      builderAutosaveView(status({ due: true }), true, t, "Network error"),
    ).toMatchObject({ label: "builderAutosave.stateSaving" });
  });
});
