import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowsHorizontal,
  IconDots,
  IconGripVertical,
  IconLayoutSidebar,
  IconPlayerPlay,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notebookMessages } from "@/i18n/messages/notebook";
import type { CellKind, CellMenuEntry } from "@/lib/model/cell-types";
import type { Cell, CellOutput } from "@/lib/model/contracts";

import {
  APP_LAYOUT_HEIGHT_STEP,
  APP_LAYOUT_MAX_HEIGHT,
  APP_LAYOUT_MIN_HEIGHT,
  APP_LAYOUT_SNAP,
  APP_LAYOUT_SPAN,
  applyAppPatches,
  isAppRowDistributed,
  projectAppLayout,
  snapAppPosition,
  type AppDocument,
  type AppPatch,
} from "../../../shared/app-layout";
import { AddCellBar, type MoreCellEntry } from "./AddCellBar";
import { AppBuilderSettings } from "./AppBuilderSettings";
import { CellOutputView } from "./CellOutputView";
import { projectChartDataframes, type ChartDataframe } from "./chart-config";
import { ComponentImportBody } from "./ComponentImportBody";
import {
  InputCellControl,
  isRenderableInput,
  type InputCellContents,
} from "./InputCellControl";
import { MarkdownCellView } from "./MarkdownCellView";
import { CompleteMetricView } from "./MetricCell";
import { PivotCell } from "./PivotCell";
import { PythonCellOutput } from "./PythonCellOutput";
import { ReadOnlyChart } from "./ReadOnlyChart";
import { TableCell } from "./TableCell";
import type { LoadPythonPage, NotebookOutputs } from "./types";
import { cellTitleAtPosition, editableCellText } from "./utils";
import { VegaSpecChart } from "./VegaChart";

import "./app-builder.css";

const messages = notebookMessages.notebook.appBuilder;

type Place = Extract<AppPatch, { type: "place" }>;
export type BuilderPlacement = Omit<Place, "type" | "cellId">;
type AppRow = ReturnType<typeof projectAppLayout>["rows"][number];
type AppColumn = AppRow["columns"][number];
type AppElement = AppColumn["elements"][number];

type DragHandle =
  | { kind: "row"; rowId: string }
  | {
      kind: "element" | "width" | "height";
      rowId: string;
      column: AppColumn;
      element: AppElement;
    };
type Drag = DragHandle & { startX: number; startY: number };

type SourceRun = {
  start: () => void;
  disabled: boolean;
  running: boolean;
  error: string | null;
};

export function ProjectAppBuilder({
  cells,
  outputs,
  onLoadPythonPage,
  getVisualizationSourceResultId,
  canEdit: editable,
  layout,
  onChangeLayout,
  onViewCell,
  getSourceRun,
  onInsertCell,
  addEntries = [],
  supportedAddKinds,
  tabBookmark,
  onTabChange,
  onGenerate,
}: {
  cells: readonly Cell[];
  outputs: NotebookOutputs;
  onLoadPythonPage?: LoadPythonPage | undefined;
  getVisualizationSourceResultId?: (cell: Cell) => string | null;
  canEdit: boolean;
  layout: AppDocument;
  onChangeLayout?:
    | ((patches: readonly AppPatch[]) => Promise<AppDocument>)
    | undefined;
  onViewCell?: ((cellId: string) => void) | undefined;
  getSourceRun?: (cell: Cell) => SourceRun | undefined;
  onInsertCell?:
    | ((
        kind: CellKind,
        placement: BuilderPlacement,
        inputType?: CellMenuEntry["inputType"],
      ) => Promise<AppDocument>)
    | undefined;
  addEntries?: readonly MoreCellEntry[] | undefined;
  supportedAddKinds?: readonly CellKind[] | undefined;
  tabBookmark?: string | null | undefined;
  onTabChange?: ((tabId: string) => void) | undefined;
  onGenerate?: ((prompt: string) => Promise<void> | void) | undefined;
}) {
  const t = useT();
  const [optimistic, setOptimistic] = useState<AppDocument>();
  const [dragPreview, setDragPreview] = useState<AppDocument>();
  const [dragTarget, setDragTarget] = useState<string>();
  const [dragKind, setDragKind] = useState<Drag["kind"]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [selectedTab, setSelectedTab] = useState<string>();
  const [renameTab, setRenameTab] = useState<string>();
  const [deleteTabId, setDeleteTabId] = useState<string>();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const outline = useRef<HTMLElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const activeTabTrigger = useRef<HTMLButtonElement>(null);
  const focusActiveTab = useRef(false);
  const afterTabMenuClose = useRef<() => void>(undefined);
  const drag = useRef<Drag>(undefined);
  const outlineDragCell = useRef<string>(undefined);
  const pendingRef = useRef(false);
  const canEdit = editable && onChangeLayout !== undefined;
  const accepted = layout;
  const displayed = dragPreview ?? optimistic ?? accepted;
  const bookmark = tabBookmark === undefined ? selectedTab : tabBookmark;
  const acceptedProjection = useMemo(
    () => projectAppLayout(accepted, bookmark, canEdit),
    [accepted, bookmark, canEdit],
  );
  const { tab, rows } =
    displayed === accepted
      ? acceptedProjection
      : projectAppLayout(displayed, bookmark, canEdit);
  const acceptedRows = acceptedProjection.rows;
  const dataframes = useMemo(
    () => projectChartDataframes(cells, outputs),
    [cells, outputs],
  );
  const namedValues = useMemo(
    () =>
      new Map(
        cells.flatMap(({ contents }) =>
          contents.kind === "input"
            ? [[contents.name, contents.defaultValueString] as const]
            : [],
        ),
      ),
    [cells],
  );
  const cellById = useMemo(
    () =>
      new Map(
        cells.map((cell, index) => [
          cell.id,
          { cell, title: cellTitleAtPosition(cell.contents, index + 1), index },
        ]),
      ),
    [cells],
  );
  const membershipDocument = optimistic ?? accepted;
  const membershipByTab = useMemo(
    () =>
      new Map(
        membershipDocument.tabs.map((item) => [
          item.tabId,
          new Map<string, AppElement>(
            item.rows.flatMap(({ columns }) =>
              columns.flatMap(({ elements }) =>
                elements.map((element) => [element.cellId, element] as const),
              ),
            ),
          ),
        ]),
      ),
    [membershipDocument],
  );
  const tabToDelete = accepted.tabs.find(({ tabId }) => tabId === deleteTabId);
  const deleteCount =
    tabToDelete?.rows.flatMap(({ columns }) =>
      columns.flatMap(({ elements }) => elements),
    ).length ?? 0;

  useEffect(() => {
    if (renameTab) {
      renameInput.current?.focus();
      renameInput.current?.select();
    } else if (focusActiveTab.current) {
      focusActiveTab.current = false;
      activeTabTrigger.current?.focus();
    }
  }, [renameTab, tab.tabId]);

  function selectTab(tabId: string) {
    setSelectedTab(tabId);
    onTabChange?.(tabId);
  }

  async function save(
    patches: readonly AppPatch[],
    afterSave?: (result: AppDocument) => void,
  ) {
    if (pendingRef.current || !onChangeLayout) return;
    const onFailure = patches.some(({ type }) => type === "tab-move")
      ? () =>
          toast.error(
            t("notebook.appBuilder.settings.reorderTabsFailed", {
              defaultValue: messages.settings.reorderTabsFailed,
            }),
          )
      : () => setError(true);
    try {
      setOptimistic(applyAppPatches(accepted, patches, cells));
      await commit(() => onChangeLayout(patches), afterSave, onFailure);
    } catch {
      onFailure();
    }
  }

  async function generate() {
    if (pendingRef.current || !onGenerate) return;
    try {
      await onGenerate(messages.generativePrompt);
    } catch (cause) {
      toast.error(
        cause instanceof Error && cause.message
          ? cause.message
          : messages.generateFailed,
      );
      return;
    }
    await save([{ type: "initialize" }]);
  }

  async function commit(
    write: () => Promise<AppDocument>,
    afterSave?: (result: AppDocument) => void,
    onFailure: () => void = () => setError(true),
  ) {
    pendingRef.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await write();
      afterSave?.(result);
    } catch {
      onFailure();
    } finally {
      pendingRef.current = false;
      setPending(false);
      setOptimistic(undefined);
    }
  }

  function placeInNotebookOrder(cellId: string, targetTabId: string): Place {
    const target = accepted.tabs.find(({ tabId }) => tabId === targetTabId);
    const cellIndex = cellById.get(cellId)?.index ?? -1;
    let afterRowId = null;
    for (const row of target?.rows ?? []) {
      if (
        row.columns.some((column) =>
          column.elements.some(
            (element) =>
              (cellById.get(element.cellId)?.index ?? -1) > cellIndex,
          ),
        )
      )
        break;
      afterRowId = row.rowId;
    }
    return {
      type: "place",
      tabId: targetTabId,
      elementId: crypto.randomUUID(),
      cellId,
      destination: newRow(afterRowId),
    };
  }

  function membership(cellId: string, targetTabId: string) {
    return membershipByTab.get(targetTabId)?.get(cellId);
  }

  function toggleCell(cellId: string, targetTabId: string) {
    const element = membership(cellId, targetTabId);
    void save([
      element
        ? { type: "remove", tabId: targetTabId, elementId: element.elementId }
        : placeInNotebookOrder(cellId, targetTabId),
    ]);
  }

  function outlineDropTarget(targetTabId: string) {
    function canDrop(event: DragEvent<HTMLElement>) {
      const cellId = outlineDragCell.current;
      if (!cellId || pendingRef.current || membership(cellId, targetTabId))
        return;
      event.preventDefault();
      return cellId;
    }

    return {
      onDragOver: canDrop,
      onDrop(event: DragEvent<HTMLElement>) {
        const cellId = canDrop(event);
        if (!cellId) return;
        outlineDragCell.current = undefined;
        void save([placeInNotebookOrder(cellId, targetTabId)]);
      },
    };
  }

  function addTab() {
    const newTabId = crypto.randomUUID();
    let index = accepted.tabs.length + 1;
    while (
      accepted.tabs.some((item) => item.name.toLowerCase() === `tab ${index}`)
    )
      index += 1;
    void save(
      [
        {
          type: "tab-add",
          tabId: newTabId,
          name: `Tab ${index}`,
        },
      ],
      () => {
        setRenameTab(newTabId);
      },
    );
  }

  function finishRename(restoreFocus: boolean) {
    focusActiveTab.current =
      restoreFocus && document.activeElement === renameInput.current;
    setRenameTab(undefined);
  }

  function saveTabName(
    item: AppDocument["tabs"][number],
    value: string,
    restoreFocus = false,
  ) {
    if (pendingRef.current || renameTab !== item.tabId) return;
    const name = value.trim();
    if (!name || name === item.name) {
      setNameTaken(false);
      finishRename(restoreFocus);
      return;
    }
    if (
      accepted.tabs.some(
        ({ tabId, name: other }) =>
          tabId !== item.tabId && other.toLowerCase() === name.toLowerCase(),
      )
    ) {
      if (restoreFocus) setNameTaken(true);
      else finishRename(false);
      return;
    }
    setNameTaken(false);
    void save([{ type: "tab-rename", tabId: item.tabId, name }], () =>
      finishRename(restoreFocus),
    );
  }

  function duplicateTab() {
    const newTabId = crypto.randomUUID();
    const copy = /^(.*) \(Copy(?: (\d{1,6}))?\)$/.exec(tab.name);
    const original = copy?.[1] ?? tab.name;
    let number = copy ? Number(copy[2] ?? 1) + 1 : 1;
    let name: string;
    do {
      const key = number === 1 ? "duplicateName" : "duplicateNumberedName";
      const options = { number, defaultValue: messages[key] };
      const suffix = t(`notebook.appBuilder.${key}`, { ...options, name: "" });
      name = t(`notebook.appBuilder.${key}`, {
        ...options,
        name: original.slice(0, 80 - suffix.length).trimEnd(),
      });
      number += 1;
    } while (
      accepted.tabs.some(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      )
    );
    void save(
      [
        {
          type: "tab-duplicate",
          sourceTabId: tab.tabId,
          tabId: newTabId,
          name,
        },
      ],
      () => {
        focusActiveTab.current = true;
        selectTab(newTabId);
      },
    );
  }

  function removeTab(tabId: string) {
    void save([{ type: "tab-remove", tabId }], (result) => {
      setDeleteTabId(undefined);
      if (tabId === tab.tabId) selectTab(projectAppLayout(result).tab.tabId);
    });
  }

  function requestDeleteTab(tabId: string) {
    if (membershipByTab.get(tabId)?.size) {
      setError(false);
      setDeleteTabId(tabId);
    } else {
      removeTab(tabId);
    }
  }

  function saveElement(patch: AppPatch, elementId: string) {
    void save([patch], (result) => {
      const committedRows = projectAppLayout(result, bookmark).rows;
      for (const [index, row] of committedRows.entries()) {
        const column = row.columns.find((candidate) =>
          candidate.elements.some((element) => element.elementId === elementId),
        );
        if (!column) continue;
        setAnnouncement(
          messages.position
            .replace("{{row}}", String(index + 1))
            .replace(
              "{{left}}",
              String(Math.floor(column.left / APP_LAYOUT_SNAP) + 1),
            )
            .replace(
              "{{right}}",
              String(Math.ceil(column.right / APP_LAYOUT_SNAP)),
            ),
        );
        break;
      }
    });
  }

  function moveElement(
    elementId: string,
    destination: Place["destination"],
  ): AppPatch {
    return {
      type: "move",
      elementId,
      fromTabId: tab.tabId,
      toTabId: tab.tabId,
      destination,
    };
  }

  function dragPatch(
    event: PointerEvent<HTMLButtonElement>,
    gesture: Drag,
  ): AppPatch | null {
    const rowNodes = [
      ...(canvas.current?.querySelectorAll<HTMLElement>("[data-app-row]") ??
        []),
    ];
    const source = rowNodes.find(
      (node) => node.dataset.appRow === gesture.rowId,
    );
    if (!source) return null;
    if (gesture.kind === "width") {
      const { column, element } = gesture;
      const width = source.getBoundingClientRect().width;
      if (width <= 0) return null;
      const right = snapAppPosition(
        column.right +
          ((event.clientX - gesture.startX) / width) * APP_LAYOUT_SPAN,
      );
      return right === column.right
        ? null
        : {
            type: "resize",
            tabId: tab.tabId,
            elementId: element.elementId,
            right,
          };
    }
    if (gesture.kind === "height") {
      const { element } = gesture;
      const steps = Math.round(
        (event.clientY - gesture.startY) / APP_LAYOUT_HEIGHT_STEP,
      );
      return steps === 0
        ? null
        : {
            type: "resize",
            tabId: tab.tabId,
            elementId: element.elementId,
            heightPx: Math.max(
              APP_LAYOUT_MIN_HEIGHT,
              Math.min(
                APP_LAYOUT_MAX_HEIGHT,
                element.heightPx + steps * APP_LAYOUT_HEIGHT_STEP,
              ),
            ),
          };
    }
    const target = rowNodes.find((node) => {
      const bounds = node.getBoundingClientRect();
      return event.clientY >= bounds.top && event.clientY < bounds.bottom;
    });
    const targetId = target?.dataset.appRow;
    if (!targetId || targetId === gesture.rowId) return null;
    if (gesture.kind === "element") {
      return moveElement(
        gesture.element.elementId,
        joinedRow(targetId, gesture.column),
      );
    }
    const rowIds = acceptedRows.map(({ rowId }) => rowId);
    const sourceIndex = rowIds.indexOf(gesture.rowId);
    const targetIndex = rowIds.indexOf(targetId);
    return {
      type: "row-move",
      tabId: tab.tabId,
      rowId: gesture.rowId,
      afterRowId:
        targetIndex > sourceIndex
          ? targetId
          : (rowIds[targetIndex - 1] ?? null),
    };
  }

  function dragHandle(gesture: DragHandle) {
    return {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0 || pendingRef.current) return;
        drag.current = {
          ...gesture,
          startX: event.clientX,
          startY: event.clientY,
        };
        setDragKind(gesture.kind);
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        if (!drag.current) return;
        const patch = dragPatch(event, drag.current);
        setDragTarget(
          patch?.type === "move" ? patch.destination.rowId : undefined,
        );
        try {
          setDragPreview(
            patch?.type === "resize"
              ? applyAppPatches(accepted, [patch], cells)
              : undefined,
          );
        } catch {
          setDragPreview(undefined);
        }
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        if (!drag.current) return;
        const patch = dragPatch(event, drag.current);
        cancelDrag();
        if (!patch) return;
        if ("elementId" in patch) saveElement(patch, patch.elementId);
        else void save([patch]);
      },
      onPointerCancel: cancelDrag,
      onLostPointerCapture: cancelDrag,
    };
  }

  function cancelDrag() {
    drag.current = undefined;
    setDragPreview(undefined);
    setDragTarget(undefined);
    setDragKind(undefined);
  }

  function revealOutline() {
    setOutlineOpen(true);
    requestAnimationFrame(() => outline.current?.focus());
  }

  function insert(kind: CellKind, inputType?: CellMenuEntry["inputType"]) {
    if (!onInsertCell || pendingRef.current || kind === "collapsible") return;
    void commit(() =>
      onInsertCell(
        kind,
        {
          tabId: tab.tabId,
          elementId: crypto.randomUUID(),
          destination: newRow(acceptedRows.at(-1)?.rowId ?? null),
        },
        inputType,
      ),
    );
  }

  function renderRow(row: AppRow, index: number) {
    const equallyDistributed = isAppRowDistributed(row);
    return (
      <div
        className="nb-app-builder-row"
        key={row.rowId}
        data-app-row={row.rowId}
      >
        {canEdit && (
          <div className="nb-app-builder-row-controls">
            <LayoutIcon
              label={messages.dragRow}
              disabled={pending}
              className="nb-app-builder-drag"
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowUp"
                    ? -1
                    : event.key === "ArrowDown"
                      ? 1
                      : 0;
                if (!offset || !acceptedRows[index + offset]) return;
                event.preventDefault();
                const afterRowId =
                  acceptedRows[index + (offset > 0 ? 1 : -2)]?.rowId ?? null;
                void save([
                  {
                    type: "row-move",
                    tabId: tab.tabId,
                    rowId: row.rowId,
                    afterRowId,
                  },
                ]);
              }}
              {...dragHandle({ kind: "row", rowId: row.rowId })}
            >
              <IconGripVertical size={14} />
            </LayoutIcon>
            <LayoutIcon
              label={
                equallyDistributed
                  ? messages.rowDistributed
                  : messages.distributeRow
              }
              disabled={pending || equallyDistributed}
              onClick={() =>
                void save([
                  {
                    type: "row-distribute",
                    tabId: tab.tabId,
                    rowId: row.rowId,
                  },
                ])
              }
            >
              <IconArrowsHorizontal size={14} />
            </LayoutIcon>
          </div>
        )}
        <div
          className="nb-app-builder-row-grid"
          data-resizing={dragKind === "width" || undefined}
          data-drop-target={dragTarget === row.rowId || undefined}
          style={{ minBlockSize: row.heightPx }}
        >
          {row.columns.map((column) => (
            <div
              key={column.columnId}
              className="nb-app-builder-column"
              style={
                {
                  "--app-placement": `${column.left + 1} / span ${column.right - column.left}`,
                } as CSSProperties
              }
            >
              {column.elements.map((element) =>
                renderElement(row, column, element, index),
              )}
            </div>
          ))}
        </div>
        {dragKind === "element" && drag.current?.rowId !== row.rowId && (
          <div className="nb-app-builder-drop">{messages.addToRow}</div>
        )}
      </div>
    );
  }

  function renderElement(
    row: AppRow,
    column: AppColumn,
    element: AppElement,
    rowIndex: number,
  ) {
    const item = cellById.get(element.cellId);
    if (!item) return null;
    const { cell, title, index } = item;
    const source = editableCellText(cell.contents);
    const pythonOutputs =
      cell.contents.kind === "code"
        ? outputs[cell.id]?.pythonOutputs
        : undefined;
    const hasCode =
      cell.contents.kind === "code" || cell.contents.kind === "sql";
    const layoutLabel = messages.layoutFor.replace("{{title}}", title);
    const resize = (
      value: Pick<
        Extract<AppPatch, { type: "resize" }>,
        "left" | "right" | "heightPx"
      >,
    ) =>
      saveElement(
        {
          type: "resize",
          tabId: tab.tabId,
          elementId: element.elementId,
          ...value,
        },
        element.elementId,
      );
    function moveVertical(offset: number) {
      const target = acceptedRows[rowIndex + offset];
      if (!target) return;
      const afterRowId =
        offset > 0 ? target.rowId : (acceptedRows[rowIndex - 2]?.rowId ?? null);
      if (row.columns.length === 1 && column.elements.length === 1) {
        saveElement(
          { type: "row-move", tabId: tab.tabId, rowId: row.rowId, afterRowId },
          element.elementId,
        );
      } else {
        saveElement(
          moveElement(element.elementId, newRow(afterRowId)),
          element.elementId,
        );
      }
    }

    const shift = (offset: number) =>
      resize({
        left: snapAppPosition(column.left + offset),
        right: snapAppPosition(column.right + offset),
      });
    const changeWidth = (offset: number) =>
      resize({ right: snapAppPosition(column.right + offset) });
    const changeHeight = (offset: number) =>
      resize({
        heightPx: Math.max(
          APP_LAYOUT_MIN_HEIGHT,
          Math.min(APP_LAYOUT_MAX_HEIGHT, element.heightPx + offset),
        ),
      });
    const controls = [
      {
        label: messages.moveUp,
        disabled: rowIndex === 0,
        run: () => moveVertical(-1),
      },
      {
        label: messages.moveDown,
        disabled: rowIndex === rows.length - 1,
        run: () => moveVertical(1),
      },
      {
        label: messages.moveLeft,
        disabled: column.left === 0,
        run: () => shift(-APP_LAYOUT_SNAP),
      },
      {
        label: messages.moveRight,
        disabled: column.right === APP_LAYOUT_SPAN,
        run: () => shift(APP_LAYOUT_SNAP),
      },
      {
        label: messages.narrow,
        disabled: column.right - column.left <= APP_LAYOUT_SNAP,
        run: () => changeWidth(-APP_LAYOUT_SNAP),
      },
      {
        label: messages.widen,
        disabled: column.right === APP_LAYOUT_SPAN,
        run: () => changeWidth(APP_LAYOUT_SNAP),
      },
      {
        label: messages.shorter,
        disabled: element.heightPx <= APP_LAYOUT_MIN_HEIGHT,
        run: () => changeHeight(-APP_LAYOUT_HEIGHT_STEP),
      },
      {
        label: messages.taller,
        disabled: element.heightPx >= APP_LAYOUT_MAX_HEIGHT,
        run: () => changeHeight(APP_LAYOUT_HEIGHT_STEP),
      },
    ];
    const setDisplay = (
      display: AppElement["display"],
      showLabel = element.showLabel,
    ) =>
      void save([
        {
          type: "display",
          tabId: tab.tabId,
          elementId: element.elementId,
          display,
          showLabel,
        },
      ]);
    return (
      <section
        key={element.elementId}
        className={
          cell.contents.kind === "metric" && cell.contents.metricConfig
            ? "nb-app-grid-card flex flex-col"
            : "nb-app-grid-card"
        }
        aria-label={title}
        style={{ minBlockSize: element.heightPx }}
        data-display={element.display}
      >
        {(element.showLabel || canEdit) && (
          <header className="nb-app-grid-card-header">
            {element.showLabel && <h2 title={title}>{title}</h2>}
            {canEdit && (
              <div
                className="nb-app-grid-controls"
                role="group"
                aria-label={layoutLabel}
              >
                <LayoutIcon
                  label={messages.dragElement}
                  tooltip
                  disabled={pending}
                  className="nb-app-builder-drag"
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                      return;
                    event.preventDefault();
                    moveVertical(event.key === "ArrowUp" ? -1 : 1);
                  }}
                  {...dragHandle({
                    kind: "element",
                    rowId: row.rowId,
                    column,
                    element,
                  })}
                >
                  <IconGripVertical size={14} />
                </LayoutIcon>
                <LayoutIcon
                  label={messages.widen}
                  tooltip
                  disabled={pending}
                  className="nb-app-builder-resize-x"
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  onClick={(event) => {
                    if (event.detail === 0) changeWidth(APP_LAYOUT_SNAP);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                      return;
                    event.preventDefault();
                    changeWidth(
                      event.key === "ArrowLeft"
                        ? -APP_LAYOUT_SNAP
                        : APP_LAYOUT_SNAP,
                    );
                  }}
                  {...dragHandle({
                    kind: "width",
                    rowId: row.rowId,
                    column,
                    element,
                  })}
                >
                  <IconArrowsHorizontal size={14} />
                </LayoutIcon>
                <LayoutIcon
                  label={messages.taller}
                  tooltip
                  disabled={pending}
                  className="nb-app-builder-resize-y"
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  onClick={(event) => {
                    if (event.detail === 0)
                      changeHeight(APP_LAYOUT_HEIGHT_STEP);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                      return;
                    event.preventDefault();
                    changeHeight(
                      event.key === "ArrowUp"
                        ? -APP_LAYOUT_HEIGHT_STEP
                        : APP_LAYOUT_HEIGHT_STEP,
                    );
                  }}
                  {...dragHandle({
                    kind: "height",
                    rowId: row.rowId,
                    column,
                    element,
                  })}
                >
                  <IconArrowsHorizontal size={14} />
                </LayoutIcon>
                <LayoutMenu label={layoutLabel} tooltip disabled={pending}>
                  {onViewCell && (
                    <DropdownMenuItem onSelect={() => onViewCell(cell.id)}>
                      {messages.viewInNotebook}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => toggleCell(cell.id, tab.tabId)}
                  >
                    {messages.removeFromApp}
                  </DropdownMenuItem>
                  {controls.map(({ label, disabled, run }) => (
                    <DropdownMenuItem
                      key={label}
                      disabled={disabled}
                      onSelect={run}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                  {rows.map(
                    (target, targetIndex) =>
                      target.rowId !== row.rowId && (
                        <DropdownMenuItem
                          key={target.rowId}
                          onSelect={() =>
                            saveElement(
                              moveElement(
                                element.elementId,
                                joinedRow(target.rowId, column),
                              ),
                              element.elementId,
                            )
                          }
                        >
                          {messages.addToRowNumber.replace(
                            "{{row}}",
                            String(targetIndex + 1),
                          )}
                        </DropdownMenuItem>
                      ),
                  )}
                  {hasCode && (
                    <>
                      <DropdownMenuLabel>
                        {messages.displaySettings}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={element.display}>
                        {(
                          [
                            ["source", messages.sourceOnly],
                            ["output", messages.outputOnly],
                            ["both", messages.sourceAndOutput],
                          ] as const
                        ).map(([value, label]) => (
                          <DropdownMenuRadioItem
                            key={value}
                            value={value}
                            onSelect={() => setDisplay(value)}
                          >
                            {label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </>
                  )}
                  <DropdownMenuCheckboxItem
                    checked={element.showLabel}
                    onCheckedChange={(showLabel) =>
                      setDisplay(element.display, showLabel)
                    }
                  >
                    {messages.showLabel}
                  </DropdownMenuCheckboxItem>
                </LayoutMenu>
              </div>
            )}
          </header>
        )}
        {hasCode && element.display !== "output" && source !== null && (
          <pre className="nb-app-grid-content">{source}</pre>
        )}
        {element.display !== "source" &&
          (pythonOutputs?.length ? (
            <PythonCellOutput
              projectId={cell.projectId}
              cellId={cell.id}
              outputs={pythonOutputs}
              onLoadPage={onLoadPythonPage}
              canRepair={false}
            />
          ) : cell.contents.kind === "metric" && cell.contents.metricConfig ? (
            <>
              <CompleteMetricView
                context={{
                  projectId: cell.projectId,
                  cellId: cell.id,
                  versionId: cell.versionId,
                }}
                config={cell.contents.metricConfig}
                sourceResultId={getVisualizationSourceResultId?.(cell) ?? null}
                namedValues={namedValues}
              />
              {canEdit && onViewCell && !cell.contents.metricConfig.source && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => onViewCell(cell.id)}
                >
                  {t("notebook.appBuilder.viewInNotebook")}
                </Button>
              )}
            </>
          ) : (
            <AppCellContent
              cell={cell}
              output={outputs[cell.id]?.output ?? null}
              dataframes={dataframes}
              visualizationSourceResultId={
                getVisualizationSourceResultId?.(cell) ?? null
              }
              chartEmptyState={renderChartEmptyState(cell, index)}
            />
          ))}
      </section>
    );
  }

  function renderChartEmptyState(cell: Cell, index: number) {
    const { contents } = cell;
    if (!canEdit || contents.kind !== "chart") return undefined;
    const sourceId = contents.chartSpec.sourceCellId;
    const matches = cells.slice(0, index).filter((source) => {
      const candidate = source.contents;
      if (candidate.kind !== "sql" && candidate.kind !== "code") return false;
      return sourceId == null
        ? contents.dataframe != null &&
            candidate.resultVariable?.trim() === contents.dataframe
        : source.id === sourceId;
    });
    const source = matches.length === 1 ? matches[0] : undefined;
    const run = source && getSourceRun?.(source);
    const title = source && cellById.get(source.id)?.title;
    if (!run && !onViewCell) return undefined;
    return (
      <div className="nb-app-builder-chart-empty">
        {run?.error ? (
          <p className="nb-app-grid-error" role="alert">
            {run.error}
          </p>
        ) : (
          <p className="nb-app-grid-empty-output">{messages.noResult}</p>
        )}
        {run ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={
              run.running
                ? t("notebook.running")
                : title
                  ? t("notebook.runNamedCell", { title })
                  : undefined
            }
            disabled={run.disabled}
            onClick={run.start}
          >
            <IconPlayerPlay size={14} aria-hidden="true" />
            {run.running ? t("notebook.running") : t("notebook.runCell")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onViewCell?.(source?.id ?? cell.id)}
          >
            {messages.viewInNotebook}
          </Button>
        )}
      </div>
    );
  }

  if (!displayed.initialized) {
    return (
      <div className="nb-app-builder" aria-label={messages.appLayout}>
        {canEdit ? (
          <div
            className="nb-app-builder-chooser"
            role="group"
            aria-label={messages.appType}
          >
            <p className="nb-app-builder-chooser-label">{messages.appType}</p>
            <div className="nb-app-builder-chooser-cards">
              <section className="nb-app-builder-type-card">
                <h2>{messages.classicApp}</h2>
                <p>{messages.classicDescription}</p>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => void save([{ type: "initialize" }])}
                >
                  {messages.editManually}
                </Button>
              </section>
              <section
                className="nb-app-builder-type-card"
                {...(onGenerate
                  ? {}
                  : { "aria-disabled": "true", "data-unavailable": "true" })}
              >
                <h2>
                  {messages.generativeApp}
                  <span className="nb-app-builder-beta">{messages.beta}</span>
                </h2>
                <p>{messages.generativeDescription}</p>
                {onGenerate ? (
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() => void generate()}
                  >
                    {messages.generateWithAgent}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled>
                    {messages.generativeUnavailable}
                  </Button>
                )}
              </section>
            </div>
          </div>
        ) : (
          <p className="nb-app-builder-empty">{messages.empty}</p>
        )}
        {error && (
          <p className="nb-app-grid-error" role="alert">
            {messages.saveFailed}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="nb-app-builder"
      aria-label={messages.appLayout}
      aria-busy={pending}
    >
      <Tabs value={tab.tabId} onValueChange={selectTab}>
        <div className="nb-app-builder-toolbar">
          {membershipDocument.tabs.length > 1 && (
            <TabsList
              className="nb-app-builder-tab-list"
              aria-label={messages.tabs}
            >
              {membershipDocument.tabs.map((item) => {
                if (renameTab === item.tabId) {
                  return (
                    <Input
                      key={item.tabId}
                      className="nb-app-builder-rename"
                      ref={renameInput}
                      aria-label={messages.tabName}
                      maxLength={80}
                      defaultValue={item.name}
                      onBlur={(event) =>
                        saveTabName(item, event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setNameTaken(false);
                          finishRename(true);
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveTabName(item, event.currentTarget.value, true);
                        }
                      }}
                    />
                  );
                }

                const selected = item.tabId === tab.tabId;
                const hasMenu = selected && canEdit && accepted.tabs.length > 1;
                const menuEnabled = hasMenu && !pending;
                return (
                  <DropdownMenu key={item.tabId}>
                    <TabsTrigger
                      asChild
                      ref={selected ? activeTabTrigger : undefined}
                      value={item.tabId}
                      title={item.name}
                      {...(canEdit ? outlineDropTarget(item.tabId) : {})}
                    >
                      <DropdownMenuTrigger asChild disabled={!menuEnabled}>
                        <button
                          disabled={false}
                          {...(!menuEnabled && {
                            "aria-haspopup": undefined,
                            "aria-expanded": undefined,
                          })}
                        >
                          <span>{item.name}</span>
                        </button>
                      </DropdownMenuTrigger>
                    </TabsTrigger>
                    {hasMenu && (
                      <DropdownMenuContent
                        align="start"
                        aria-labelledby={undefined}
                        aria-label={messages.tabActions}
                        onCloseAutoFocus={(event) => {
                          const afterClose = afterTabMenuClose.current;
                          afterTabMenuClose.current = undefined;
                          if (afterClose || deleteTabId) event.preventDefault();
                          afterClose?.();
                        }}
                      >
                        <DropdownMenuItem
                          onSelect={() => {
                            afterTabMenuClose.current = () =>
                              setRenameTab(item.tabId);
                          }}
                        >
                          {messages.renameTab}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            afterTabMenuClose.current = () => {
                              activeTabTrigger.current?.focus();
                              duplicateTab();
                            };
                          }}
                        >
                          {t("notebook.appBuilder.duplicateTab", {
                            defaultValue: messages.duplicateTab,
                          })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => requestDeleteTab(item.tabId)}
                        >
                          {t("notebook.appBuilder.deleteTab", {
                            defaultValue: messages.deleteTab,
                          })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    )}
                  </DropdownMenu>
                );
              })}
            </TabsList>
          )}
          {canEdit && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={addTab}
              >
                <IconPlus size={14} aria-hidden="true" />
                {t("notebook.appBuilder.addTab", {
                  defaultValue: messages.addTab,
                })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={outlineOpen}
                onClick={() => setOutlineOpen((open) => !open)}
              >
                <IconLayoutSidebar size={15} />
                {messages.outline}
              </Button>
              <AppBuilderSettings
                settings={displayed.settings}
                tabs={membershipDocument.tabs}
                pending={pending}
                onChange={(patch) => void save([patch])}
                onAddTab={addTab}
                onRemoveTab={requestDeleteTab}
              />
            </>
          )}
        </div>
        <div className="nb-app-builder-workspace">
          {outlineOpen && canEdit && (
            <aside
              className="nb-app-builder-outline"
              tabIndex={-1}
              ref={outline}
              aria-label={messages.outline}
            >
              <div className="nb-app-builder-toolbar">
                <LayoutMenu
                  label={messages.resetLayout}
                  disabled={pending}
                  trigger={messages.resetLayout}
                >
                  {(
                    [
                      ["empty", messages.removeAll],
                      ["default", messages.defaultLayout],
                    ] as const
                  ).map(([preset, label]) => (
                    <DropdownMenuItem
                      key={preset}
                      onSelect={() =>
                        void save([{ type: "reset", tabId: tab.tabId, preset }])
                      }
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </LayoutMenu>
                <LayoutIcon
                  label={messages.closeOutline}
                  onClick={() => setOutlineOpen(false)}
                >
                  <IconX size={14} />
                </LayoutIcon>
              </div>
              <ul>
                {Array.from(cellById, ([cellId, { title }]) => {
                  const placed = membership(cellId, tab.tabId) !== undefined;
                  const label = placed
                    ? messages.removeFromApp
                    : messages.addToApp;
                  const tabCount = accepted.tabs.filter(({ tabId }) =>
                    membership(cellId, tabId),
                  ).length;
                  return (
                    <li key={cellId}>
                      <span
                        title={title}
                        draggable={!pending}
                        onDragStart={(event) => {
                          outlineDragCell.current = cellId;
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData("text/plain", title);
                        }}
                        onDragEnd={() => {
                          outlineDragCell.current = undefined;
                        }}
                      >
                        {title}
                      </span>
                      <LayoutIcon
                        label={label}
                        disabled={pending}
                        variant={placed ? "secondary" : "ghost"}
                        onClick={() => toggleCell(cellId, tab.tabId)}
                      >
                        {placed ? <IconX size={14} /> : <IconPlus size={14} />}
                      </LayoutIcon>
                      {accepted.tabs.length > 1 && (
                        <LayoutMenu
                          label={messages.addToTabs}
                          disabled={pending}
                          trigger={tabCount}
                        >
                          <DropdownMenuLabel>
                            {messages.addToTabs}
                          </DropdownMenuLabel>
                          {accepted.tabs.map((target) => (
                            <DropdownMenuCheckboxItem
                              key={target.tabId}
                              checked={Boolean(
                                membership(cellId, target.tabId),
                              )}
                              onCheckedChange={() =>
                                toggleCell(cellId, target.tabId)
                              }
                            >
                              {target.name}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </LayoutMenu>
                      )}
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}
          <TabsContent value={tab.tabId} className="nb-app-builder-panel">
            <div
              ref={canvas}
              className="nb-app-builder-canvas"
              data-full-width={displayed.settings.fullWidth}
              {...(canEdit ? outlineDropTarget(tab.tabId) : {})}
            >
              {rows.length === 0 ? (
                canEdit && membershipDocument.tabs.length > 1 ? (
                  <div className="nb-app-builder-empty-tab">
                    <h2>
                      {t("notebook.appBuilder.emptyTabTitle", {
                        defaultValue: messages.emptyTabTitle,
                      })}
                    </h2>
                    <p>
                      {t("notebook.appBuilder.emptyTabDescription", {
                        defaultValue: messages.emptyTabDescription,
                      })}
                    </p>
                    <ul>
                      <li>
                        {t("notebook.appBuilder.emptyTabOutline", {
                          defaultValue: messages.emptyTabOutline,
                        })}
                      </li>
                      <li>
                        {t("notebook.appBuilder.emptyTabDrag", {
                          defaultValue: messages.emptyTabDrag,
                        })}
                      </li>
                    </ul>
                  </div>
                ) : (
                  <div>
                    <p className="nb-app-builder-empty">{messages.empty}</p>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={revealOutline}
                      >
                        {messages.addFromOutline}
                      </Button>
                    )}
                  </div>
                )
              ) : (
                rows.map(renderRow)
              )}
              {canEdit && onInsertCell && (
                <AddCellBar
                  disabled={pending}
                  entries={addEntries.filter(
                    ({ kind }) =>
                      kind !== "component-import" && kind !== "collapsible",
                  )}
                  supportedKinds={supportedAddKinds?.filter(
                    (kind) => kind !== "collapsible",
                  )}
                  onAdd={insert}
                  onPick={(entry) => insert(entry.kind, entry.inputType)}
                />
              )}
            </div>
          </TabsContent>
        </div>
      </Tabs>
      {nameTaken && (
        <p className="nb-app-grid-error" role="alert">
          {messages.tabNameTaken}
        </p>
      )}
      {error && !tabToDelete && (
        <p className="nb-app-grid-error" role="alert">
          {messages.saveFailed}
        </p>
      )}
      <AlertDialog
        open={tabToDelete !== undefined}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleteTabId(undefined);
        }}
      >
        {tabToDelete && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("notebook.appBuilder.confirmDeleteTab", {
                  defaultValue: messages.confirmDeleteTab,
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("notebook.appBuilder.deleteTabDescription", {
                  name: tabToDelete.name,
                  count: deleteCount,
                  defaultValue:
                    deleteCount === 1
                      ? messages.deleteTabDescription_one
                      : messages.deleteTabDescription_other,
                })}
                <br />
                {t("notebook.appBuilder.deleteTabKeepsCells", {
                  defaultValue: messages.deleteTabKeepsCells,
                })}
              </AlertDialogDescription>
              {error && (
                <p className="nb-app-grid-error" role="alert">
                  {messages.saveFailed}
                </p>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                {t("notebook.appBuilder.cancel", {
                  defaultValue: messages.cancel,
                })}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  removeTab(tabToDelete.tabId);
                }}
              >
                {t("notebook.appBuilder.deleteTab", {
                  defaultValue: messages.deleteTab,
                })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

function LayoutIcon({
  label,
  tooltip = false,
  ...props
}: ComponentProps<typeof Button> & { label: string; tooltip?: boolean }) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={tooltip ? undefined : label}
      {...props}
    />
  );
  return tooltip ? (
    <LayoutTooltip label={label}>{button}</LayoutTooltip>
  ) : (
    button
  );
}

function LayoutTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LayoutMenu({
  label,
  tooltip = false,
  disabled,
  trigger,
  children,
}: {
  label: string;
  tooltip?: boolean;
  disabled: boolean;
  trigger?: ReactNode;
  children: ReactNode;
}) {
  const menuTrigger = (
    <DropdownMenuTrigger asChild disabled={disabled}>
      <Button
        type="button"
        variant="ghost"
        size={trigger === undefined ? "icon-xs" : "sm"}
        aria-label={label}
        title={tooltip ? undefined : label}
      >
        {trigger ?? <IconDots size={14} />}
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {tooltip ? (
        <LayoutTooltip label={label}>{menuTrigger}</LayoutTooltip>
      ) : (
        menuTrigger
      )}
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function newRow(afterRowId: string | null): Place["destination"] {
  return {
    rowId: crypto.randomUUID(),
    columnId: crypto.randomUUID(),
    left: 0,
    right: APP_LAYOUT_SPAN,
    afterRowId,
  };
}

function joinedRow(rowId: string, column: AppColumn): Place["destination"] {
  return {
    rowId,
    left: 0,
    right: APP_LAYOUT_SPAN,
    columnId:
      column.elements.length === 1 ? column.columnId : crypto.randomUUID(),
  };
}

function AppCellContent({
  cell,
  output,
  dataframes,
  visualizationSourceResultId,
  chartEmptyState,
}: {
  cell: Cell;
  output?: CellOutput | null;
  dataframes: readonly ChartDataframe[];
  visualizationSourceResultId: string | null;
  chartEmptyState?: ReactNode;
}) {
  const contents = cell.contents;
  if (contents.kind === "collapsible") return null;
  if (contents.kind === "component-import") {
    return (
      <ComponentImportBody
        componentId={contents.componentVersionId}
        title={contents.title}
      />
    );
  }
  if (contents.kind === "markdown" || contents.kind === "text") {
    return (
      <MarkdownCellView
        markdown={
          contents.kind === "markdown" ? contents.markdown : contents.text
        }
      />
    );
  }
  if (isRenderableInput(contents)) {
    return (
      <AppInputPreview
        key={contents.defaultValueString}
        contents={contents}
        projectId={cell.projectId}
      />
    );
  }
  if (contents.kind === "pivot") {
    return (
      <PivotCell
        cell={cell}
        contents={contents}
        canEdit={false}
        sourceResultId={visualizationSourceResultId}
      />
    );
  }
  if (contents.kind === "display-table" && contents.tableConfig) {
    return (
      <TableCell
        cell={cell}
        config={contents.tableConfig}
        canEdit={false}
        sourceResultId={visualizationSourceResultId}
      />
    );
  }
  const fallback = output ? (
    <CellOutputView output={output} initialPageSize={25} />
  ) : (
    (chartEmptyState ?? (
      <p className="nb-app-grid-empty-output">{messages.noResult}</p>
    ))
  );
  if (contents.kind === "vega-chart" && contents.spec)
    return <VegaSpecChart spec={contents.spec} />;
  return contents.kind === "chart" ? (
    <ReadOnlyChart
      context={{
        projectId: cell.projectId,
        cellId: cell.id,
        versionId: cell.versionId,
      }}
      dataframe={contents.dataframe}
      spec={contents.chartSpec}
      dataframes={dataframes}
      output={output?.type === "chart" ? output : null}
      fallback={fallback}
      missingSourceFallback={chartEmptyState}
    />
  ) : (
    fallback
  );
}

function AppInputPreview({
  contents,
  projectId,
}: {
  contents: InputCellContents;
  projectId: string;
}) {
  const [value, setValue] = useState(contents.defaultValueString);
  return (
    <InputCellControl
      contents={contents}
      projectId={projectId}
      value={value}
      disabled={false}
      onChange={setValue}
      onCommit={() => {}}
    />
  );
}
