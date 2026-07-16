// @vitest-environment happy-dom

import type {
  ContentDatabaseSource,
  ContentDatabaseSourceReviewPayload,
} from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

import { BuilderSourceReviewDialog } from "./BuilderSourceReviewDialog";

const source = {
  id: "builder-source",
  sourceType: "builder-cms",
  metadata: {
    primaryKey: "id",
    titleField: "data.title",
    writeMode: "stage_only",
  },
  changeSets: [{ id: "change-1" }, { id: "change-2" }, { id: "change-3" }],
} as ContentDatabaseSource;

const review = {
  sourceName: "Builder",
  sourceTable: "article",
  rows: [
    {
      changeSetId: "change-1",
      databaseItemId: "item-1",
      documentId: "document-1",
      title: "First article",
      effect: "create_draft",
      conflictState: "none",
      fieldChanges: [],
      bodyChange: null,
      riskLevel: "low",
      riskReasons: [],
      execution: null,
    },
    {
      changeSetId: "change-2",
      databaseItemId: "item-2",
      documentId: "document-2",
      title: "Second article",
      effect: "create_draft",
      conflictState: "none",
      fieldChanges: [],
      bodyChange: null,
      riskLevel: "low",
      riskReasons: [],
      execution: null,
    },
    {
      changeSetId: "change-3",
      databaseItemId: "item-3",
      documentId: "document-3",
      title: "Third article",
      effect: "create_draft",
      conflictState: "none",
      fieldChanges: [],
      bodyChange: null,
      riskLevel: "low",
      riskReasons: [],
      execution: null,
    },
  ],
  totalRowCount: 3,
  summary: "Three drafts",
  dryRunOnly: false,
  riskLevel: "low",
  riskReasons: [],
  liveWritesEnabled: true,
  pushMode: "autosave",
  result: { status: "validated", message: "Ready" },
} satisfies ContentDatabaseSourceReviewPayload;

describe("BuilderSourceReviewDialog row selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("prepares exactly 1 of 3 rows, shows the authoritative body review, then confirms it", () => {
    const onValidate = vi.fn();
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={review}
          source={source}
          canEdit
          pending={false}
          checkedAt={null}
          onClose={vi.fn()}
          onValidate={onValidate}
        />,
      );
    });

    const rowCheckboxes = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
    );
    expect(rowCheckboxes).toHaveLength(3);
    expect(
      rowCheckboxes.map((checkbox) => checkbox.getAttribute("aria-label")),
    ).toEqual(["First article", "Second article", "Third article"]);

    const initialCta = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Review details"));
    expect(initialCta?.disabled).toBe(true);

    act(() => rowCheckboxes[1]?.click());

    const selectedCta = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Review details"));
    expect(selectedCta?.disabled).toBe(false);
    act(() => selectedCta?.click());

    expect(onValidate).toHaveBeenCalledWith({
      changeSetIds: ["change-2"],
      transitions: {},
    });

    const preparedReview = {
      ...review,
      rows: [
        {
          ...review.rows[1]!,
          changeSetId: "change-2-revision-deadbeef",
          bodyChange: {
            summary: "Builder body blocks changed.",
            currentExcerpt: "Old body",
            proposedExcerpt: "New body",
            proposedHash: "prepared-body-hash",
            proposedContent: "New body",
            proposedBlocksJson: "[]",
            sidecarsJson: "{}",
            warnings: ["Embedded video will be preserved by reference."],
          },
          execution: null,
        },
      ],
      totalRowCount: 1,
    } satisfies ContentDatabaseSourceReviewPayload;
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={preparedReview}
          source={source}
          canEdit
          pending={false}
          checkedAt={null}
          preparedForExecution
          selectionChangeSetIdMap={{
            "change-2": "change-2-revision-deadbeef",
          }}
          onClose={vi.fn()}
          onValidate={onValidate}
        />,
      );
    });

    expect(document.body.textContent).toContain("Builder body blocks changed.");
    expect(document.body.textContent).toContain(
      "Embedded video will be preserved by reference.",
    );
    expect(document.body.textContent).toContain(
      "Review the full payload above, then confirm this Builder write.",
    );
    expect(document.body.textContent).not.toContain("Review details");

    const confirmationCta = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Create draft"));
    expect(confirmationCta?.disabled).toBe(false);
    act(() => confirmationCta?.click());
    expect(onValidate).toHaveBeenCalledTimes(2);
    expect(onValidate).toHaveBeenLastCalledWith({
      changeSetIds: ["change-2-revision-deadbeef"],
      transitions: {},
    });
  });

  it("shows the exact linked Builder target for an existing-entry update", () => {
    const linkedReview = {
      ...review,
      rows: [
        {
          ...review.rows[0],
          effect: "update_in_place" as const,
          targetEntryId: "1ce2e96574be4b22baf1e11480520205",
        },
      ],
      totalRowCount: 1,
    };
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={linkedReview}
          source={source}
          canEdit
          pending={false}
          checkedAt={null}
          onClose={vi.fn()}
          onValidate={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain(
      "Builder entry 1ce2e96574be4b22baf1e11480520205",
    );
  });

  it("automatically selects an explicitly scoped review", () => {
    const onValidate = vi.fn();
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={review}
          source={source}
          canEdit
          pending={false}
          checkedAt={null}
          autoSelectReviewRows
          onClose={vi.fn()}
          onValidate={onValidate}
        />,
      );
    });

    const rowCheckboxes = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
    );
    expect(rowCheckboxes).toHaveLength(3);
    expect(
      rowCheckboxes.every(
        (checkbox) => checkbox.getAttribute("data-state") === "checked",
      ),
    ).toBe(true);
    const cta = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Review details"));
    expect(cta?.disabled).toBe(false);
  });

  it("distinguishes loading and failed previews from a true empty diff", () => {
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={null}
          source={source}
          canEdit
          pending
          checkedAt={null}
          onClose={vi.fn()}
          onValidate={vi.fn()}
        />,
      );
    });
    expect(document.body.textContent).toContain(
      "database.loadingCompleteBuilderDiff",
    );
    expect(document.body.textContent).not.toContain(
      "database.noPendingLocalBuilderChanges",
    );

    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={null}
          source={source}
          canEdit
          pending={false}
          error="Preview failed safely."
          checkedAt={null}
          onClose={vi.fn()}
          onValidate={vi.fn()}
        />,
      );
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Preview failed safely.",
    );
  });

  it("keeps a prepare failure visible and clears it when the selection changes", () => {
    const onSelectionChange = vi.fn();
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={review}
          source={source}
          canEdit
          pending={false}
          error="Push mode confirmation did not match approved change set: publish."
          checkedAt={null}
          onClose={vi.fn()}
          onValidate={vi.fn()}
          onSelectionChange={onSelectionChange}
        />,
      );
    });

    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(alert?.textContent).toContain("Push mode confirmation");

    const firstRow =
      document.body.querySelector<HTMLButtonElement>('[role="checkbox"]');
    act(() => firstRow?.click());
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a selected row checked when a running review narrows from three rows to one", () => {
    const props = {
      open: true,
      source,
      canEdit: true,
      pending: false,
      onClose: vi.fn(),
      onValidate: vi.fn(),
    };
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          {...props}
          review={review}
          checkedAt={null}
        />,
      );
    });
    const firstRow =
      document.body.querySelector<HTMLButtonElement>('[role="checkbox"]');
    act(() => firstRow?.click());

    const runningReview = {
      ...review,
      rows: [review.rows[0]!],
      totalRowCount: 1,
      result: { status: "running", message: "Builder push is running." },
    } satisfies ContentDatabaseSourceReviewPayload;
    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          {...props}
          review={runningReview}
          checkedAt="2026-07-13T20:00:00.000Z"
        />,
      );
    });

    expect(document.body.textContent).toContain("1 draft to create");
    expect(document.body.textContent).not.toContain("No changes");
    expect(
      document.body
        .querySelector<HTMLButtonElement>('[role="checkbox"]')
        ?.getAttribute("data-state"),
    ).toBe("checked");
    const workingButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("database.working"));
    expect(workingButton?.disabled).toBe(true);
  });

  it("shows and wires cancellation only for a provably pre-dispatch prepared row", () => {
    const onCancelPrepared = vi.fn();
    const preparedReview = {
      ...review,
      rows: [
        {
          ...review.rows[0]!,
          execution: {
            id: "execution-ready",
            changeSetId: "change-1",
            adapter: "builder-cms",
            pushMode: "autosave",
            state: "ready",
            idempotencyKey: "ready-key",
            summary: "Ready",
            payload: { dryRun: { status: "validated" } },
            lastError: null,
            createdAt: "2026-07-13T20:00:00.000Z",
            updatedAt: "2026-07-13T20:00:00.000Z",
          },
        },
        {
          ...review.rows[1]!,
          execution: {
            id: "execution-running",
            changeSetId: "change-2",
            adapter: "builder-cms",
            pushMode: "autosave",
            state: "running",
            idempotencyKey: "running-key",
            summary: "Running",
            payload: {},
            lastError: null,
            createdAt: "2026-07-13T20:00:00.000Z",
            updatedAt: "2026-07-13T20:00:00.000Z",
          },
        },
        {
          ...review.rows[2]!,
          execution: {
            id: "execution-response",
            changeSetId: "change-3",
            adapter: "builder-cms",
            pushMode: "autosave",
            state: "ready",
            idempotencyKey: "response-key",
            summary: "Response checkpoint",
            payload: { response: { status: 200 } },
            lastError: null,
            createdAt: "2026-07-13T20:00:00.000Z",
            updatedAt: "2026-07-13T20:00:00.000Z",
          },
        },
      ],
    } satisfies ContentDatabaseSourceReviewPayload;

    act(() => {
      root.render(
        <BuilderSourceReviewDialog
          open
          review={preparedReview}
          source={source}
          canEdit
          pending={false}
          checkedAt={null}
          preparedForExecution
          onClose={vi.fn()}
          onValidate={vi.fn()}
          onCancelPrepared={onCancelPrepared}
        />,
      );
    });

    const cancellationButtons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) =>
      button.textContent?.includes("database.cancelPreparedUpdate"),
    );
    expect(cancellationButtons).toHaveLength(1);

    act(() => cancellationButtons[0]?.click());
    expect(document.body.textContent).toContain(
      "database.cancelPreparedUpdateQuestion",
    );

    const confirmButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) =>
        button !== cancellationButtons[0] &&
        button.textContent?.includes("database.cancelPreparedUpdate"),
    );
    act(() => confirmButton?.click());

    expect(onCancelPrepared).toHaveBeenCalledOnce();
    expect(onCancelPrepared).toHaveBeenCalledWith("change-1");
  });
});
