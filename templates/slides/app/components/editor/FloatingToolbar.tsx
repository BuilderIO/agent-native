import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowRight,
  IconArrowsMaximize,
  IconBolt,
  IconBulb,
  IconCategory,
  IconChartBar,
  IconChevronDown,
  IconCircleDotted,
  IconEyeglass,
  IconHandStop,
  IconHexagon,
  IconMessageCircle,
  IconMinus,
  IconOval,
  IconPhotoVideo,
  IconPin,
  IconPointer,
  IconResize,
  IconRobot,
  IconSlash,
  IconSparkles,
  IconSquare,
  IconSquareArrowLeft,
  IconTypography,
  IconUserEdit,
  IconWaveSine,
  type Icon,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AnimationType } from "@/context/DeckContext";
import { cn } from "@/lib/utils";

export type FloatingToolbarMoveTool = "move" | "hand" | "scale";
export type FloatingToolbarInsertTool =
  | "text"
  | "line"
  | "arrow"
  | "square"
  | "ellipse"
  | "shape"
  | "media"
  | "chart";
export type FloatingToolbarTransition = "none" | AnimationType;
type FloatingToolbarCommentAction = "comments" | "annotate" | "pin";
type FloatingToolbarAgentAction = "inspiration" | "tighten-tone" | "polish";

type MenuItem<V extends string> = {
  value: V;
  labelKey: string;
  icon: Icon;
  shortcut?: string;
  separatorBefore?: boolean;
};

const MOVE_ITEMS: MenuItem<FloatingToolbarMoveTool>[] = [
  {
    value: "move",
    labelKey: "floatingToolbar.move",
    icon: IconPointer,
    shortcut: "V",
  },
  {
    value: "hand",
    labelKey: "floatingToolbar.hand",
    icon: IconHandStop,
    shortcut: "H",
  },
  {
    value: "scale",
    labelKey: "floatingToolbar.scale",
    icon: IconResize,
    shortcut: "K",
  },
];

const INSERT_ITEMS: MenuItem<FloatingToolbarInsertTool>[] = [
  {
    value: "text",
    labelKey: "floatingToolbar.text",
    icon: IconTypography,
  },
  { value: "line", labelKey: "floatingToolbar.line", icon: IconMinus },
  { value: "arrow", labelKey: "floatingToolbar.arrow", icon: IconArrowRight },
  { value: "square", labelKey: "floatingToolbar.square", icon: IconSquare },
  { value: "ellipse", labelKey: "floatingToolbar.ellipse", icon: IconOval },
  { value: "shape", labelKey: "floatingToolbar.shape", icon: IconHexagon },
  {
    value: "media",
    labelKey: "floatingToolbar.media",
    icon: IconPhotoVideo,
    separatorBefore: true,
  },
  { value: "chart", labelKey: "floatingToolbar.chart", icon: IconChartBar },
];

const TRANSITION_ITEMS: MenuItem<FloatingToolbarTransition>[] = [
  {
    value: "none",
    labelKey: "floatingToolbar.transitionNone",
    icon: IconSlash,
  },
  {
    value: "appear",
    labelKey: "floatingToolbar.transitionAppear",
    icon: IconCircleDotted,
  },
  {
    value: "fade",
    labelKey: "floatingToolbar.transitionFade",
    icon: IconWaveSine,
  },
  {
    value: "slide-up",
    labelKey: "floatingToolbar.transitionSlide",
    icon: IconSquareArrowLeft,
  },
  {
    value: "zoom",
    labelKey: "floatingToolbar.transitionZoom",
    icon: IconArrowsMaximize,
  },
];

const COMMENT_ITEMS: MenuItem<FloatingToolbarCommentAction>[] = [
  {
    value: "comments",
    labelKey: "floatingToolbar.comments",
    icon: IconMessageCircle,
  },
  {
    value: "annotate",
    labelKey: "floatingToolbar.annotate",
    icon: IconUserEdit,
  },
  { value: "pin", labelKey: "floatingToolbar.pinComment", icon: IconPin },
];

const ALL_TRANSITIONS = TRANSITION_ITEMS.map((item) => item.value);

const AGENT_ITEMS: MenuItem<FloatingToolbarAgentAction>[] = [
  {
    value: "inspiration",
    labelKey: "floatingToolbar.inspiration",
    icon: IconBulb,
  },
  {
    value: "tighten-tone",
    labelKey: "floatingToolbar.tightenTone",
    icon: IconEyeglass,
  },
  { value: "polish", labelKey: "floatingToolbar.polish", icon: IconSparkles },
];

// The bar stays dark in both themes, like the Figma toolbar it mirrors.
const TOOL_BUTTON = // guard:allow-raw-color — white-on-dark controls of the fixed dark surface
  "inline-flex shrink-0 items-center justify-center text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const ACTIVE_BUTTON =
  "bg-[var(--editor-accent-color,#0f9bff)] text-white hover:bg-[var(--editor-accent-color,#0f9bff)]"; // guard:allow-raw-color — Figma accent fallback

interface ToolGroupProps<V extends string> {
  icon: Icon;
  tooltip: string;
  menuLabel: string;
  items: MenuItem<V>[];
  active?: boolean;
  onActivate?: () => void;
  onSelect?: (value: V) => void;
  /** Main-button click opens the menu instead of acting. */
  openMenuOnActivate?: boolean;
  /** Highlights the matching menu row, for groups that hold a current choice. */
  value?: V | null;
  /** Individual rows that stay visible but cannot be chosen. */
  disabledValues?: readonly V[];
}

function ToolGroup<V extends string>({
  icon: GroupIcon,
  tooltip,
  menuLabel,
  items,
  active = false,
  onActivate,
  onSelect,
  openMenuOnActivate = false,
  value,
  disabledValues,
}: ToolGroupProps<V>) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={tooltip}
            aria-pressed={active}
            onClick={openMenuOnActivate ? () => setMenuOpen(true) : onActivate}
            className={cn(
              TOOL_BUTTON,
              "relative z-10 size-8 rounded-md",
              active && ACTIVE_BUTTON,
            )}
          >
            <GroupIcon className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={menuLabel}
            className={cn(TOOL_BUTTON, "-ml-1 size-[22px] rounded-md")}
          >
            <IconChevronDown className="size-3" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={12}
          className="min-w-[151px]"
        >
          {items.map((item) => (
            <MenuRow
              key={item.value}
              item={item}
              selected={item.value === value}
              disabled={Boolean(disabledValues?.includes(item.value))}
              onSelect={onSelect}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MenuRow<V extends string>({
  item,
  selected,
  disabled,
  onSelect,
}: {
  item: MenuItem<V>;
  selected: boolean;
  disabled: boolean;
  onSelect?: (value: V) => void;
}) {
  const t = useT();
  const ItemIcon = item.icon;
  return (
    <>
      {item.separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => onSelect?.(item.value)}
        className={cn("gap-2", selected && "bg-accent")}
      >
        <ItemIcon className="size-4 shrink-0" aria-hidden />
        {t(item.labelKey)}
        {item.shortcut ? (
          <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
        ) : null}
      </DropdownMenuItem>
    </>
  );
}

export interface FloatingToolbarProps {
  className?: string;
  /** The armed move-group tool; null while a placement or comment tool is. */
  moveTool?: FloatingToolbarMoveTool | null;
  onSelectMoveTool?: (tool: FloatingToolbarMoveTool) => void;
  /** The Insert row matching the armed placement tool, if any. */
  insertValue?: FloatingToolbarInsertTool | null;
  onInsert?: (tool: FloatingToolbarInsertTool) => void;
  /** True while the animations panel is open. */
  transitionsOpen?: boolean;
  /** The selected element's animation; "none" when it has none. */
  transitionValue?: FloatingToolbarTransition | null;
  /** No element is selected, or the deck is read-only. */
  transitionsDisabled?: boolean;
  onOpenTransitions?: () => void;
  onSelectTransition?: (transition: FloatingToolbarTransition) => void;
  /** True while the comments panel is open. */
  commentsOpen?: boolean;
  /** The armed comment tool, if any. */
  commentToolValue?: FloatingToolbarCommentAction | null;
  /** Rows the viewer lacks the permission for. */
  disabledCommentActions?: readonly FloatingToolbarCommentAction[];
  onOpenComments?: () => void;
  onCommentAction?: (action: FloatingToolbarCommentAction) => void;
  onOpenAgent?: () => void;
  onAgentAction?: (action: FloatingToolbarAgentAction) => void;
}

export const FloatingToolbar = memo(function FloatingToolbar({
  className,
  moveTool = "move",
  onSelectMoveTool,
  insertValue = null,
  onInsert,
  transitionsOpen = false,
  transitionValue = null,
  transitionsDisabled = false,
  onOpenTransitions,
  onSelectTransition,
  commentsOpen = false,
  commentToolValue = null,
  disabledCommentActions,
  onOpenComments,
  onCommentAction,
  onOpenAgent,
  onAgentAction,
}: FloatingToolbarProps) {
  const t = useT();

  return (
    <div
      role="toolbar"
      aria-label={t("floatingToolbar.label")}
      className={cn(
        "flex items-center gap-0.5 rounded-xl bg-[#3c3c3c] p-2 shadow-[0_2px_3px_rgba(0,0,0,0.22)]", // guard:allow-raw-color — fixed dark surface from Figma
        className,
      )}
    >
      <ToolGroup
        icon={
          MOVE_ITEMS.find((item) => item.value === moveTool)?.icon ??
          IconPointer
        }
        tooltip={t("floatingToolbar.move")}
        menuLabel={t("floatingToolbar.moveMenu")}
        items={MOVE_ITEMS}
        value={moveTool}
        active={moveTool !== null}
        onActivate={() => onSelectMoveTool?.("move")}
        onSelect={onSelectMoveTool}
      />
      <ToolGroup
        icon={IconCategory}
        tooltip={t("floatingToolbar.insert")}
        menuLabel={t("floatingToolbar.insertMenu")}
        items={INSERT_ITEMS}
        value={insertValue}
        active={insertValue !== null}
        openMenuOnActivate
        onSelect={onInsert}
      />
      <ToolGroup
        icon={IconBolt}
        tooltip={t("floatingToolbar.transitions")}
        menuLabel={t("floatingToolbar.transitionsMenu")}
        items={TRANSITION_ITEMS}
        active={transitionsOpen}
        value={transitionValue}
        disabledValues={transitionsDisabled ? ALL_TRANSITIONS : undefined}
        onActivate={onOpenTransitions}
        onSelect={onSelectTransition}
      />
      <ToolGroup
        icon={IconMessageCircle}
        tooltip={t("floatingToolbar.comment")}
        menuLabel={t("floatingToolbar.commentMenu")}
        items={COMMENT_ITEMS}
        active={commentsOpen || commentToolValue !== null}
        value={commentToolValue ?? (commentsOpen ? "comments" : null)}
        disabledValues={disabledCommentActions}
        onActivate={onOpenComments}
        onSelect={onCommentAction}
      />
      <ToolGroup
        icon={IconRobot}
        tooltip={t("floatingToolbar.agent")}
        menuLabel={t("floatingToolbar.agentMenu")}
        items={AGENT_ITEMS}
        onActivate={onOpenAgent}
        onSelect={onAgentAction}
      />
    </div>
  );
});
