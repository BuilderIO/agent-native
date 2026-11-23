import { useT } from "@agent-native/core/client/i18n";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconChevronDown,
  IconDots,
  IconDatabase,
  IconForms,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { secondaryFeaturesEnabled } from "@/components/shell/secondary-features";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ADDABLE_CELL_KINDS,
  cellKindDefinition,
  type CellKind,
  type CellMenuEntry,
  type ParameterInputType,
} from "@/lib/model/cell-types";

import { RENDERABLE_INPUT_TYPES } from "./InputCellControl";
import {
  insertCommands,
  notebookCommands,
  notebookLetter,
} from "./notebook-commands";

export function PendingCell({ kind }: { kind: CellKind }) {
  const label = kind === "code" ? "Python" : cellKindDefinition(kind).name;
  return (
    <div className="nb-cell nb-cell-pending">
      <div className="nb-cell-header">
        <span className="nb-cell-title">Adding {label} cell</span>
      </div>
      <div
        className="nb-cell-pending-body"
        role="status"
        aria-label={`Adding ${label} cell`}
      >
        <span className="nb-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}

export type MoreCellEntry = Pick<CellMenuEntry, "kind" | "name" | "inputType">;

type TextKind = "text" | "markdown";
type TextPreference = {
  textKind?: TextKind | undefined;
  onTextKindChange?: ((kind: TextKind) => void) | undefined;
};
type AddTools = {
  data?: (() => void) | undefined;
  component?: (() => void) | undefined;
};

const inputLabelKeys: Partial<Record<ParameterInputType, string>> = {
  CHECKBOX: "notebook.inputConfig.types.checkbox",
  DATE: "notebook.inputConfig.types.date",
  DROPDOWN: "notebook.inputConfig.types.dropdown",
  MULTISELECT: "notebook.inputConfig.types.multiselect",
  NUMERIC_INPUT: "notebookInsert.numberInput",
  SLIDER: "notebook.inputConfig.types.slider",
  TEXT_INPUT: "notebookInsert.textInput",
};

function useAddOptions(
  entries: readonly MoreCellEntry[],
  supportedKinds: readonly CellKind[],
) {
  const t = useT();
  const supports = (kind: CellKind) =>
    ADDABLE_CELL_KINDS.some((entry) => entry === kind) &&
    supportedKinds.includes(kind);
  const commands = insertCommands.filter(({ kind }) => supports(kind));
  const inputs = supports("input")
    ? entries.filter(
        (entry) =>
          entry.kind === "input" &&
          entry.inputType !== undefined &&
          RENDERABLE_INPUT_TYPES.includes(entry.inputType),
      )
    : [];
  return {
    commands,
    inputs,
    renderInput: (entry: MoreCellEntry) => {
      const key = entry.inputType && inputLabelKeys[entry.inputType];
      return key ? t(key, { defaultValue: entry.name }) : entry.name;
    },
    inputsHeader: {
      title: t("notebookInsert.inputs", { defaultValue: "Inputs" }),
      description: t("notebookInsert.inputsDescription", {
        defaultValue: "Interactive parameters enabling dynamic inputs.",
      }),
    },
  };
}

function AddMenuHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <DropdownMenuLabel className="nb-more-menu-header">
      <h5 className="nb-more-menu-title">{title}</h5>
      {description && (
        <div className="nb-more-menu-description">{description}</div>
      )}
    </DropdownMenuLabel>
  );
}

const MenuHoverContext = createContext<{
  cancelClose: () => void;
  scheduleClose: () => void;
} | null>(null);

function MoreMenuSubContent({ children }: { children: ReactNode }) {
  const hoverMenu = useContext(MenuHoverContext);
  return (
    <DropdownMenuSubContent
      onMouseEnter={hoverMenu?.cancelClose}
      onMouseLeave={hoverMenu?.scheduleClose}
    >
      {children}
    </DropdownMenuSubContent>
  );
}

function closeOtherHoverMenus(
  closers: Map<string, () => void> | undefined,
  activeId: string | undefined,
) {
  if (!closers) return;
  for (const [id, close] of closers) {
    if (id !== activeId) close();
  }
}

export function MoreCellsMenu({
  trigger,
  label,
  entries,
  disabled,
  onPick,
  header,
  align = "start",
  renderLabel,
  shortcut,
  onClose,
  hoverId,
  hoverClosers,
  children,
}: {
  trigger: ReactElement;
  label?: string;
  entries: readonly MoreCellEntry[];
  disabled: boolean;
  onPick: (entry: MoreCellEntry) => void;
  header?: { title: string; description?: string } | undefined;
  align?: "start" | "center" | "end";
  renderLabel?: ((entry: MoreCellEntry) => string) | undefined;
  shortcut?: ((entry: MoreCellEntry) => string | undefined) | undefined;
  onClose?: (() => void) | undefined;
  hoverId?: string | undefined;
  hoverClosers?: Map<string, () => void> | undefined;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hover = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!hoverId || !hoverClosers) return;
    const close = () => {
      clear();
      hover.current = false;
      setOpen(false);
    };
    hoverClosers.set(hoverId, close);
    return () => {
      hoverClosers.delete(hoverId);
    };
  }, [hoverId, hoverClosers]);
  const scheduleClose = () => {
    clear();
    if (hover.current) timer.current = setTimeout(() => setOpen(false), 150);
  };
  const offered = entries.filter(
    (entry) => entry.kind !== "component-import" || secondaryFeaturesEnabled(),
  );
  const ignoreClosingPointer = (event: PointerEvent) => {
    if (!open) event.preventDefault();
  };
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        hover.current = false;
        clear();
        if (next) closeOtherHoverMenus(hoverClosers, hoverId);
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        asChild
        onMouseEnter={() => {
          clear();
          if (disabled || open) return;
          closeOtherHoverMenus(hoverClosers, hoverId);
          hover.current = true;
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onPointerDown={(event) => {
          if (!open || !hover.current) return;
          event.preventDefault();
          hover.current = false;
          clear();
          document
            .getElementById(
              event.currentTarget.getAttribute("aria-controls") ?? "",
            )
            ?.focus();
        }}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align={align}
        collisionPadding={8}
        aria-label={label}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
        onMouseEnter={clear}
        onMouseLeave={scheduleClose}
        onKeyDown={(event) => {
          if (
            disabled ||
            event.nativeEvent.isComposing ||
            event.repeat ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          const command = notebookLetter(event);
          const index = offered.findIndex(
            (entry) =>
              (shortcut?.(entry) ??
                (entry.kind === "code" ? "W" : undefined)) === command,
          );
          if (index < 0) return;
          event.preventDefault();
          event.currentTarget
            .querySelector<HTMLElement>('[data-add-option="' + index + '"]')
            ?.click();
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing || onClose) event.preventDefault();
          if (!event.isComposing) onClose?.();
        }}
        onCloseAutoFocus={(event) => {
          const focused = document.activeElement;
          if (
            hover.current ||
            (focused?.isConnected && focused !== document.body)
          )
            event.preventDefault();
        }}
      >
        <MenuHoverContext.Provider
          value={{ cancelClose: clear, scheduleClose }}
        >
          {header && <AddMenuHeading {...header} />}
          {offered.map((entry, index) => (
            <DropdownMenuItem
              key={entry.kind + ":" + (entry.inputType ?? "")}
              data-add-option={index}
              aria-label={renderLabel?.(entry) ?? entry.name}
              disabled={disabled}
              onPointerMove={ignoreClosingPointer}
              onPointerLeave={ignoreClosingPointer}
              onSelect={() => onPick(entry)}
            >
              {renderLabel?.(entry) ?? entry.name}
              {shortcut?.(entry) && (
                <DropdownMenuShortcut>{shortcut(entry)}</DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          ))}
          {children}
        </MenuHoverContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type InsertCommand = (typeof insertCommands)[number];

function TextCellTile({
  choice,
  choices,
  disabled,
  gap,
  onAdd,
  onClose,
  hoverId,
  hoverClosers,
}: {
  choice: InsertCommand;
  choices: readonly InsertCommand[];
  disabled: boolean;
  gap: boolean;
  onAdd: (kind: CellKind) => void;
  onClose?: (() => void) | undefined;
  hoverId?: string | undefined;
  hoverClosers?: Map<string, () => void> | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hover = useRef(false);
  const pending = useRef<CellKind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!hoverId || !hoverClosers) return;
    const close = () => {
      clear();
      hover.current = false;
      setOpen(false);
    };
    hoverClosers.set(hoverId, close);
    return () => {
      hoverClosers.delete(hoverId);
    };
  }, [hoverId, hoverClosers]);
  const scheduleClose = () => {
    clear();
    if (hover.current) timer.current = setTimeout(() => setOpen(false), 150);
  };
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        hover.current = false;
        clear();
        if (next) closeOtherHoverMenus(hoverClosers, hoverId);
        setOpen(next);
      }}
    >
      <div
        className="nb-add-split"
        onMouseEnter={() => {
          clear();
          if (disabled || open) return;
          closeOtherHoverMenus(hoverClosers, hoverId);
          hover.current = true;
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
      >
        <AddCellButton
          disabled={disabled}
          icon={<choice.icon size={24} aria-hidden="true" />}
          label={t(choice.labelKey)}
          shortcut={gap ? choice.key : undefined}
          onClick={() => onAdd(choice.kind)}
        />
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="nb-icon-button nb-add-split-trigger"
            aria-label={t("notebookInsert.textOptions")}
            disabled={disabled}
            onPointerDown={(event) => {
              if (!open || !hover.current) return;
              event.preventDefault();
              hover.current = false;
              clear();
              document
                .getElementById(
                  event.currentTarget.getAttribute("aria-controls") ?? "",
                )
                ?.focus();
            }}
          >
            <IconChevronDown size={12} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        side="top"
        align="center"
        onMouseEnter={clear}
        onMouseLeave={scheduleClose}
        onKeyDown={(event) => {
          if (
            !gap ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey
          )
            return;
          const match = choices.find(
            ({ key }) => key === notebookLetter(event),
          );
          if (!match) return;
          event.preventDefault();
          onAdd(match.kind);
        }}
        onCloseAutoFocus={(event) => {
          const kind = pending.current;
          pending.current = null;
          if (kind) {
            event.preventDefault();
            onAdd(kind);
          } else if (hover.current) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing || onClose) event.preventDefault();
          if (!event.isComposing) onClose?.();
        }}
      >
        <AddMenuHeading
          title={t("notebookInsert.text")}
          description={t("notebookInsert.textDescription")}
        />
        {choices.map((entry) => (
          <DropdownMenuItem
            key={entry.kind}
            aria-label={t(entry.labelKey)}
            onSelect={() => {
              pending.current = entry.kind;
            }}
          >
            {t(entry.labelKey)}
            {gap && <DropdownMenuShortcut>{entry.key}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddCellBar({
  autoFocus = false,
  disabled = false,
  disabledReason,
  onAdd,
  onPick,
  entries,
  onClose,
  gap = false,
  supportedKinds = ADDABLE_CELL_KINDS,
  textKind = "text",
  onTextKindChange,
  tools,
}: TextPreference & {
  autoFocus?: boolean;
  disabled?: boolean;
  disabledReason?: string | undefined;
  onAdd: (kind: CellKind) => void;
  onPick: (entry: MoreCellEntry) => void;
  entries: readonly MoreCellEntry[];
  onClose?: (() => void) | undefined;
  gap?: boolean;
  supportedKinds?: readonly CellKind[] | undefined;
  tools?: AddTools | undefined;
}) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const hoverClosers = useRef(new Map<string, () => void>());
  const [width, setWidth] = useState(Infinity);
  const { commands, inputs, inputsHeader, renderInput } = useAddOptions(
    entries,
    supportedKinds,
  );
  const textChoices = commands.filter(
    ({ kind }) => kind === "text" || kind === "markdown",
  );
  const prose =
    textChoices.find(({ kind }) => kind === textKind) ?? textChoices[0];
  const first = commands.filter(
    ({ kind }) => kind === "sql" || kind === "code",
  );
  const visual = commands.filter(
    ({ kind }) =>
      kind === "chart" ||
      kind === "pivot" ||
      kind === "metric" ||
      kind === "display-table",
  );
  const compact = width < 500;
  const visualCount =
    width >= 850 ? Math.min(3, visual.length) : compact ? 0 : 1;
  const overflow = visual.slice(visualCount);
  const inputsInMore = compact && inputs.length > 0;
  const data = tools?.data;
  const dataInMore = compact ? data : undefined;
  const component = tools?.component;
  const section =
    supportedKinds.includes("collapsible") &&
    entries.some((entry) => entry.kind === "collapsible");
  const semanticLayer =
    supportedKinds.includes("dbt-metric") &&
    entries.some((entry) => entry.kind === "dbt-metric");
  const moreAvailable =
    overflow.length > 0 ||
    semanticLayer ||
    inputsInMore ||
    dataInMore !== undefined ||
    component !== undefined ||
    section;
  const add = (kind: CellKind) => {
    if ((kind === "text" || kind === "markdown") && kind !== textKind)
      onTextKindChange?.(kind);
    onAdd(kind);
  };
  const pickTool = (open: () => void) => {
    open();
    onClose?.();
  };

  useEffect(() => {
    const element = wrap.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (autoFocus && !disabled)
      surface.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [autoFocus, disabled]);

  const tile = ({ kind, key, labelKey, icon: Icon }: InsertCommand) => (
    <AddCellButton
      key={kind}
      disabled={disabled}
      icon={<Icon size={24} aria-hidden="true" />}
      label={t(labelKey)}
      shortcut={gap ? key : undefined}
      onClick={() => add(kind)}
    />
  );

  return (
    <div ref={wrap} className="nb-add-wrap">
      <div
        ref={surface}
        className="nb-add-surface"
        role="group"
        aria-label={t("notebookInsert.addCodeCell")}
        title={disabled ? disabledReason : undefined}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.repeat ||
            !event.currentTarget.contains(event.target as Node)
          )
            return;
          if (event.key === "Escape" && onClose) {
            event.stopPropagation();
            onClose();
          } else if (
            gap &&
            !disabled &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey
          ) {
            const choice = commands.find(
              ({ key }) => key === notebookLetter(event),
            );
            if (!choice) return;
            event.preventDefault();
            event.stopPropagation();
            add(choice.kind);
          }
        }}
      >
        {first.map(tile)}
        {prose &&
          (textChoices.length > 1 ? (
            <TextCellTile
              choice={prose}
              choices={textChoices}
              disabled={disabled}
              gap={gap}
              onAdd={add}
              onClose={onClose}
              hoverId="text"
              hoverClosers={hoverClosers.current}
            />
          ) : (
            tile(prose)
          ))}
        {visual.slice(0, visualCount).map(tile)}
        {inputs.length > 0 && !inputsInMore && (
          <MoreCellsMenu
            entries={inputs}
            renderLabel={renderInput}
            header={inputsHeader}
            label={inputsHeader.title}
            align="center"
            disabled={disabled}
            onPick={onPick}
            onClose={onClose}
            hoverId="inputs"
            hoverClosers={hoverClosers.current}
            trigger={
              <AddCellButton
                disabled={disabled}
                icon={<IconForms size={24} aria-hidden="true" />}
                label={t("notebookInsert.inputs")}
                expandable
              />
            }
          />
        )}
        {data && !dataInMore && (
          <AddCellButton
            disabled={disabled}
            icon={<IconDatabase size={24} aria-hidden="true" />}
            label={t("notebookInsert.data")}
            onClick={() => pickTool(data)}
          />
        )}
        <MoreCellsMenu
          entries={overflow.map(({ kind, labelKey }) => ({
            kind,
            name: t(labelKey),
          }))}
          shortcut={
            gap
              ? (entry) => overflow.find(({ kind }) => kind === entry.kind)?.key
              : undefined
          }
          disabled={disabled || !moreAvailable}
          onPick={(entry) => add(entry.kind)}
          onClose={onClose}
          hoverId="more"
          hoverClosers={hoverClosers.current}
          label={t("notebookInsert.more")}
          trigger={
            <AddCellButton
              disabled={disabled || !moreAvailable}
              icon={<IconDots size={24} aria-hidden="true" />}
              label={t("notebookInsert.more")}
              title={gap ? t("notebook.inlineInsert.viewAll") : undefined}
            />
          }
        >
          {component && (
            <DropdownMenuItem onSelect={() => pickTool(component)}>
              {t("notebookInsert.component")}
            </DropdownMenuItem>
          )}
          {semanticLayer && (
            <DropdownMenuItem onSelect={() => add("dbt-metric")}>
              {cellKindDefinition("dbt-metric").name}
            </DropdownMenuItem>
          )}
          {section && (
            <DropdownMenuItem onSelect={() => add("collapsible")}>
              {t("notebook.section.name")}
            </DropdownMenuItem>
          )}
          {inputsInMore && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {inputsHeader.title}
              </DropdownMenuSubTrigger>
              <MoreMenuSubContent>
                <AddMenuHeading {...inputsHeader} />
                {inputs.map((entry) => (
                  <DropdownMenuItem
                    key={entry.inputType}
                    onSelect={() => onPick(entry)}
                  >
                    {renderInput(entry)}
                  </DropdownMenuItem>
                ))}
              </MoreMenuSubContent>
            </DropdownMenuSub>
          )}
          {dataInMore && (
            <DropdownMenuItem onSelect={() => pickTool(dataInMore)}>
              {t("notebookInsert.data")}
            </DropdownMenuItem>
          )}
        </MoreCellsMenu>
        {onClose != null && (
          <button
            type="button"
            className="nb-icon-button nb-add-close"
            aria-label={t("notebookInsert.close")}
            onClick={onClose}
          >
            <IconX size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

function AddCellButton({
  icon,
  label,
  shortcut,
  expandable,
  ...buttonProps
}: ComponentPropsWithRef<"button"> & {
  icon: ReactNode;
  expandable?: boolean;
  label: string;
  shortcut?: string | undefined;
}) {
  return (
    <button type="button" className="nb-add-button" {...buttonProps}>
      {icon}
      <span>{label}</span>
      {expandable && (
        <IconChevronDown
          className="nb-add-chevron"
          size={12}
          aria-hidden="true"
        />
      )}
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

function InlineInsertCellMenu({
  afterCellId,
  disabled,
  disabledReason,
  entries,
  onPick,
  supportedKinds,
}: {
  afterCellId: string;
  disabled: boolean;
  disabledReason?: string | undefined;
  entries: readonly MoreCellEntry[];
  onPick: (entry: MoreCellEntry, afterCellId: string) => void;
  supportedKinds?: readonly CellKind[] | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "inputs" | "more">("root");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const allowedKinds = supportedKinds ?? ADDABLE_CELL_KINDS;
  const {
    commands,
    inputs: inputEntries,
    inputsHeader,
    renderInput,
  } = useAddOptions(entries, allowedKinds);
  const offered = commands.filter(({ kind }) =>
    entries.some((entry) => entry.kind === kind),
  );
  const section =
    allowedKinds.includes("collapsible") &&
    entries.some((entry) => entry.kind === "collapsible");
  const semanticLayer =
    allowedKinds.includes("dbt-metric") &&
    entries.some((entry) => entry.kind === "dbt-metric");
  const inputsAvailable = inputEntries.length > 0;

  useEffect(() => {
    if (view === "more")
      moreRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [view]);

  const close = () => {
    setOpen(false);
    setView("root");
    requestAnimationFrame(() => {
      buttonRef.current?.focus({ preventScroll: true });
    });
  };

  const pickCommand = ({ kind, labelKey }: InsertCommand) => {
    close();
    onPick({ kind, name: t(labelKey) }, afterCellId);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setView("root");
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label={t("notebookInsert.addHere")}
          title={disabled ? disabledReason : t("notebookInsert.addCell")}
          disabled={disabled}
          className="nb-insert-button mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--ws-border)] text-[var(--ws-muted)] transition-colors hover:border-[var(--ws-fg)] hover:text-[var(--ws-fg)] disabled:opacity-40"
        >
          <IconPlus size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        {view === "inputs" && inputsAvailable ? (
          <div
            className="nb-more-menu"
            role="menu"
            aria-label={t("notebookInsert.inputs")}
          >
            <div className="nb-more-menu-header">
              <h5 className="nb-more-menu-title">{inputsHeader.title}</h5>
              <div className="nb-more-menu-description">
                {inputsHeader.description}
              </div>
            </div>
            {inputEntries.map((entry) => (
              <button
                key={`${entry.kind}:${entry.inputType ?? ""}`}
                type="button"
                role="menuitem"
                className="nb-more-menu-item"
                disabled={disabled}
                onClick={() => {
                  close();
                  onPick(entry, afterCellId);
                }}
              >
                {renderInput(entry)}
              </button>
            ))}
          </div>
        ) : view === "more" ? (
          <div
            ref={moreRef}
            className="nb-more-menu"
            role="menu"
            aria-label={t("notebookInsert.more")}
            onKeyDown={(event) => {
              if (
                disabled ||
                event.defaultPrevented ||
                event.nativeEvent.isComposing ||
                event.repeat ||
                event.altKey ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey
              )
                return;
              const command = offered.find(
                ({ key }) => key === notebookLetter(event),
              );
              if (!command) return;
              event.preventDefault();
              event.stopPropagation();
              pickCommand(command);
            }}
          >
            {offered.map((command) => (
              <button
                key={command.kind}
                type="button"
                role="menuitem"
                className="nb-more-menu-item"
                aria-label={t(command.labelKey)}
                aria-keyshortcuts={command.key}
                disabled={disabled}
                onClick={() => pickCommand(command)}
              >
                {t(command.labelKey)}
                <kbd aria-hidden="true">{command.key}</kbd>
              </button>
            ))}
            {semanticLayer && (
              <button
                type="button"
                role="menuitem"
                className="nb-more-menu-item"
                disabled={disabled}
                onClick={() => {
                  close();
                  onPick(
                    {
                      kind: "dbt-metric",
                      name: cellKindDefinition("dbt-metric").name,
                    },
                    afterCellId,
                  );
                }}
              >
                {cellKindDefinition("dbt-metric").name}
              </button>
            )}
            {section && (
              <button
                type="button"
                role="menuitem"
                className="nb-more-menu-item"
                disabled={disabled}
                onClick={() => {
                  close();
                  onPick(
                    { kind: "collapsible", name: t("notebook.section.name") },
                    afterCellId,
                  );
                }}
              >
                {t("notebook.section.name")}
              </button>
            )}
          </div>
        ) : (
          <div className="nb-inline-add" role="menu">
            <button
              type="button"
              role="menuitem"
              className="nb-inline-add-button"
              disabled={disabled || !inputsAvailable}
              onClick={() => setView("inputs")}
            >
              <IconForms size={16} aria-hidden="true" />
              {t("notebook.inlineInsert.inputs")}
              <IconChevronDown size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              role="menuitem"
              className="nb-inline-add-button"
              title={t("notebook.inlineInsert.viewAll")}
              disabled={
                disabled || (!section && !semanticLayer && offered.length === 0)
              }
              onClick={() => setView("more")}
            >
              <IconDots size={16} aria-hidden="true" />
              {t("notebook.inlineInsert.more")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function InsertCellBar({
  afterCellId,
  vertical = false,
  disabled = false,
  disabledReason,
  onAdd,
  onPick,
  entries,
  supportedKinds,
  textKind,
  onTextKindChange,
  tools,
  expanded,
  onExpandedChange,
}: TextPreference & {
  afterCellId: string;
  vertical?: boolean;
  disabled?: boolean;
  disabledReason?: string | undefined;
  onAdd: (kind: CellKind, afterCellId: string) => void;
  onPick: (entry: MoreCellEntry, afterCellId: string) => void;
  entries: readonly MoreCellEntry[];
  supportedKinds?: readonly CellKind[] | undefined;
  tools?: AddTools | undefined;
  expanded?: boolean | undefined;
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
}) {
  const t = useT();
  const [localOpen, setLocalOpen] = useState(false);
  const open = expanded ?? localOpen;
  const setOpen = onExpandedChange ?? setLocalOpen;
  const [focused, setFocused] = useState(false);
  const insertButtonRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => {
      insertButtonRef.current?.focus({ preventScroll: true });
    });
  };

  if (vertical && !open) {
    return (
      <InlineInsertCellMenu
        afterCellId={afterCellId}
        disabled={disabled}
        disabledReason={disabledReason}
        entries={entries}
        onPick={onPick}
        supportedKinds={supportedKinds}
      />
    );
  }

  return (
    <div className={`nb-insert${open ? " is-open" : ""}`}>
      {open ? (
        <AddCellBar
          autoFocus
          gap
          textKind={textKind}
          onTextKindChange={onTextKindChange}
          tools={tools}
          disabled={disabled}
          disabledReason={disabledReason}
          onAdd={(kind) => {
            setOpen(false);
            onAdd(kind, afterCellId);
          }}
          onClose={close}
          entries={entries}
          onPick={(entry) => {
            setOpen(false);
            onPick(entry, afterCellId);
          }}
          supportedKinds={supportedKinds}
        />
      ) : (
        <Tooltip
          delayMs={250}
          placement="top"
          content={
            focused
              ? t("notebookInsert.addCell") + " " + notebookCommands.insert.key
              : t("notebookInsert.addCell")
          }
          trigger={
            <button
              ref={insertButtonRef}
              type="button"
              className="nb-insert-button"
              aria-label={t("notebookInsert.addHere")}
              aria-keyshortcuts="Alt+A"
              title={disabled ? disabledReason : undefined}
              disabled={disabled}
              onFocus={(event) =>
                setFocused(event.currentTarget.matches(":focus-visible"))
              }
              onBlur={() => setFocused(false)}
              onClick={() => setOpen(true)}
            >
              <IconPlus size={14} aria-hidden="true" />
            </button>
          }
        />
      )}
    </div>
  );
}
