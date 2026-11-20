import { useT } from "@agent-native/core/client/i18n";
import {
  IconAbc,
  IconAlignLeft,
  IconArrowsSplit,
  IconAt,
  IconCalculator,
  IconCalendar,
  IconCircleCheck,
  IconClock,
  IconDots,
  IconEyeOff,
  IconFile,
  IconFileCheck,
  IconH1,
  IconH2,
  IconH3,
  IconHash,
  IconHeadphones,
  IconLink,
  IconListCheck,
  IconListNumbers,
  IconMapPin,
  IconPhone,
  IconPhoto,
  IconPlus,
  IconSeparator,
  IconSignature,
  IconSquareCheck,
  IconStar,
  IconTable,
  IconTextCaption,
  IconUpload,
  IconVideo,
  IconWorld,
  IconChevronDown,
  type Icon,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { InsertKind, T } from "./editor-ops";

export type InsertItem = { kind: InsertKind; labelKey: string; icon: Icon };

export const INSERT_GROUPS: { labelKey: string; items: InsertItem[] }[] = [
  {
    labelKey: "forms.editor.insertGroups.questions",
    items: [
      {
        kind: "INPUT_TEXT",
        labelKey: "forms.editor.insertItems.shortAnswer",
        icon: IconAbc,
      },
      {
        kind: "TEXTAREA",
        labelKey: "forms.editor.insertItems.longAnswer",
        icon: IconTextCaption,
      },
      {
        kind: "MULTIPLE_CHOICE",
        labelKey: "forms.editor.insertItems.multipleChoice",
        icon: IconCircleCheck,
      },
      {
        kind: "CHECKBOXES",
        labelKey: "forms.editor.insertItems.checkboxes",
        icon: IconSquareCheck,
      },
      {
        kind: "DROPDOWN",
        labelKey: "forms.editor.insertItems.dropdown",
        icon: IconChevronDown,
      },
      {
        kind: "MULTI_SELECT",
        labelKey: "forms.editor.insertItems.multiSelect",
        icon: IconListCheck,
      },
      {
        kind: "INPUT_NUMBER",
        labelKey: "forms.editor.insertItems.number",
        icon: IconHash,
      },
      {
        kind: "INPUT_EMAIL",
        labelKey: "forms.editor.insertItems.email",
        icon: IconAt,
      },
      {
        kind: "INPUT_PHONE_NUMBER",
        labelKey: "forms.editor.insertItems.phoneNumber",
        icon: IconPhone,
      },
      {
        kind: "INPUT_LINK",
        labelKey: "forms.editor.insertItems.link",
        icon: IconLink,
      },
      {
        kind: "INPUT_DATE",
        labelKey: "forms.editor.insertItems.date",
        icon: IconCalendar,
      },
      {
        kind: "INPUT_TIME",
        labelKey: "forms.editor.insertItems.time",
        icon: IconClock,
      },
      {
        kind: "LINEAR_SCALE",
        labelKey: "forms.editor.insertItems.linearScale",
        icon: IconDots,
      },
      {
        kind: "RATING",
        labelKey: "forms.editor.insertItems.rating",
        icon: IconStar,
      },
      {
        kind: "FILE_UPLOAD",
        labelKey: "forms.richBlocks.insert.fileUpload",
        icon: IconUpload,
      },
      {
        kind: "MATRIX",
        labelKey: "forms.richBlocks.insert.matrix",
        icon: IconTable,
      },
      {
        kind: "SIGNATURE",
        labelKey: "forms.richBlocks.insert.signature",
        icon: IconSignature,
      },
      {
        kind: "RANKING",
        labelKey: "forms.richBlocks.insert.ranking",
        icon: IconListNumbers,
      },
    ],
  },
  {
    labelKey: "forms.editor.insertGroups.layoutBlocks",
    items: [
      {
        kind: "PAGE_BREAK",
        labelKey: "forms.editor.insertItems.newPage",
        icon: IconFile,
      },
      {
        kind: "THANK_YOU_PAGE",
        labelKey: "forms.editor.insertItems.thankYouPage",
        icon: IconFileCheck,
      },
      {
        kind: "TEXT",
        labelKey: "forms.editor.insertItems.text",
        icon: IconAlignLeft,
      },
      {
        kind: "HEADING_1",
        labelKey: "forms.editor.insertItems.heading1",
        icon: IconH1,
      },
      {
        kind: "HEADING_2",
        labelKey: "forms.editor.insertItems.heading2",
        icon: IconH2,
      },
      {
        kind: "HEADING_3",
        labelKey: "forms.editor.insertItems.heading3",
        icon: IconH3,
      },
      {
        kind: "DIVIDER",
        labelKey: "forms.editor.insertItems.divider",
        icon: IconSeparator,
      },
    ],
  },
  {
    labelKey: "forms.richBlocks.insert.embedBlocks",
    items: [
      {
        kind: "IMAGE",
        labelKey: "forms.richBlocks.insert.image",
        icon: IconPhoto,
      },
      {
        kind: "EMBED_VIDEO",
        labelKey: "forms.richBlocks.insert.video",
        icon: IconVideo,
      },
      {
        kind: "EMBED_AUDIO",
        labelKey: "forms.richBlocks.insert.audio",
        icon: IconHeadphones,
      },
      {
        kind: "EMBED_MAP",
        labelKey: "forms.richBlocks.insert.map",
        icon: IconMapPin,
      },
      {
        kind: "EMBED_LINK",
        labelKey: "forms.richBlocks.insert.embedAnything",
        icon: IconWorld,
      },
    ],
  },
  {
    labelKey: "forms.editor.insertGroups.advancedBlocks",
    items: [
      {
        kind: "CONDITIONAL_LOGIC",
        labelKey: "forms.editor.insertItems.conditionalLogic",
        icon: IconArrowsSplit,
      },
      {
        kind: "HIDDEN_FIELDS",
        labelKey: "forms.calc.insertHidden",
        icon: IconEyeOff,
      },
      {
        kind: "CALCULATED_FIELDS",
        labelKey: "forms.calc.insertCalculated",
        icon: IconCalculator,
      },
    ],
  },
];

export function filterInsertItems(filter: string, t: T): InsertItem[] {
  const needle = filter.trim().toLowerCase();
  return INSERT_GROUPS.flatMap((group) => group.items).filter((item) =>
    t(item.labelKey).toLowerCase().includes(needle),
  );
}

function InsertList({
  items,
  active,
  onActive,
  onPick,
}: {
  items: InsertItem[];
  active: number;
  onActive: (index: number) => void;
  onPick: (kind: InsertKind) => void;
}) {
  const t = useT();
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (items.length === 0)
    return (
      <p className="px-3 py-6 text-sm text-muted-foreground">
        {t("forms.editor.noResults")}
      </p>
    );

  return (
    <div className="flex flex-col p-1.5">
      {INSERT_GROUPS.map((group) => {
        const shown = group.items.filter((item) => items.includes(item));
        if (shown.length === 0) return null;
        return (
          <div key={group.labelKey} className="flex flex-col">
            <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {t(group.labelKey)}
            </div>
            {shown.map((item) => {
              const index = items.indexOf(item);
              const Glyph = item.icon;
              return (
                <button
                  key={item.kind}
                  ref={index === active ? activeRef : undefined}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={cn(
                    "flex h-7 items-center gap-2.5 rounded-md px-2.5 text-left text-sm",
                    index === active && "bg-accent",
                  )}
                  onMouseEnter={() => onActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(item.kind)}
                >
                  <Glyph
                    className="size-4 text-muted-foreground"
                    stroke={1.6}
                  />
                  {t(item.labelKey)}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Keyboard state for a filtered list: Up/Down move, Enter picks. */
export function useInsertNavigation(filter: string) {
  const t = useT();
  const items = filterInsertItems(filter, t);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [filter]);
  function onKey(
    event: { key: string; preventDefault: () => void },
    pick: (kind: InsertKind) => void,
  ): boolean {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        (value) => (value + step + items.length) % Math.max(items.length, 1),
      );
      return true;
    }
    if (event.key === "Enter") {
      const chosen = items[active];
      if (!chosen) return false;
      event.preventDefault();
      pick(chosen.kind);
      return true;
    }
    return false;
  }
  return { items, active, setActive, onKey };
}

/** The `/` menu: floats under the block being typed in, focus stays there. */
export function SlashMenu({
  open,
  items,
  active,
  onActive,
  onPick,
  children,
}: {
  open: boolean;
  items: InsertItem[];
  active: number;
  onActive: (index: number) => void;
  onPick: (kind: InsertKind) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} modal={false}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        role="menu"
        align="start"
        side="bottom"
        sideOffset={6}
        className="max-h-[420px] w-[300px] overflow-y-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <InsertList
          items={items}
          active={active}
          onActive={onActive}
          onPick={onPick}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The Add block dialog: search field plus the same list. */
export function InsertDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (kind: InsertKind) => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const { items, active, setActive, onKey } = useInsertNavigation(filter);
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="top-[100px] flex h-[700px] max-h-[calc(100vh-120px)] w-[700px] max-w-[calc(100vw-32px)] translate-y-0 flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">
          {t("forms.editor.insertTitle")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("forms.editor.insertDescription")}
        </DialogDescription>
        <div className="flex h-[50px] shrink-0 items-center gap-3 border-b border-b-border px-4">
          <IconPlus className="size-4 text-muted-foreground" />
          <input
            autoFocus
            aria-label={t("forms.editor.searchBlocks")}
            value={filter}
            placeholder={t("forms.editor.searchPlaceholder")}
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => onKey(event, onPick)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InsertList
            items={items}
            active={active}
            onActive={setActive}
            onPick={onPick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
