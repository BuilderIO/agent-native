// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionQuery: () => ({
    data: { components: [] },
    isPending: false,
    error: null,
  }),
}));

import enUS from "@/i18n/en-US";
import type { Cell, CellContents } from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

function makeSqlCell(
  overrides: Partial<Extract<CellContents, { kind: "sql" }>> = {},
): Cell {
  return {
    id: "cel_sql_1",
    projectId: "prj_1",
    versionId: "ver_1",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    contents: {
      id: "cel_sql_1",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "sql",
      source: "SELECT 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
      ...overrides,
    },
  };
}

function mountCell(cell: Cell, draftText: string, onSaveContents = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async (nextCell = cell, nextDraft = draftText) => {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <NotebookCell
            cell={nextCell}
            title={nextCell.contents.label ?? "SQL 1"}
            connections={[]}
            canEdit
            busy={false}
            running={false}
            saving={false}
            deleting={false}
            connectionPending={false}
            connectionId={null}
            draftText={nextDraft}
            dirty={
              nextDraft !==
              (nextCell.contents.kind === "sql" ? nextCell.contents.source : "")
            }
            stale={false}
            outputState={undefined}
            error={null}
            onTextChange={() => {}}
            onSaveDraft={() => {}}
            onSaveContents={onSaveContents}
            onRun={() => {}}
            onDiscard={() => {}}
            onOverwrite={() => {}}
            onDelete={() => {}}
            onSelectConnection={() => {}}
            onDismissError={() => {}}
            onRetryError={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  };
  const close = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, render, close, onSaveContents };
}

describe("NotebookCell rename", () => {
  it("renames a cell via title button and cancels on Escape without saving", async () => {
    const { host, render, close, onSaveContents } = mountCell(
      makeSqlCell(),
      "SELECT 1",
    );
    try {
      await render();
      const btn = host.querySelector<HTMLButtonElement>("button.nb-cell-title");
      expect(btn).not.toBeNull();
      await act(async () => {
        btn!.click();
      });
      const input = host.querySelector<HTMLInputElement>(
        "input.nb-cell-title-input",
      );
      expect(input).not.toBeNull();

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "Temporary title");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(host.querySelector("input.nb-cell-title-input")).toBeNull();
      expect(onSaveContents).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("preserves unsaved draftText when renaming a cell", async () => {
    const { host, render, close, onSaveContents } = mountCell(
      makeSqlCell({ source: "SELECT 1" }),
      "SELECT 42 AS answer",
    );
    try {
      await render();
      const btn = host.querySelector<HTMLButtonElement>("button.nb-cell-title");
      expect(btn).not.toBeNull();
      await act(async () => {
        btn!.click();
      });
      const input = host.querySelector<HTMLInputElement>(
        "input.nb-cell-title-input",
      );
      expect(input).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "Answer SQL");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(onSaveContents).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "Answer SQL",
          source: "SELECT 42 AS answer",
        }),
      );
    } finally {
      await close();
    }
  });

  it("skips saving when clearing an already-default title or saving whitespace-padded identical title", async () => {
    const { host, render, close, onSaveContents } = mountCell(
      makeSqlCell({ label: null }),
      "SELECT 1",
    );
    try {
      await render();
      const btn = host.querySelector<HTMLButtonElement>("button.nb-cell-title");
      await act(async () => {
        btn!.click();
      });
      const input = host.querySelector<HTMLInputElement>(
        "input.nb-cell-title-input",
      );
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "   ");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(onSaveContents).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
