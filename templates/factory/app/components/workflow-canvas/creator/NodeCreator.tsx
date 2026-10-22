import {
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconMessageCircle,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorkflowCatalog } from "@/lib/workflow-editor";

import { NODE_KIND_ICONS } from "../node-kinds";
import type { PaletteEntry } from "../palette";
import { ProviderIcon, providerIdentity } from "../provider-identity";
import {
  useWorkflowCanvasStrings,
  type WorkflowCanvasStrings,
} from "../strings";
import {
  creatorList,
  highlightedRow,
  horizontalKey,
  isStartList,
  listKind,
  listLabel,
  moveHighlight,
  selectableRows,
  type AppGroup,
  type CreatorItem,
  type CreatorListModel,
  type CreatorRow,
  type CreatorTarget,
  type CreatorView,
  type ProviderLinkStatus,
} from "./creator-model";

export type { CreatorTarget } from "./creator-model";

interface NodeCreatorProps {
  catalog: WorkflowCatalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CreatorTarget;
  hasTrigger: boolean;
  /** Each provider's status for this person. A provider left out reads as `unknown`. */
  connections?: Readonly<Record<string, ProviderLinkStatus>>;
  onPick: (entry: PaletteEntry) => void;
  /** Receives the query when nothing matches. Without it, that row is not offered. */
  onDescribe?: (query: string) => void;
  /** Receives a provider whose Connect control was used. Without it, no control shows. */
  onConnect?: (provider: string) => void;
  /**
   * Called when a pick, a described query or Escape closes the panel, so the owner can
   * move focus back to the canvas. The event is a notice and the panel focuses nothing
   * itself. An outside press does not call it, because focus already moved there.
   */
  onCloseAutoFocus?: (event: Event) => void;
}

/** One list in the stack. The root is first; a deeper list slides in over the one below it. */
interface Frame {
  id: number;
  view: CreatorView;
  query: string;
  highlight: string | null;
  open: Partial<Record<AppGroup, boolean>>;
}

/** Matches `duration-200` on the slide classes. */
const SLIDE_MS = 200;

const ROW_CLASS =
  "relative flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-foreground before:opacity-0 hover:before:opacity-100 data-[active]:before:bg-primary data-[active]:before:opacity-100";

let frameSerial = 0;

function newFrame(view: CreatorView): Frame {
  frameSerial += 1;
  return { id: frameSerial, view, query: "", highlight: null, open: {} };
}

/**
 * A panel of what a new step can be, at the right edge of the canvas. It does not
 * block the canvas: a press outside it closes it, and Escape closes it at any depth.
 * The owner's parent must be positioned, because the panel is absolutely placed.
 */
export function NodeCreator({
  catalog,
  open,
  onOpenChange,
  target,
  hasTrigger,
  connections,
  onPick,
  onDescribe,
  onConnect,
  onCloseAutoFocus,
}: NodeCreatorProps) {
  const s = useWorkflowCanvasStrings();
  const describable = onDescribe !== undefined;
  const start = isStartList(target, hasTrigger);
  const [stack, setStack] = useState<Frame[]>(() => [
    newFrame({ kind: "root" }),
  ]);
  // A list that was just backed out of stays here until its slide-out has run.
  const [leaving, setLeaving] = useState<Frame[]>([]);
  // Every opening starts at the root with an empty search.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setStack([newFrame({ kind: "root" })]);
    setLeaving([]);
  }
  const listBase = useId();
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const timers = useRef(new Set<number>());
  const panel = useRef<HTMLElement>(null);
  const lastPress = useRef<Event | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const top = stack[stack.length - 1];
  const topId = top.id;
  const modelOf = (frame: Frame): CreatorListModel =>
    creatorList({
      catalog,
      target,
      hasTrigger,
      view: frame.view,
      query: frame.query,
      open: frame.open,
      describable,
      strings: s,
    });
  const topModel = modelOf(top);
  const rows = selectableRows(topModel.items);
  const activeRow = highlightedRow(rows, top.highlight);
  const optionId = (frameId: number, rowId: string) =>
    `${listBase}-${frameId}-${rowId}`;
  const activeOption =
    activeRow === undefined ? undefined : optionId(topId, activeRow.id);

  // Focus goes to the search box when the list has one, and to the list otherwise, so the keys keep working.
  useEffect(() => {
    if (!open) return;
    const field =
      inputs.current.get(topId) ??
      document.getElementById(`${listBase}-${topId}-list`);
    field?.focus({ preventScroll: true });
  }, [open, topId, listBase]);

  useEffect(() => {
    if (activeOption !== undefined) {
      document
        .getElementById(activeOption)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeOption]);

  // A press counts as inside when React reports it from the panel, which includes a
  // popover or dialog the panel opened. Comparing the native event keeps this exact.
  useEffect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: Event) => {
      if (event === lastPress.current) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [open, onOpenChange]);

  const patchFrame = (id: number, patch: Partial<Frame>) =>
    setStack((current) =>
      current.map((frame) =>
        frame.id === id ? { ...frame, ...patch } : frame,
      ),
    );
  const patchTop = (patch: Partial<Frame>) => patchFrame(topId, patch);

  const push = (view: CreatorView) => {
    setLeaving([]);
    setStack((current) => [...current, newFrame(view)]);
  };

  const back = () => {
    if (stack.length < 2) return;
    const gone = stack[stack.length - 1];
    setStack((current) => current.slice(0, -1));
    setLeaving((current) => [...current, gone]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((current) => current.filter((frame) => frame.id !== gone.id));
    }, SLIDE_MS);
    timers.current.add(timer);
  };

  const close = (refocus: boolean) => {
    onOpenChange(false);
    if (refocus) {
      onCloseAutoFocus?.(new Event("creatorclose", { cancelable: true }));
    }
  };

  const choose = (row: CreatorRow) => {
    switch (row.type) {
      case "entry":
        onPick(row.entry);
        close(true);
        return;
      case "list":
      case "provider":
        // The row that opened the list stays highlighted, so Back returns to it.
        patchTop({ highlight: row.id });
        push(row.view);
        return;
      case "group":
        patchTop({ open: { ...top.open, [row.group]: !row.open } });
        return;
      case "describe":
        onDescribe?.(top.query.trim());
        close(true);
        return;
    }
  };

  // The keys belong to the panel, so they work from the search box and from the list.
  // A press inside a popover or dialog the panel opened is not on the panel's own tree,
  // so that layer keeps its keys. A button keeps Enter and Space for its own click.
  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (event.nativeEvent.isComposing) return;
    if (!(target instanceof Node) || !panel.current?.contains(target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (target instanceof HTMLButtonElement) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      patchTop({
        highlight: moveHighlight(
          rows,
          activeRow?.id ?? null,
          event.key === "ArrowDown" ? 1 : -1,
        ),
      });
      return;
    }
    if (event.key === "Enter") {
      if (activeRow === undefined) return;
      event.preventDefault();
      choose(activeRow);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // Only the search box has a caret. Without one, the arrows always navigate.
      const caretAtEnd =
        !(target instanceof HTMLInputElement) ||
        (target.selectionStart === target.value.length &&
          target.selectionEnd === target.value.length);
      const outcome = horizontalKey(
        event.key === "ArrowLeft" ? "left" : "right",
        {
          query: top.query,
          caretAtEnd,
          onOpenGroup: activeRow?.type === "group" && activeRow.open,
        },
      );
      if (outcome === "caret") return;
      if (outcome === "back" && stack.length < 2) return;
      event.preventDefault();
      if (outcome === "back") back();
      else if (outcome === "collapse" && activeRow?.type === "group") {
        patchTop({ open: { ...top.open, [activeRow.group]: false } });
      } else if (outcome === "activate" && activeRow !== undefined) {
        choose(activeRow);
      }
    }
  };

  const onPanelPointerDown = (event: PointerEvent<HTMLElement>) => {
    lastPress.current = event.nativeEvent;
  };

  if (!open) return null;

  const linkOf = (name: string): ProviderLinkStatus =>
    connections?.[name] ?? "unknown";

  const titleOf = (view: CreatorView): string => {
    switch (view.kind) {
      case "root":
        return target.kind === "insert"
          ? s.creator.insertOnEdge
          : s.toolbar.addStep;
      case "list":
        return listLabel(view.list, s);
      case "app":
        return providerIdentity(view.provider).label;
    }
  };

  const placeholderOf = (view: CreatorView): string => {
    switch (view.kind) {
      case "root":
        return s.creator.searchPlaceholder;
      case "list":
        return view.list === "sources" || view.list === "actions"
          ? s.creator.searchApps
          : s.creator.searchPlaceholder;
      case "app":
        return s.creator.searchActions;
    }
  };

  const registerInput = (id: number) => (element: HTMLInputElement | null) => {
    if (element) inputs.current.set(id, element);
    else inputs.current.delete(id);
  };

  const renderRow = (row: CreatorRow, frameId: number, active: boolean) => {
    const isGroup = row.type === "group";
    return (
      <div
        key={row.id}
        role="option"
        id={optionId(frameId, row.id)}
        aria-selected={active}
        data-active={active || undefined}
        // Keeps focus in the search box, which owns the keyboard.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(row)}
        className={cn(
          ROW_CLASS,
          isGroup && "text-sm font-medium",
          row.type === "entry" && row.indented && "ps-9",
        )}
      >
        {rowContent(row)}
      </div>
    );
  };

  const rowContent = (row: CreatorRow) => {
    switch (row.type) {
      case "entry": {
        const KindIcon = NODE_KIND_ICONS[row.entry.kind];
        return (
          <>
            <KindIcon className="size-6 shrink-0" aria-hidden />
            <RowText label={row.label} description={row.description} />
          </>
        );
      }
      case "list": {
        const KindIcon = NODE_KIND_ICONS[row.kind];
        return (
          <>
            <KindIcon className="size-6 shrink-0" aria-hidden />
            <RowText label={row.label} description={row.description} />
            <IconChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </>
        );
      }
      case "provider":
        return (
          <>
            <ProviderIcon provider={row.provider} className="size-6" />
            <RowText label={row.label} />
            <span className="flex shrink-0 items-center gap-2">
              <ConnectionState
                provider={row.provider}
                status={linkOf(row.provider)}
                strings={s}
                onConnect={onConnect}
              />
            </span>
            <IconChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </>
        );
      case "group":
        return (
          <>
            {row.open ? (
              <IconChevronDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            ) : (
              <IconChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {row.label} ({row.count})
            </span>
          </>
        );
      case "describe":
        return (
          <>
            <IconMessageCircle className="size-6 shrink-0" aria-hidden />
            <RowText label={row.label} description={row.description} />
          </>
        );
    }
  };

  const renderItem = (frame: Frame, item: CreatorItem, activeId?: string) => {
    switch (item.type) {
      case "caption":
        return (
          <p
            key={item.id}
            role="presentation"
            className="px-4 pt-3 pb-1 text-xs text-muted-foreground"
          >
            {item.label}
          </p>
        );
      case "notice":
        return (
          <p
            key={item.id}
            role="presentation"
            className="px-4 py-3 text-sm text-muted-foreground"
          >
            {item.label}
          </p>
        );
      default:
        return renderRow(item, frame.id, item.id === activeId);
    }
  };

  const renderLayer = (
    frame: Frame,
    role: "top" | "under" | "leaving",
    model: CreatorListModel,
  ) => {
    const isTop = role === "top";
    const view = frame.view;
    const title = titleOf(view);
    const listId = `${listBase}-${frame.id}-list`;
    const canGoBack = isTop && stack.length > 1;
    const subtitle =
      view.kind === "root" && start ? s.creator.startSubtitle : undefined;
    const placeholder = placeholderOf(view);
    const motion =
      role === "leaving"
        ? "motion-safe:animate-out motion-safe:slide-out-to-right motion-safe:duration-200 motion-reduce:hidden"
        : view.kind === "root"
          ? undefined
          : "motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200";
    const HeaderIcon =
      view.kind === "list" ? NODE_KIND_ICONS[listKind(view.list)] : undefined;

    return (
      <div
        key={frame.id}
        inert={!isTop}
        className={cn("absolute inset-0 flex flex-col bg-background", motion)}
      >
        <header className="flex items-start gap-2 p-4">
          {canGoBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ms-1.5 shrink-0"
              aria-label={s.creator.back}
              onClick={back}
            >
              <IconArrowLeft />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-h-8 items-center gap-2">
              {view.kind === "app" ? (
                <ProviderIcon provider={view.provider} className="size-6" />
              ) : HeaderIcon ? (
                <HeaderIcon className="size-5 shrink-0" aria-hidden />
              ) : null}
              <h2 className="min-w-0 flex-1 truncate text-lg font-medium">
                {title}
              </h2>
              {view.kind === "app" && (
                <span className="flex shrink-0 items-center gap-2">
                  <ConnectionState
                    provider={view.provider}
                    status={linkOf(view.provider)}
                    strings={s}
                    onConnect={onConnect}
                  />
                </span>
              )}
            </div>
            {subtitle && (
              <p
                className={cn(
                  "text-sm text-muted-foreground",
                  canGoBack && "ps-9",
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
        </header>
        {model.searchable && (
          <div className="relative mx-4 mb-3">
            <IconSearch
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={registerInput(frame.id)}
              value={frame.query}
              onChange={(event) =>
                patchFrame(frame.id, {
                  query: event.target.value,
                  highlight: null,
                })
              }
              placeholder={placeholder}
              aria-label={placeholder}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={isTop ? activeOption : undefined}
              className="h-10 ps-9 pe-9"
            />
            {frame.query !== "" && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute end-1 top-1/2 -translate-y-1/2"
                aria-label={s.creator.clearSearch}
                onClick={() => {
                  patchFrame(frame.id, { query: "", highlight: null });
                  inputs.current.get(frame.id)?.focus();
                }}
              >
                <IconX />
              </Button>
            )}
          </div>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label={title}
          // Without a search box the list takes focus, so it names the active row.
          tabIndex={-1}
          aria-activedescendant={
            model.searchable || !isTop ? undefined : activeOption
          }
          className="min-h-0 flex-1 overflow-y-auto pb-4 focus-visible:outline-none"
        >
          {model.items.map((item) =>
            renderItem(frame, item, isTop ? activeRow?.id : undefined),
          )}
        </div>
      </div>
    );
  };

  return (
    <aside
      ref={panel}
      aria-label={titleOf(top.view)}
      onKeyDown={onPanelKeyDown}
      onPointerDown={onPanelPointerDown}
      className="absolute inset-y-0 end-0 z-20 flex w-[385px] max-w-full flex-col overflow-hidden border-s bg-background motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200"
    >
      <div className="relative min-h-0 flex-1">
        {stack.map((frame) =>
          renderLayer(
            frame,
            frame.id === topId ? "top" : "under",
            frame.id === topId ? topModel : modelOf(frame),
          ),
        )}
        {leaving.map((frame) => renderLayer(frame, "leaving", modelOf(frame)))}
      </div>
    </aside>
  );
}

function RowText({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium leading-[18px]">
        {label}
      </span>
      {description && (
        <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
          {description}
        </span>
      )}
    </span>
  );
}

/** Connected reads as a word; not connected reads as a word and a Connect control; unknown shows nothing. */
function ConnectionState({
  provider,
  status,
  strings: s,
  onConnect,
}: {
  provider: string;
  status: ProviderLinkStatus;
  strings: WorkflowCanvasStrings;
  onConnect?: (provider: string) => void;
}) {
  if (status === "unknown") return null;
  if (status === "connected") {
    return (
      <span className="text-xs text-muted-foreground">
        {s.creator.connected}
      </span>
    );
  }
  return (
    <>
      <span className="text-xs text-muted-foreground">
        {s.creator.notConnected}
      </span>
      {onConnect ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={(event) => {
            // Inside a list row, the press must not also pick the row.
            event.stopPropagation();
            onConnect(provider);
          }}
        >
          {s.creator.connect}
        </Button>
      ) : null}
    </>
  );
}
