// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionQuery: () => ({
    data: { components: [] },
    isPending: false,
    error: null,
  }),
}));

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

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

function cellOf(contents: Cell["contents"]): Cell {
  return {
    id: "cell",
    projectId: "project",
    versionId: "version",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    contents,
  };
}

const sqlCell = cellOf({
  ...base,
  kind: "sql",
  source: "SELECT 1",
  dataConnectionId: null,
  databaseSchema: null,
  resultVariable: null,
  outputResult: true,
});

function Wrapped({ children }: { children: React.ReactNode }) {
  return (
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      {children}
    </AgentNativeI18nProvider>
  );
}

function props(cell: Cell, extra: Record<string, unknown> = {}) {
  return {
    cell,
    title: "Cell",
    connections: [],
    canEdit: true,
    busy: false,
    running: false,
    saving: false,
    deleting: false,
    connectionPending: false,
    connectionId: null,
    draftText: "SELECT 1",
    dirty: false,
    stale: false,
    outputState: undefined,
    error: null,
    onTextChange: () => {},
    onSaveDraft: () => {},
    onRun: () => {},
    onDiscard: () => {},
    onOverwrite: () => {},
    onDelete: () => {},
    onSelectConnection: () => {},
    onDismissError: () => {},
    onRetryError: () => {},
    ...extra,
  };
}

async function openMenu(host: HTMLElement) {
  const trigger = host.querySelector<HTMLElement>(
    '[aria-label^="More actions for"]',
  );
  assert(trigger);
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

it("the cell menu prints each shortcut as the original does (ESC then ...)", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Wrapped>
          <NotebookCell
            {...props(sqlCell, {
              onAddAbove: () => {},
              onAddBelow: () => {},
              onMoveUp: () => {},
              onMoveDown: () => {},
              onDuplicateCell: () => {},
              onSaveContents: () => {},
              onFormatSql: async () => "SELECT 1",
            })}
          />
        </Wrapped>,
      ),
    );
    await openMenu(host);
    const hint = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((candidate) => candidate.textContent.trim() === name)
        ?.getAttribute("data-shortcut");
    expect(hint("Add above")).toBe("ESC then A");
    expect(hint("Add below")).toBe("ESC then B");
    expect(hint("Move up")).toBe("ESC then ⌘↑");
    expect(hint("Move down")).toBe("ESC then ⌘↓");
    expect(hint("Full screen")).toBe("ESC then FF");
    expect(hint("Format SQL")).toBe("ESC then FS");
    expect(hint("Delete cell")).toBe("ESC then D D");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
