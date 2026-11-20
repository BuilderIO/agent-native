import { useT } from "@agent-native/core/client/i18n";
import { IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const handleClass =
  "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent";

const GUTTER_HEIGHT = 28;

// Centres the gutter on the block's first text line; padding and line height differ per block type.
function firstLineCenter(row: HTMLElement): number | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent?.trim() && !node.parentElement?.closest("[data-gutter]")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  const node = walker.nextNode();
  const rowTop = row.getBoundingClientRect().top;
  if (!node) {
    const editable = row.querySelector<HTMLElement>("[contenteditable]");
    if (!editable) return null;
    const style = getComputedStyle(editable);
    const lineHeight = parseFloat(style.lineHeight);
    if (Number.isNaN(lineHeight)) return null;
    return (
      editable.getBoundingClientRect().top -
      rowTop +
      parseFloat(style.paddingTop) +
      lineHeight / 2
    );
  }
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 1);
  const line = range.getClientRects()[0];
  if (!line) return null;
  return (line.top + line.bottom) / 2 - rowTop;
}

export type DropSide = "before" | "after";

/** One editor item with its hover gutter: delete, add, and a move handle. */
export function BlockRow({
  id,
  selected,
  drop,
  menu,
  title,
  onAdd,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  children,
}: {
  id: string;
  selected: boolean;
  drop: DropSide | null;
  menu: ReactNode;
  title?: ReactNode;
  onAdd: () => void;
  onDelete: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, side: DropSide) => void;
  onDrop: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const gutter = hovered || menuOpen;
  const rowRef = useRef<HTMLDivElement>(null);
  const [gutterTop, setGutterTop] = useState(1);

  useLayoutEffect(() => {
    if (!gutter || !rowRef.current) return;
    const center = firstLineCenter(rowRef.current);
    setGutterTop(center === null ? 1 : Math.round(center - GUTTER_HEIGHT / 2));
  }, [gutter]);

  function over(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    onDragOver(
      id,
      event.clientY < box.top + box.height / 2 ? "before" : "after",
    );
  }

  return (
    <div
      ref={rowRef}
      data-item={id}
      className={cn(
        "relative flex flex-col gap-0.5 rounded-md px-4 py-px min-[960px]:px-[100px]",
        selected && "bg-primary/5 ring-1 ring-primary/30",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={over}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {drop ? (
        <div
          className={cn(
            "pointer-events-none absolute right-4 left-4 z-10 h-0.5 bg-primary min-[960px]:right-[100px] min-[960px]:left-[100px]",
            drop === "before" ? "-top-px" : "-bottom-px",
          )}
        />
      ) : null}
      {gutter ? (
        <div
          data-gutter
          className="absolute left-[17px] flex h-7 items-center gap-0.5 max-md:hidden"
          style={{ top: gutterTop }}
        >
          <button
            type="button"
            aria-label={t("forms.editor.deleteBlock")}
            className={handleClass}
            onClick={onDelete}
          >
            <IconTrash className="size-4" stroke={1.6} />
          </button>
          <button
            type="button"
            aria-label={t("forms.editor.addBlock")}
            className={handleClass}
            onClick={onAdd}
          >
            <IconPlus className="size-4" stroke={1.6} />
          </button>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("forms.editor.moveBlock")}
                draggable
                className={cn(handleClass, "cursor-grab")}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", id);
                  onDragStart(id);
                }}
              >
                <IconGripVertical className="size-4" stroke={1.6} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-72 p-3">
              {menu}
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
      {title === undefined ? (
        <div className="relative">{children}</div>
      ) : (
        <>
          <div className="relative">{title}</div>
          <div className="relative mb-2.5">{children}</div>
        </>
      )}
    </div>
  );
}
