import { useRef } from "react";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";

import type { WorkflowShortcutId } from "./shortcuts";
import type { WorkflowCanvasStrings } from "./strings";

/** One row of a step's or the canvas's menu. The right-click menus and a step's More menu share these rows. */
export type MenuEntry =
  | { kind: "separator"; id: string }
  | {
      kind: "item";
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect: () => void;
    };

/**
 * The rows in the toolkit's context menu, which opens at the pointer. The menu
 * opens on the press that starts it, so releasing that press over a row would
 * pick the row. Only a press that starts on a row picks one.
 */
export function ContextMenuEntries({
  entries,
}: {
  entries: readonly MenuEntry[];
}) {
  const pressed = useRef(false);
  return (
    <>
      {entries.map((entry) =>
        entry.kind === "separator" ? (
          <ContextMenuSeparator key={entry.id} />
        ) : (
          <ContextMenuItem
            key={entry.id}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
            onPointerDown={() => {
              pressed.current = true;
            }}
            onPointerUp={(event) => {
              if (!pressed.current) event.preventDefault();
              pressed.current = false;
            }}
          >
            {entry.label}
            {entry.shortcut ? (
              <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut>
            ) : null}
          </ContextMenuItem>
        ),
      )}
    </>
  );
}

/** The same rows in a dropdown, for a step's More button. */
export function DropdownMenuEntries({
  entries,
}: {
  entries: readonly MenuEntry[];
}) {
  return (
    <>
      {entries.map((entry) =>
        entry.kind === "separator" ? (
          <DropdownMenuSeparator key={entry.id} />
        ) : (
          <DropdownMenuItem
            key={entry.id}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
          >
            {entry.label}
            {entry.shortcut ? (
              <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ),
      )}
    </>
  );
}

function item(
  id: string,
  label: string,
  options: { shortcut?: string; disabled?: boolean; onSelect: () => void },
): MenuEntry {
  return { kind: "item", id, label, ...options };
}

/** One divider between each pair of non-empty groups, so no divider stands at either end. */
function joinGroups(groups: readonly (readonly MenuEntry[])[]): MenuEntry[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0
        ? [...group]
        : [{ kind: "separator" as const, id: `divider-${index}` }, ...group],
    );
}

interface StepMenuInput {
  /** Steps selected. A step's menu is never opened with none. */
  count: number;
  readOnly: boolean;
  s: WorkflowCanvasStrings;
  testStepLabel: string;
  shortcut: (id: WorkflowShortcutId) => string;
  /** Opens the step's details; `name` focuses its name field. Absent when the page cannot open details. */
  openDetails?: (focus?: "name") => void;
  /** Tests the step. Absent when the page cannot test one step. */
  testStep?: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  clearSelection: () => void;
}

/**
 * A step's menu. One step gets open, test, rename and duplicate; several steps
 * get only the actions that take a group. Select all and delete follow either way.
 */
export function stepMenuEntries(input: StepMenuInput): MenuEntry[] {
  const { count, readOnly, s, shortcut, openDetails, testStep } = input;
  if (count === 0) return [];
  const single = count === 1;

  const opening: MenuEntry[] = [];
  if (single && openDetails) {
    opening.push(
      item("open", s.menu.openDetails, {
        shortcut: shortcut("open-details"),
        onSelect: () => openDetails(),
      }),
    );
  }
  if (single && testStep && !readOnly) {
    opening.push(item("test", input.testStepLabel, { onSelect: testStep }));
  }
  if (single && openDetails) {
    opening.push(
      item("rename", s.menu.rename, {
        shortcut: shortcut("rename"),
        disabled: readOnly,
        onSelect: () => openDetails("name"),
      }),
    );
  }
  const duplicating = item(
    "duplicate",
    single ? s.toolbar.duplicate : s.menu.duplicateMany(count),
    {
      shortcut: shortcut("duplicate"),
      disabled: readOnly,
      onSelect: input.duplicate,
    },
  );
  const selecting = [
    item("select-all", s.menu.selectAll, {
      shortcut: shortcut("select-all"),
      onSelect: input.selectAll,
    }),
    item("clear", s.menu.clearSelection, { onSelect: input.clearSelection }),
  ];
  const removing = item(
    "delete",
    single ? s.toolbar.delete : s.menu.deleteMany(count),
    {
      shortcut: shortcut("delete"),
      disabled: readOnly,
      onSelect: input.remove,
    },
  );
  return joinGroups([[...opening, duplicating], selecting, [removing]]);
}

interface CanvasMenuInput {
  readOnly: boolean;
  /** No steps on the canvas. */
  empty: boolean;
  hasSelection: boolean;
  s: WorkflowCanvasStrings;
  shortcut: (id: WorkflowShortcutId) => string;
  addStep: () => void;
  arrange: () => void;
  selectAll: () => void;
  clearSelection: () => void;
}

/** The canvas's own menu: add a step, arrange the steps, and the selection. */
export function canvasMenuEntries(input: CanvasMenuInput): MenuEntry[] {
  const { s, shortcut } = input;
  return joinGroups([
    [
      item("add", s.toolbar.addStep, {
        shortcut: shortcut("add-step"),
        disabled: input.readOnly,
        onSelect: input.addStep,
      }),
    ],
    [
      item("arrange", s.toolbar.arrange, {
        shortcut: shortcut("arrange"),
        disabled: input.readOnly || input.empty,
        onSelect: input.arrange,
      }),
    ],
    [
      item("select-all", s.menu.selectAll, {
        shortcut: shortcut("select-all"),
        disabled: input.empty,
        onSelect: input.selectAll,
      }),
      item("clear", s.menu.clearSelection, {
        disabled: !input.hasSelection,
        onSelect: input.clearSelection,
      }),
    ],
  ]);
}
