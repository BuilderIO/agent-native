import { IconPaperclip, IconPlus } from "@tabler/icons-react";
import {
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";

import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { formatAttachmentError } from "./attachment-accept.js";
import {
  ComposerContextPicker,
  type ComposerContextPickerConfig,
} from "./ComposerContextPicker.js";
import { ComposerContextPickerDialog } from "./ComposerContextPickerDialog.js";
import { COMPOSER_POPOVER_SURFACE_CLASS } from "./popover-surface.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import { useComposerPanelPlacement } from "./use-composer-panel-placement.js";

export {
  ComposerContextSearchInput,
  type ComposerContextSearchInputProps,
} from "./ComposerContextSearchInput.js";
export type {
  ComposerContextPickerConfig,
  ComposerContextPickerItem,
  ComposerContextPickerRequest,
  ComposerContextPickerResult,
  ComposerContextPickerSelection,
  ComposerContextPickerFooterAction,
} from "./ComposerContextPicker.js";

interface ComposerContextMenuEntry {
  id: string;
  label: string;
  description?: string;
  intent?: "add-context" | "invoke-integration";
  order?: number;
  section?: "context" | "integrations" | "commands";
  referenceType?: string;
  referencePicker?: { referenceType: string; source: string };
  keywords?: readonly string[];
  icon?: ReactNode;
  disabled?: boolean;
  opensDialog?: boolean;
}
export type ComposerContextMenuAction = ComposerContextMenuEntry & {
  checked?: boolean;
  onDismiss?: () => void;
  children?: never;
} & (
    | {
        picker: ComposerContextPickerConfig;
        referencePicker?: never;
        render?: never;
        onSelect?: never;
        renderLink?: never;
      }
    | {
        referencePicker: { referenceType: string; source: string };
        picker?: never;
        render?: never;
        onSelect?: never;
        renderLink?: never;
      }
    | {
        renderLink: (children: ReactNode) => ReactElement;
        referencePicker?: never;
        picker?: never;
        render?: never;
        onSelect?: never;
      }
    | {
        onSelect: () => void | Promise<void>;
        referencePicker?: never;
        render?: (controls: ComposerContextPageControls) => ReactNode;
        picker?: never;
        renderLink?: never;
      }
  );
export interface ComposerContextPageControls {
  onBack(): void;
  onClose(options?: { restoreFocus?: boolean }): void;
  onResume(): void;
}
export interface ComposerContextMenuCategory extends ComposerContextMenuEntry {
  referencePicker?: never;
  children: readonly ComposerContextMenuItem[];
  searchPlaceholder?: string;
  onSelect?: never;
  picker?: never;
  render?: never;
}
export type ComposerContextMenuItem =
  | ComposerContextMenuAction
  | ComposerContextMenuCategory;
export interface ComposerContextMenuProps {
  items: readonly ComposerContextMenuItem[];
  integrationStatus?: {
    scopeKey?: string;
    loading?: boolean;
    error?: string;
    onRetry?: () => void | Promise<unknown>;
  };
  menuActionItems?: readonly ComposerContextMenuItem[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  addAttachment?: (file: File) => Promise<unknown>;
  onAttachmentRequest?: () => void;
  attachmentAccept?: string;
  onAttachmentError?: (message: string) => void;
  onDisabledFocus?: () => void;
  onRestoreFocus?: () => void;
  contextButtonTooltipDisabled?: boolean;
  disabled?: boolean;
  /** Runs this action or opens its picker as a dialog; each new object is a new request. */
  openEntry?: { id: string } | null;
}
interface ComposerContextPage {
  id: string;
  origin: string[];
  onDismiss?: () => void;
}
interface ComposerContextDialogSession {
  id: string;
  scopeKey?: string;
}

// Without a dialog presentation a picker selects one item through onSelect,
// which the dialog's single-select mode does too.
function asDialogPicker(
  picker: ComposerContextPickerConfig,
): ComposerContextPickerConfig {
  return typeof picker.presentation === "object"
    ? picker
    : ({
        ...picker,
        presentation: { type: "dialog", mode: "single" },
      } as ComposerContextPickerConfig);
}

function findAction(
  items: readonly ComposerContextMenuItem[],
  id: string,
  inheritedDisabled = false,
): ComposerContextMenuAction | undefined {
  for (const item of items) {
    const disabled = inheritedDisabled || item.disabled === true;
    if (item.children) {
      const match = findAction(item.children, id, disabled);
      if (match) return match;
    } else if (item.id === id)
      return disabled ? { ...item, disabled: true } : item;
  }
}

export interface ComposerContextActionMatch {
  action: ComposerContextMenuAction;
  /** Category ids from the searched items down to the action. */
  path: string[];
  /** Labels of those categories, outermost first. */
  categories: string[];
}

/** Every action under `items` that matches `query`; an empty query matches all. */
export function searchComposerContextActions(
  items: readonly ComposerContextMenuItem[],
  query: string,
): ComposerContextActionMatch[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches: ComposerContextActionMatch[] = [];
  const visit = (
    entries: readonly ComposerContextMenuItem[],
    path: string[],
    categories: string[],
    searchable: string[],
    disabled: boolean,
  ) => {
    for (const entry of entries) {
      const text = [
        ...searchable,
        entry.label,
        entry.description ?? "",
        ...(entry.keywords ?? []),
      ];
      const entryDisabled = disabled || entry.disabled === true;
      if (entry.children)
        visit(
          entry.children,
          [...path, entry.id],
          [...categories, entry.label],
          text,
          entryDisabled,
        );
      else if (
        terms.every((term) => text.join(" ").toLocaleLowerCase().includes(term))
      )
        matches.push({
          action: entryDisabled ? { ...entry, disabled: true } : entry,
          path,
          categories,
        });
    }
  };
  visit(items, [], [], [], false);
  return matches;
}

export function getComposerContextMenuEntries(
  items: readonly ComposerContextMenuItem[],
  path: readonly string[],
  query: string,
): ComposerContextMenuItem[] {
  let scope = items;
  for (const id of path) {
    const category = scope.find((item) => item.id === id);
    if (!category?.children || category.disabled) return [];
    scope = category.children;
  }
  if (!query.trim()) return [...scope];
  return searchComposerContextActions(scope, query).map(({ action }) => action);
}

function ContextSubmenu({
  label,
  icon,
  disabled,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean, reason?: "escape") => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenuSub open={open} onOpenChange={onOpenChange}>
      <DropdownMenuSubTrigger ref={trigger} disabled={disabled}>
        {icon && (
          <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        style={{ boxShadow: "none" }}
        className={`max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 max-w-[calc(100vw-24px)] overflow-y-auto data-[state=open]:fade-in-100 data-[state=closed]:fade-out-100 ${COMPOSER_POPOVER_SURFACE_CLASS}`}
        data-agent-native-composer-popover="true"
        onFocusOutside={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLElement &&
            target.closest('[data-agent-native-composer-popover="true"]') &&
            target.matches(
              '[role="menu"], [aria-haspopup="menu"][aria-expanded="true"]',
            )
          ) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false, "escape");
          trigger.current?.focus();
        }}
      >
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function LegacyContextPage({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const input = element.current?.querySelector<HTMLElement>(
        "[data-autofocus], [cmdk-input], input:not([type=hidden]):not(:disabled), textarea:not(:disabled)",
      );
      input?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={element}>{children}</div>;
}

function ContextEntryLabel({
  label,
  description,
  icon,
}: ComposerContextMenuEntry) {
  return (
    <>
      {icon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:gap-2">
        <span
          className={
            description
              ? "min-w-0 truncate @md:max-w-[60%] @md:shrink-0"
              : "min-w-0 truncate"
          }
        >
          {label}
        </span>
        {description && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </>
  );
}

export function ComposerContextMenu({
  items,
  menuActionItems = [],
  integrationStatus,
  loading,
  error: searchError,
  onRetry,
  open: controlledOpen,
  onOpenChange,
  addAttachment,
  onAttachmentRequest,
  attachmentAccept,
  onAttachmentError,
  onDisabledFocus,
  onRestoreFocus,
  contextButtonTooltipDisabled = false,
  disabled,
  openEntry,
}: ComposerContextMenuProps) {
  const t = useComposerRuntimeAdapters().translate!;
  const sectionId = useId();
  const sortEntries = (entries: readonly ComposerContextMenuItem[]) =>
    [...entries].sort(
      (left, right) =>
        (left.order ?? 100) - (right.order ?? 100) ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    );
  const seen = new Set<string>();
  const sections: Record<
    "context" | "integrations" | "commands",
    ComposerContextMenuItem[]
  > = { context: [], integrations: [], commands: [] };
  const collect = (
    entries: readonly ComposerContextMenuItem[],
    inherited?: "context" | "integrations" | "commands",
    inheritedDisabled = false,
  ) => {
    const retained: ComposerContextMenuItem[] = [];
    for (const item of entries) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const section =
        item.section ??
        (item.intent === "invoke-integration"
          ? "integrations"
          : (inherited ?? "context"));
      const entry = inheritedDisabled ? { ...item, disabled: true } : item;
      if (item.children && !item.section && !item.intent) {
        const children = collect(
          item.children,
          section,
          inheritedDisabled || item.disabled === true,
        );
        if (children.length)
          retained.push({
            ...item,
            ...(inheritedDisabled ? { disabled: true } : {}),
            children,
          });
      } else if (section !== (inherited ?? "context"))
        sections[section].push(entry);
      else retained.push(entry);
    }
    return retained;
  };
  sections.context.push(...collect(items));
  sections.commands.push(...collect(menuActionItems, "commands"));
  const hasIntegrations = Boolean(
    sections.integrations.length ||
    integrationStatus?.loading ||
    integrationStatus?.error,
  );
  const hasAttachments = Boolean(
    sections.context.length ||
    addAttachment ||
    onAttachmentRequest ||
    loading ||
    searchError,
  );
  const allItems = [...menuActionItems, ...items];
  const onDisabledFocusRef = useRef(onDisabledFocus);
  onDisabledFocusRef.current = onDisabledFocus;
  const disabledFocusFrame = useRef<number | null>(null);
  const resumedPageClose = useRef<string | null>(null);
  const resumedPageCloseFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (disabledFocusFrame.current !== null)
        window.cancelAnimationFrame(disabledFocusFrame.current);
      if (resumedPageCloseFrame.current !== null)
        window.cancelAnimationFrame(resumedPageCloseFrame.current);
    },
    [],
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [triggerTooltipOpen, setTriggerTooltipOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const pathRef = useRef(path);
  const [page, setPage] = useState<ComposerContextPage | null>(null);
  const pageRef = useRef(page);
  const itemsRef = useRef(allItems);
  itemsRef.current = allItems;
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const placement = useComposerPanelPlacement(triggerRef, open);
  const pendingDialog = useRef<ComposerContextDialogSession | null>(null);
  const pendingAttachmentRequest = useRef(false);
  const [dialog, setDialog] = useState<ComposerContextDialogSession | null>(
    null,
  );
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const dialogAction = dialog ? findAction(allItems, dialog.id) : undefined;
  const dialogAvailable =
    !dialogAction?.disabled &&
    dialogAction?.picker &&
    dialogAction.picker.scopeKey === dialog?.scopeKey;
  useEffect(() => {
    if (dialog && !dialogAvailable && !disabled) {
      dialogRef.current = null;
      setDialog(null);
    }
  }, [dialog, dialogAvailable, disabled]);
  useEffect(() => {
    if (contextButtonTooltipDisabled) setTriggerTooltipOpen(false);
  }, [contextButtonTooltipDisabled]);
  const restoreFocusOnClose = useRef(true);
  const label = t("agentChat.composer.addContext", {
    defaultValue: "Add context",
  });
  const uploadLabel = t("agentChat.composer.menu.uploadFile", {
    defaultValue: "Files and images",
  });
  const reportError = useCallback(
    (cause: unknown) => {
      const message = formatAttachmentError(
        cause,
        t("agentChat.composer.contextActionFailed", {
          defaultValue: "Could not add context.",
        }),
      );
      setError(message);
      onAttachmentError?.(message);
    },
    [t, onAttachmentError],
  );
  const dismissPage = useCallback(() => {
    const current = pageRef.current;
    pageRef.current = null;
    setPage(null);
    if (!current) return;
    try {
      (
        findAction(itemsRef.current, current.id)?.onDismiss ?? current.onDismiss
      )?.();
    } catch (cause) {
      reportError(cause);
    }
  }, [reportError]);
  const updatePath = useCallback((next: string[]) => {
    pathRef.current = next;
    setPath(next);
  }, []);
  const changeOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) {
        dismissPage();
        updatePath([]);
      }
    },
    [controlledOpen, dismissPage, onOpenChange, updatePath],
  );
  useEffect(() => {
    if (!disabled) return;
    pendingDialog.current = null;
    if (open) {
      restoreFocusOnClose.current = false;
      changeOpen(false);
    }
    const closingDialog = dialogRef.current;
    if (!closingDialog) return;
    dialogRef.current = null;
    setDialog(null);
    try {
      findAction(itemsRef.current, closingDialog.id)?.onDismiss?.();
    } catch (cause) {
      reportError(cause);
    }
    disabledFocusFrame.current = window.requestAnimationFrame(() => {
      disabledFocusFrame.current = null;
      onDisabledFocusRef.current?.();
    });
  }, [disabled, open, changeOpen, reportError]);
  const selectAction = (action: ComposerContextMenuAction) => {
    setError(null);
    try {
      void Promise.resolve(action.onSelect?.()).catch(reportError);
    } catch (cause) {
      reportError(cause);
    }
  };
  const activate = (
    action: ComposerContextMenuAction,
    origin: string[],
    select = true,
  ) => {
    dismissPage();
    const next = { id: action.id, origin, onDismiss: action.onDismiss };
    pageRef.current = next;
    setPage(next);
    updatePath([...origin, action.id]);
    if (select && !action.picker) selectAction(action);
  };
  const openRequestedEntry = (id: string) => {
    if (disabled) return;
    const action = findAction(allItems, id);
    if (!action || action.disabled || action.render) {
      reportError(
        new Error(
          t("agentChat.composer.contextActionFailed", {
            defaultValue: "Could not add context.",
          }),
        ),
      );
      return;
    }
    setError(null);
    if (!action.picker) {
      selectAction(action);
      return;
    }
    // A request starts outside the menu, so its picker opens as a dialog: a
    // submenu opened programmatically loses focus to its parents and closes.
    const session = { id: action.id, scopeKey: action.picker.scopeKey };
    dialogRef.current = session;
    setDialog(session);
  };
  const openRequestedEntryRef = useRef(openRequestedEntry);
  openRequestedEntryRef.current = openRequestedEntry;
  useEffect(() => {
    if (openEntry) openRequestedEntryRef.current(openEntry.id);
  }, [openEntry]);
  const currentAction = page ? findAction(allItems, page.id) : undefined;
  useEffect(() => {
    if (
      page &&
      (currentAction?.disabled ||
        (!currentAction?.render && !currentAction?.picker))
    ) {
      dismissPage();
      updatePath(page.origin);
    }
  }, [page, currentAction, dismissPage, updatePath]);

  const renderEntries = (
    entries: readonly ComposerContextMenuItem[],
    origin: string[],
  ): ReactNode => (
    <>
      {sortEntries(entries).map((entry) => {
        const branch = [...origin, entry.id];
        const expanded = branch.every((id, index) => path[index] === id);
        if (entry.children) {
          return (
            <ContextSubmenu
              key={entry.id}
              label={entry.label}
              icon={entry.icon}
              disabled={entry.disabled}
              open={expanded}
              onOpenChange={(next, reason) => {
                if (
                  !next &&
                  reason !== "escape" &&
                  resumedPageClose.current &&
                  pathRef.current.includes(resumedPageClose.current)
                )
                  return;
                const isOpen = branch.every(
                  (id, index) => pathRef.current[index] === id,
                );
                if (next === isOpen) return;
                if (!next) {
                  dismissPage();
                  updatePath(origin);
                  return;
                }
                setError(null);
                updatePath(branch);
              }}
            >
              {renderEntries(entry.children, branch)}
            </ContextSubmenu>
          );
        }
        if (entry.picker && typeof entry.picker.presentation === "object") {
          return (
            <DropdownMenuItem
              key={entry.id}
              disabled={entry.disabled}
              onSelect={() => {
                pendingDialog.current = {
                  id: entry.id,
                  scopeKey: entry.picker?.scopeKey,
                };
                changeOpen(false);
              }}
            >
              <ContextEntryLabel {...entry} />
            </DropdownMenuItem>
          );
        }
        if (entry.picker || entry.render) {
          const back = () => {
            dismissPage();
            updatePath(origin);
          };
          const activePage = page;
          return (
            <ContextSubmenu
              key={entry.id}
              label={entry.label}
              icon={entry.icon}
              disabled={entry.disabled}
              open={expanded}
              onOpenChange={(next, reason) => {
                if (
                  !next &&
                  reason !== "escape" &&
                  resumedPageClose.current === entry.id
                ) {
                  resumedPageClose.current = null;
                  if (resumedPageCloseFrame.current !== null) {
                    window.cancelAnimationFrame(resumedPageCloseFrame.current);
                    resumedPageCloseFrame.current = null;
                  }
                  return;
                }
                const isOpen = branch.every(
                  (id, index) => pathRef.current[index] === id,
                );
                if (next === isOpen) return;
                if (!next) {
                  back();
                  return;
                }
                setError(null);
                activate(entry, origin);
              }}
            >
              {entry.picker ? (
                <ComposerContextPicker
                  key={JSON.stringify([entry.id, entry.picker.scopeKey])}
                  config={entry.picker}
                  onClose={() => {
                    if (pageRef.current === activePage) changeOpen(false);
                  }}
                />
              ) : entry.render && expanded ? (
                <LegacyContextPage>
                  {entry.render({
                    onBack: back,
                    onClose: (options) => {
                      if (pageRef.current !== activePage) return;
                      restoreFocusOnClose.current =
                        options?.restoreFocus !== false;
                      changeOpen(false);
                    },
                    onResume: () => {
                      const action = findAction(itemsRef.current, entry.id);
                      if (!action?.render || action.disabled) {
                        reportError(
                          new Error(
                            t("agentChat.composer.contextActionFailed", {
                              defaultValue: "Could not add context.",
                            }),
                          ),
                        );
                        return;
                      }
                      resumedPageClose.current = entry.id;
                      if (resumedPageCloseFrame.current !== null)
                        window.cancelAnimationFrame(
                          resumedPageCloseFrame.current,
                        );
                      resumedPageCloseFrame.current =
                        window.requestAnimationFrame(() => {
                          resumedPageCloseFrame.current = null;
                          if (resumedPageClose.current === entry.id)
                            resumedPageClose.current = null;
                        });
                      triggerRef.current?.focus();
                      changeOpen(true);
                      activate(action, origin, false);
                    },
                  })}
                </LegacyContextPage>
              ) : null}
            </ContextSubmenu>
          );
        }
        if (entry.renderLink) {
          return (
            <DropdownMenuItem
              key={entry.id}
              asChild
              disabled={entry.disabled === true}
            >
              {entry.renderLink(<ContextEntryLabel {...entry} />)}
            </DropdownMenuItem>
          );
        }
        if (entry.checked !== undefined) {
          return (
            <DropdownMenuCheckboxItem
              key={entry.id}
              checked={entry.checked}
              disabled={entry.disabled}
              onSelect={(event) => {
                event.preventDefault();
                selectAction(entry);
              }}
            >
              <ContextEntryLabel {...entry} />
            </DropdownMenuCheckboxItem>
          );
        }
        return (
          <DropdownMenuItem
            key={entry.id}
            disabled={entry.disabled}
            onSelect={() => {
              if (entry.opensDialog) restoreFocusOnClose.current = false;
              changeOpen(false);
              selectAction(entry);
            }}
          >
            <ContextEntryLabel {...entry} />
          </DropdownMenuItem>
        );
      })}
    </>
  );

  return (
    <>
      {addAttachment && (
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            setError(null);
            void Promise.all(
              files.map((file) =>
                Promise.resolve().then(() => addAttachment(file)),
              ),
            ).catch(reportError);
          }}
        />
      )}
      <DropdownMenu
        open={open}
        onOpenChange={changeOpen}
        dir={placement.direction}
      >
        <Tooltip
          open={triggerTooltipOpen && !contextButtonTooltipDisabled}
          onOpenChange={setTriggerTooltipOpen}
        >
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                variant="ghost"
                size="icon"
                className="size-[var(--agentkit-composer-toolbar-control-size,1.5rem)] shrink-0 rounded-[var(--agentkit-composer-control-radius,var(--radius-md))] text-muted-foreground hover:text-foreground"
                data-agent-composer-slot="plus-button"
                disabled={disabled}
                aria-label={label}
                onClick={(event) => event.stopPropagation()}
              >
                <IconPlus />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          side={placement.side}
          sideOffset={placement.sideOffset}
          alignOffset={placement.alignOffset}
          collisionPadding={12}
          style={{
            maxHeight: placement.maxHeight,
            boxShadow: "none",
          }}
          className={`@container [&_[role^=menuitem]]:min-h-8 flex w-64 max-w-[calc(100vw-24px)] flex-col overflow-y-auto p-1 data-[state=open]:fade-in-100 data-[state=closed]:fade-out-100 ${COMPOSER_POPOVER_SURFACE_CLASS}`}
          data-agent-native-composer-popover="true"
          onCloseAutoFocus={(event) => {
            if (pendingDialog.current) {
              event.preventDefault();
              setDialog(pendingDialog.current);
              pendingDialog.current = null;
              return;
            }
            // Wait for the exit animation: the storage popover anchors to the
            // focused element, and focus moving here would dismiss it.
            if (pendingAttachmentRequest.current) {
              event.preventDefault();
              pendingAttachmentRequest.current = false;
              restoreFocusOnClose.current = true;
              triggerRef.current?.focus();
              onAttachmentRequest?.();
              return;
            }
            if (!restoreFocusOnClose.current) event.preventDefault();
            else if (onRestoreFocus) {
              event.preventDefault();
              onRestoreFocus();
            }
            restoreFocusOnClose.current = true;
          }}
        >
          <div className="contents">
            {hasAttachments && (
              <DropdownMenuGroup
                aria-labelledby={`${sectionId}-context`}
                aria-busy={loading || undefined}
              >
                <DropdownMenuLabel id={`${sectionId}-context`}>
                  {t("agentChat.composer.menu.attachToMessage", {
                    defaultValue: "Add context",
                  })}
                </DropdownMenuLabel>
                {(addAttachment || onAttachmentRequest) && (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (onAttachmentRequest) {
                        pendingAttachmentRequest.current = true;
                        changeOpen(false);
                      } else {
                        changeOpen(false);
                        inputRef.current?.click();
                      }
                    }}
                  >
                    <IconPaperclip aria-hidden="true" />
                    {uploadLabel}
                  </DropdownMenuItem>
                )}
                {renderEntries(sections.context, [])}
                <div
                  role="presentation"
                  aria-hidden="true"
                  className={
                    loading
                      ? "px-2 py-1 text-xs text-muted-foreground"
                      : "sr-only"
                  }
                >
                  {loading
                    ? t("agentChat.composer.contextPending", {
                        defaultValue: "Loading context…",
                      })
                    : ""}
                </div>
                {searchError && (
                  <div
                    role="presentation"
                    aria-hidden="true"
                    className="px-2 py-1 text-sm text-destructive"
                  >
                    {searchError}
                  </div>
                )}
                {searchError && onRetry && (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      try {
                        void Promise.resolve(onRetry()).catch(reportError);
                      } catch (cause) {
                        reportError(cause);
                      }
                    }}
                  >
                    {t("agentChat.common.retry", { defaultValue: "Retry" })}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            )}
            {hasIntegrations && (
              <>
                {hasAttachments && <DropdownMenuSeparator />}
                <DropdownMenuGroup
                  aria-labelledby={`${sectionId}-integrations`}
                  aria-busy={integrationStatus?.loading || undefined}
                >
                  <DropdownMenuLabel id={`${sectionId}-integrations`}>
                    {t("agentChat.composer.menu.integrations", {
                      defaultValue: "Integrations",
                    })}
                  </DropdownMenuLabel>
                  {renderEntries(sections.integrations, [])}
                  {integrationStatus?.loading && (
                    <div
                      role="presentation"
                      aria-hidden="true"
                      className="px-2 py-1 text-xs text-muted-foreground"
                    >
                      {t("agentChat.common.loading", {
                        defaultValue: "Loading...",
                      })}
                    </div>
                  )}
                  {integrationStatus?.error && (
                    <div
                      role="presentation"
                      aria-hidden="true"
                      className="px-2 py-1 text-sm text-destructive"
                    >
                      {integrationStatus.error}
                    </div>
                  )}
                  {integrationStatus?.error && integrationStatus.onRetry && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        try {
                          void Promise.resolve(
                            integrationStatus.onRetry?.(),
                          ).catch(reportError);
                        } catch (cause) {
                          reportError(cause);
                        }
                      }}
                    >
                      {t("agentChat.common.retry", { defaultValue: "Retry" })}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </>
            )}
            {sections.commands.length > 0 && (
              <>
                {(hasAttachments || hasIntegrations) && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuGroup aria-labelledby={`${sectionId}-commands`}>
                  <DropdownMenuLabel id={`${sectionId}-commands`}>
                    {t("agentChat.composer.menu.commands", {
                      defaultValue: "Commands",
                    })}
                  </DropdownMenuLabel>
                  {renderEntries(sections.commands, [])}
                </DropdownMenuGroup>
              </>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <div role="status" aria-live="polite" className="sr-only">
        {open && (loading || integrationStatus?.loading)
          ? t("agentChat.common.loading", { defaultValue: "Loading..." })
          : ""}
      </div>
      {open && (searchError || integrationStatus?.error) && (
        <div role="alert" className="sr-only">
          {searchError ?? integrationStatus?.error}
        </div>
      )}
      {dialog && dialogAvailable && dialogAction?.picker && (
        <ComposerContextPickerDialog
          key={JSON.stringify([dialog.id, dialogAction.picker.scopeKey])}
          title={dialogAction.label}
          config={asDialogPicker(dialogAction.picker)}
          onClose={() => {
            if (dialogRef.current !== dialog) return;
            dialogRef.current = null;
            setDialog(null);
            try {
              dialogAction.onDismiss?.();
            } catch (cause) {
              reportError(cause);
            }
          }}
          onRestoreFocus={() => {
            if (dialogRef.current) return;
            if (!disabled) {
              if (onRestoreFocus) onRestoreFocus();
              else triggerRef.current?.focus();
            }
          }}
        />
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
