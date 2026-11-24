// @vitest-environment happy-dom

import type {
  BuilderArticleAutosaveStatus,
  BuilderArticleRowStatus,
  ListBuilderArticleAutosavesResponse,
} from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn<(variables: unknown) => Promise<unknown>>(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useActionQuery: vi.fn(),
}));

vi.mock("./use-content-action-mutation", () => ({
  useContentActionMutation: () => ({ mutateAsync }),
}));

vi.mock("./use-content-database", () => ({
  contentDatabaseConstrainedQueryFilter: () => ({}),
  contentDatabaseItemsContainingDocumentFilter: () => ({}),
}));

import {
  BUILDER_AUTOSAVE_ACTIVE_POLL_MS,
  BUILDER_AUTOSAVE_IDLE_POLL_MS,
  BUILDER_AUTOSAVE_RUN_RETRY_MS,
  builderAutosavePollMs,
  useBuilderArticleAutosaveRunner,
  useBuilderAutosaveRunError,
} from "./use-builder-article-autosave";

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
  documentId: string,
  autosave: BuilderArticleAutosaveStatus | null = status(),
): BuilderArticleRowStatus {
  return {
    documentId,
    databaseId: "db-builder",
    sourceId: "src-builder",
    databaseItemId: `item-${documentId}`,
    entryId: `entry-${documentId}`,
    builderUrl: null,
    autosave,
  };
}

function listed(
  rows: BuilderArticleRowStatus[],
): ListBuilderArticleAutosavesResponse {
  return { databaseId: "db-builder", sourceId: "src-builder", rows };
}

function Runner({
  rows,
  documentId,
}: {
  rows: BuilderArticleRowStatus[];
  documentId: string;
}) {
  useBuilderArticleAutosaveRunner(rows);
  const error = useBuilderAutosaveRunError(documentId);
  return <span data-run-error={error ?? ""} />;
}

describe("builderAutosavePollMs", () => {
  it("polls fast only while a save is due or running", () => {
    const poll = (rows: BuilderArticleRowStatus[]) =>
      builderAutosavePollMs(listed(rows));
    expect(builderAutosavePollMs(undefined)).toBe(
      BUILDER_AUTOSAVE_IDLE_POLL_MS,
    );
    expect(poll([row("doc-idle")])).toBe(BUILDER_AUTOSAVE_IDLE_POLL_MS);
    expect(poll([row("doc-due", status({ due: true }))])).toBe(
      BUILDER_AUTOSAVE_ACTIVE_POLL_MS,
    );
    expect(poll([row("doc-settling", status({ dueSoon: true }))])).toBe(
      BUILDER_AUTOSAVE_ACTIVE_POLL_MS,
    );
    expect(poll([row("doc-saving", status({ state: "saving" }))])).toBe(
      BUILDER_AUTOSAVE_ACTIVE_POLL_MS,
    );
    expect(
      poll([row("doc-locked", status({ due: true, canSave: false }))]),
    ).toBe(BUILDER_AUTOSAVE_IDLE_POLL_MS);
    expect(poll([row("doc-failed", status({ state: "failed" }))])).toBe(
      BUILDER_AUTOSAVE_IDLE_POLL_MS,
    );
    expect(
      poll([row("doc-off", status({ enabled: false, state: "idle" }))]),
    ).toBe(BUILDER_AUTOSAVE_IDLE_POLL_MS);
  });
});

describe("useBuilderArticleAutosaveRunner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mutateAsync.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function settle(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  const runError = () =>
    container.querySelector("span")?.getAttribute("data-run-error");

  it("shows a save that didn't run and tries again only after the wait", async () => {
    const rows = [row("doc-retry", status({ due: true }))];
    mutateAsync.mockRejectedValueOnce(new Error("Network error"));
    act(() => root.render(<Runner rows={rows} documentId="doc-retry" />));
    await settle();

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(runError()).toBe("Network error");
    expect(builderAutosavePollMs(listed(rows))).toBe(
      BUILDER_AUTOSAVE_IDLE_POLL_MS,
    );

    await settle(BUILDER_AUTOSAVE_RUN_RETRY_MS - 1_000);
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    mutateAsync.mockResolvedValueOnce({});
    await settle(1_000);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(runError()).toBe("");

    await settle(BUILDER_AUTOSAVE_RUN_RETRY_MS * 3);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("starts the next save when a finished save leaves its row due", async () => {
    const rows = [row("doc-more", status({ due: true }))];
    mutateAsync
      .mockResolvedValueOnce(row("doc-more", status({ due: true })))
      .mockResolvedValueOnce(row("doc-more"));
    act(() => root.render(<Runner rows={rows} documentId="doc-more" />));
    await settle();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await settle(BUILDER_AUTOSAVE_ACTIVE_POLL_MS - 1_000);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    await settle(1_000);
    expect(mutateAsync).toHaveBeenCalledTimes(2);

    await settle(BUILDER_AUTOSAVE_RUN_RETRY_MS * 3);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("leaves a due row alone when the caller can't save it", async () => {
    act(() =>
      root.render(
        <Runner
          rows={[row("doc-locked", status({ due: true, canSave: false }))]}
          documentId="doc-locked"
        />,
      ),
    );
    await settle(BUILDER_AUTOSAVE_RUN_RETRY_MS);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("clears the error once the row has nothing left to save", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Network error"));
    act(() =>
      root.render(
        <Runner
          rows={[row("doc-cleared", status({ due: true }))]}
          documentId="doc-cleared"
        />,
      ),
    );
    await settle();
    expect(runError()).toBe("Network error");

    act(() =>
      root.render(
        <Runner rows={[row("doc-cleared")]} documentId="doc-cleared" />,
      ),
    );
    await settle();
    expect(runError()).toBe("");
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
