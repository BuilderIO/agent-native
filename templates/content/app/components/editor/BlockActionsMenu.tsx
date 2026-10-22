import { useT } from "@agent-native/core/client/i18n";
import type { DragHandleMenuRequest } from "@agent-native/toolkit/editor";
import {
  IconArrowAutofitWidth,
  IconCopy,
  IconPlus,
  IconTableColumn,
  IconTableRow,
  IconTrash,
} from "@tabler/icons-react";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { instantCloseMenuClass, menuIconClass } from "./menu-classes";
import { MenuSwitchItem } from "./MenuSwitchItem";
import {
  getTableHeaders,
  setTableFitWidth,
  setTableHeaders,
  type TableAt,
} from "./table-commands";

interface BlockMenuHost {
  editor: Editor;
  open: (request: DragHandleMenuRequest) => () => void;
}

const hosts = new Set<BlockMenuHost>();

/**
 * The drag handle's `openMenu`: the editor's mounted BlockActionsMenu opens
 * in place of the handle's built-in menu.
 */
export function openBlockActionsMenu(request: DragHandleMenuRequest) {
  // Compared when the grip asks: until the editor mounts, `editor.view` is a
  // stand-in, not the view the grip will report.
  for (const host of hosts) {
    if (host.editor.view === request.view) {
      // The menu takes focus only after it renders, and losing focus
      // re-renders everything that watches the editor. Blurring now folds
      // that into the render that opens the menu.
      request.view.dom.blur();
      return host.open(request);
    }
  }
  return null;
}

export function BlockActionsMenu({
  editor,
  tableOptions,
}: {
  editor: Editor;
  /** Whether a table's block menu offers its header and width settings. */
  tableOptions: boolean;
}) {
  const t = useT();
  const [request, setRequest] = useState<DragHandleMenuRequest | null>(null);
  const [, setRevision] = useState(0);
  const escapedRef = useRef(false);

  useEffect(() => {
    const host: BlockMenuHost = {
      editor,
      open: (next) => {
        setRequest(next);
        return () =>
          setRequest((current) => (current === next ? null : current));
      },
    };
    hosts.add(host);
    return () => {
      hosts.delete(host);
    };
  }, [editor]);

  // The switches show the table as it is, including a collaborator's change,
  // and the menu goes when its block does.
  useEffect(() => {
    if (!request) return;
    const redraw = () => {
      if (request.getBlock()) {
        setRevision((revision) => revision + 1);
      } else {
        setRequest(null);
        request.onClose();
      }
    };
    editor.on("transaction", redraw);
    return () => {
      editor.off("transaction", redraw);
    };
  }, [editor, request]);

  if (!request) return null;

  const block = request.getBlock();
  const table: TableAt | null =
    tableOptions && block?.node.type.name === "table" ? block : null;
  const headers = table ? getTableHeaders(table.node) : null;

  // The menu holds focus, and Content saves an unfocused change only when it
  // is marked as the user's.
  const editTable = (edit: (tr: Transaction, table: TableAt) => void) => {
    const latest = request.getBlock();
    if (latest?.node.type.name !== "table") return;
    const tr = request.view.state.tr;
    edit(tr, latest);
    request.view.dispatch(tr.setMeta(LOCAL_FILE_USER_EDIT_META, true));
  };

  // The grip selected the whole block, which typing would replace, so Escape
  // puts the caret at the block's start instead.
  const returnToBlock = () => {
    const latest = request.getBlock();
    if (!latest) return;
    const { view } = request;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(latest.pos + 1)),
      ),
    );
    view.focus();
  };

  const { anchorRect } = request;

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) return;
        setRequest(null);
        request.onClose();
      }}
      open
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed"
          style={{
            height: anchorRect.height,
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={t("editor.blockMenu.label")}
        className={instantCloseMenuClass}
        collisionPadding={8}
        // The actions focus the editor themselves, and a click elsewhere keeps
        // the focus it gave. This runs a tick after the menu goes, so focus
        // taken in between stays too.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const escaped = escapedRef.current;
          escapedRef.current = false;
          const focusTaken =
            !!document.activeElement &&
            document.activeElement !== document.body;
          if (escaped && !focusTaken) returnToBlock();
        }}
        onEscapeKeyDown={() => {
          escapedRef.current = true;
        }}
        side="right"
        sideOffset={6}
      >
        {table && headers ? (
          <>
            <MenuSwitchItem
              checked={headers.row}
              icon={<IconTableRow className={menuIconClass} />}
              onToggle={() =>
                editTable((tr, target) =>
                  setTableHeaders(tr, target, {
                    row: !getTableHeaders(target.node).row,
                  }),
                )
              }
            >
              {t("database.headerRow")}
            </MenuSwitchItem>
            <MenuSwitchItem
              checked={headers.column}
              icon={<IconTableColumn className={menuIconClass} />}
              onToggle={() =>
                editTable((tr, target) =>
                  setTableHeaders(tr, target, {
                    column: !getTableHeaders(target.node).column,
                  }),
                )
              }
            >
              {t("database.headerColumn")}
            </MenuSwitchItem>
            <MenuSwitchItem
              checked={table.node.attrs.fitPageWidth === true}
              icon={<IconArrowAutofitWidth className={menuIconClass} />}
              onToggle={() =>
                editTable((tr, target) =>
                  setTableFitWidth(
                    tr,
                    target,
                    target.node.attrs.fitPageWidth !== true,
                  ),
                )
              }
            >
              {t("database.fitToWidth")}
            </MenuSwitchItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem className="gap-2" onSelect={request.duplicate}>
          <IconCopy className={menuIconClass} />
          {t("editor.blockMenu.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={request.remove}
        >
          <IconTrash className="size-4 shrink-0" />
          {t("editor.blockMenu.delete")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={request.insertBelow}>
          <IconPlus className={menuIconClass} />
          {t("editor.blockMenu.insertBelow")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
