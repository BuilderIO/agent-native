import type { Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../utils.js";

/**
 * Right-click menu for a table cell: insert rows/columns around the resolved cell, then a
 * divider, then row/column deletion and a danger-styled table deletion.
 */

type TableChain = ReturnType<Editor["chain"]>;

interface TableMenuItem {
  label?: string;
  divider?: boolean;
  danger?: boolean;
  run?: (chain: TableChain) => TableChain;
}

export const TABLE_CONTEXT_MENU_ITEMS: TableMenuItem[] = [
  { label: "Insert row above", run: (chain) => chain.addRowBefore() },
  { label: "Insert row below", run: (chain) => chain.addRowAfter() },
  { label: "Insert column left", run: (chain) => chain.addColumnBefore() },
  { label: "Insert column right", run: (chain) => chain.addColumnAfter() },
  { divider: true },
  { label: "Delete row", run: (chain) => chain.deleteRow() },
  { label: "Delete column", run: (chain) => chain.deleteColumn() },
  { label: "Delete table", danger: true, run: (chain) => chain.deleteTable() },
];

export interface TableContextMenuProps {
  editor: Editor;
  enabled?: boolean;
}

export function TableContextMenu({
  editor,
  enabled = true,
}: TableContextMenuProps) {
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const cellRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setPosition(null);
    cellRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || editor.isDestroyed) return;
    const root = editor.view.dom as HTMLElement;

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      const cell =
        target instanceof Element
          ? (target.closest("td, th") as HTMLElement | null)
          : null;
      if (!cell || !root.contains(cell)) return;
      event.preventDefault();
      cellRef.current = cell;
      setPosition({ top: event.clientY, left: event.clientX });
    };

    root.addEventListener("contextmenu", handleContextMenu);
    return () => root.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, enabled]);

  useEffect(() => {
    if (!position) return;
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", handlePointer, true);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handlePointer, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [close, position]);

  const runItem = useCallback(
    (item: TableMenuItem) => {
      const cell = cellRef.current;
      // The table can be replaced while the menu is open; a cell that left
      // the editor DOM has no document position, so the item is a no-op.
      if (
        cell &&
        !editor.isDestroyed &&
        item.run &&
        editor.view.dom.contains(cell)
      ) {
        const pos = editor.view.posAtDOM(cell, 0);
        editor.chain().focus().setTextSelection(pos).run();
        item.run(editor.chain().focus()).run();
      }
      close();
    },
    [close, editor],
  );

  if (!position) return null;

  const menuWidth = 200;
  const menuHeight = 300;
  const left = Math.min(position.left, window.innerWidth - menuWidth - 12);
  const top =
    position.top + menuHeight > window.innerHeight
      ? Math.max(12, position.top - menuHeight)
      : position.top;

  return createPortal(
    <div
      ref={menuRef}
      className="an-rich-md-table-menu"
      style={{ position: "fixed", top, left } as CSSProperties}
      role="menu"
      data-plan-interactive
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {TABLE_CONTEXT_MENU_ITEMS.map((item, index) =>
        item.divider ? (
          <div
            key={`divider-${index}`}
            className="an-rich-md-table-menu-divider"
            role="separator"
          />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cn(
              "an-rich-md-table-menu-item",
              item.danger && "an-rich-md-table-menu-item--danger",
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runItem(item)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
