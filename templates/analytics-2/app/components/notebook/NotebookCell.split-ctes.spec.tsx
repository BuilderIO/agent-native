// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

const mockCallAction = vi.fn(async (_action: string, _payload?: unknown) => ({
  createdCellId: "cell_new",
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callAction: (action: string, payload?: unknown) =>
    mockCallAction(action, payload),
  useActionQuery: () => ({
    data: { components: [] },
    isPending: false,
    error: null,
  }),
}));

import { NotebookCell } from "./NotebookCell";

const base = {
  id: "cell",
  order: "a",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  mockCallAction.mockClear();
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

it("splits a WITH query into chained CTE cells from the SQL cell menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  const onSaveContents = vi.fn();
  const onTextChange = vi.fn();
  const sqlText =
    "WITH base AS (SELECT id FROM orders), agg AS (SELECT COUNT(*) AS n FROM base) SELECT * FROM agg";
  const cell: Cell = {
    id: "cell_1",
    projectId: "proj_1",
    versionId: "ver_1",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    contents: {
      ...base,
      id: "cell_1",
      kind: "sql",
      source: sqlText,
      dataConnectionId: "conn_bq",
      databaseSchema: null,
      resultVariable: "dataframe",
      outputResult: true,
    },
  };

  await act(async () => {
    root?.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <NotebookCell
          cell={cell}
          title="SQL 1"
          connections={[]}
          canEdit
          busy={false}
          running={false}
          saving={false}
          deleting={false}
          connectionPending={false}
          connectionId="conn_bq"
          draftText={sqlText}
          dirty={false}
          stale={false}
          runState={undefined}
          outputState={undefined}
          error={null}
          onTextChange={onTextChange}
          onSaveDraft={vi.fn()}
          onSaveContents={onSaveContents}
          onRun={vi.fn()}
          onDiscard={vi.fn()}
          onOverwrite={vi.fn()}
          onDelete={vi.fn()}
          onSelectConnection={vi.fn()}
          onDismissError={vi.fn()}
        />
      </AgentNativeI18nProvider>,
    );
  });

  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="More actions for SQL 1"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

  const splitItem = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("Split CTEs"));
  expect(splitItem).not.toBeUndefined();
  expect(splitItem?.getAttribute("aria-disabled")).not.toBe("true");

  await act(async () => {
    splitItem?.click();
  });

  expect(onTextChange).toHaveBeenCalledWith("SELECT id FROM orders");
  expect(onSaveContents).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "sql",
      source: "SELECT id FROM orders",
      resultVariable: "base",
    }),
  );
  expect(mockCallAction).toHaveBeenCalledTimes(2);
  expect(mockCallAction).toHaveBeenNthCalledWith(1, "add-project-cell", {
    projectId: "proj_1",
    kind: "sql",
    afterCellId: "cell_1",
    name: "agg",
    dataframe: "base",
    source: "SELECT COUNT(*) AS n FROM base",
  });
  expect(mockCallAction).toHaveBeenNthCalledWith(2, "add-project-cell", {
    projectId: "proj_1",
    kind: "sql",
    afterCellId: "cell_new",
    dataframe: "agg",
    source: "SELECT * FROM agg",
  });
});
