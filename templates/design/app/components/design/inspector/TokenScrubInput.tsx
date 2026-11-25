import { useT } from "@agent-native/core/client/i18n";
import type { ScrubInputApi } from "@agent-native/toolkit/design-tweaks";
import type { DesignTokenType } from "@shared/design-token-types";
import { IconChevronDown, IconUnlink } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  designMenuContentClass,
  designMenuItemClass,
  designMenuLabelClass,
} from "@/components/ui/menu-classes";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useDesignTokenSource } from "../edit-panel/design-color-tokens";
import { ScrubInput, type ScrubInputProps } from "./ScrubInput";
import {
  boundTokenVar,
  buildTokenFieldGroups,
  isNumericDraft,
  resolveTokenValue,
  tokenFieldName,
  tokenGroupShowsTier,
  type TokenFieldGroup,
} from "./token-field-options";

export interface TokenFieldExtraItem {
  key: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface TokenFieldExtraGroup {
  key: string;
  label?: string | undefined;
  items: TokenFieldExtraItem[];
  show?: "always" | "empty";
}

export interface TokenFieldBinding {
  accepts: readonly DesignTokenType[];
  authored: string | undefined;
  onBind: (cssVar: string, resolved: string) => void;
  onDetach: (resolved: string | null) => void;
  extraGroups?: TokenFieldExtraGroup[];
}

type Row =
  | { kind: "detach"; id: string }
  | {
      kind: "token";
      id: string;
      cssVar: string;
      name: string;
      value: string;
      resolved: string;
    }
  | { kind: "extra"; id: string; item: TokenFieldExtraItem };

interface Section {
  key: string;
  label?: string | undefined;
  rows: Row[];
}

const TYPE_LABEL_KEY: Partial<Record<DesignTokenType, string>> = {
  color: "designEditor.tokens.types.color",
  "font-family": "designEditor.tokens.types.fontFamily",
  "font-weight": "designEditor.tokens.types.fontWeight",
  "font-size": "designEditor.tokens.types.fontSize",
  "line-height": "designEditor.tokens.types.lineHeight",
  "letter-spacing": "designEditor.tokens.types.letterSpacing",
  spacing: "designEditor.tokens.types.spacing",
  container: "designEditor.tokens.types.container",
  breakpoint: "designEditor.tokens.types.breakpoint",
  radius: "designEditor.tokens.types.radius",
  shadow: "designEditor.tokens.types.shadow",
  opacity: "designEditor.tokens.types.opacity",
};

export interface TokenMenuGroup {
  key: string;
  label: string | undefined;
  options: TokenFieldGroup["options"];
}

export function useTokenFieldMenu(
  binding: Pick<TokenFieldBinding, "accepts" | "authored"> | undefined,
) {
  const t = useT();
  const source = useDesignTokenSource();
  const tokens =
    source?.tokens.status === "ready" ? source.tokens.tokens : undefined;
  const boundVar = binding ? boundTokenVar(binding.authored) : null;
  return useMemo(() => {
    const groups =
      tokens && binding ? buildTokenFieldGroups(tokens, binding.accepts) : [];
    const byVar = new Map((tokens ?? []).map((token) => [token.cssVar, token]));
    const menuGroups: TokenMenuGroup[] = groups.map((group) => ({
      key: `${group.type}:${group.tier}`,
      label: groups.length > 1 ? tokenGroupLabel(t, group, groups) : undefined,
      options: group.options,
    }));
    return {
      request: () => source?.request(),
      status: source?.tokens.status ?? null,
      boundVar,
      boundResolved:
        boundVar && tokens
          ? resolveTokenValue(`var(${boundVar})`, byVar)
          : null,
      groups: menuGroups,
    };
  }, [tokens, binding, boundVar, source, t]);
}

function tokenGroupLabel(
  t: ReturnType<typeof useT>,
  group: TokenFieldGroup,
  groups: readonly TokenFieldGroup[],
): string {
  const key = TYPE_LABEL_KEY[group.type];
  const label = key ? t(key) : group.type;
  return tokenGroupShowsTier(group, groups)
    ? t("designEditor.tokens.field.primitives", { group: label })
    : label;
}

function rowAt(rows: readonly Row[], index: number): Row | undefined {
  return index >= 0 && index < rows.length ? rows[index] : undefined;
}

export function TokenScrubInput({
  tokenBinding,
  chevronClassName,
  showChevron = true,
  ...props
}: ScrubInputProps & {
  tokenBinding?: TokenFieldBinding | undefined;
  chevronClassName?: string | undefined;
  showChevron?: boolean;
}) {
  if (!tokenBinding) return <ScrubInput {...props} />;
  return (
    <TokenCombobox
      {...props}
      binding={tokenBinding}
      chevronClassName={chevronClassName}
      showChevron={showChevron}
    />
  );
}

function TokenCombobox({
  binding,
  chevronClassName,
  showChevron,
  ...props
}: ScrubInputProps & {
  binding: TokenFieldBinding;
  chevronClassName?: string | undefined;
  showChevron: boolean;
}) {
  const t = useT();
  const source = useDesignTokenSource();
  const listId = useId();
  const apiRef = useRef<ScrubInputApi | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const editedRef = useRef(false);
  const refocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const boundVar = props.mixed ? null : boundTokenVar(binding.authored);
  const boundName = boundVar ? tokenFieldName(boundVar) : null;
  const tokens =
    source?.tokens.status === "ready" ? source.tokens.tokens : undefined;
  const boundResolved = useMemo(
    () =>
      boundVar && tokens
        ? resolveTokenValue(
            `var(${boundVar})`,
            new Map(tokens.map((token) => [token.cssVar, token])),
          )
        : null,
    [boundVar, tokens],
  );

  const sections = useMemo<Section[]>(() => {
    const groups: TokenFieldGroup[] = tokens
      ? buildTokenFieldGroups(tokens, binding.accepts, query, props.unit)
      : [];
    const withTokens: Section[] = groups.map((group) => ({
      key: `${group.type}:${group.tier}`,
      label: tokenGroupLabel(t, group, groups),
      rows: group.options.map((option) => ({
        kind: "token" as const,
        id: `${listId}-${option.cssVar}`,
        ...option,
      })),
    }));
    const hasTokens = withTokens.length > 0;
    const extra: Section[] = query
      ? []
      : (binding.extraGroups ?? [])
          .filter((group) => group.show !== "empty" || !hasTokens)
          .map((group) => ({
            key: group.key,
            label: group.label,
            rows: group.items.map((item) => ({
              kind: "extra" as const,
              id: `${listId}-${group.key}-${item.key}`,
              item,
            })),
          }));
    const detach: Section[] =
      boundVar && !query
        ? [
            {
              key: "detach",
              rows: [{ kind: "detach", id: `${listId}-detach` }],
            },
          ]
        : [];
    const labelled = [...withTokens, ...extra];
    const showHeadings = labelled.length > 1;
    return [
      ...detach,
      ...labelled.map((section) =>
        showHeadings ? section : { ...section, label: undefined },
      ),
    ];
  }, [
    tokens,
    binding.accepts,
    props.unit,
    binding.extraGroups,
    query,
    boundVar,
    listId,
    t,
  ]);

  const rows = useMemo(
    () => sections.flatMap((section) => section.rows),
    [sections],
  );
  const activeIndex = rows.length ? Math.min(active, rows.length - 1) : -1;
  const activeRow = rowAt(rows, activeIndex);
  const activeRowId = open ? activeRow?.id : undefined;
  useEffect(() => {
    if (!activeRowId) return;
    document.getElementById(activeRowId)?.scrollIntoView({ block: "nearest" });
  }, [activeRowId]);

  const openList = () => {
    source?.request();
    const current = boundVar
      ? rows.findIndex((row) => row.kind === "token" && row.cssVar === boundVar)
      : -1;
    setActive(current >= 0 ? current : 0);
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    setQuery("");
  };

  const finish = () => {
    apiRef.current?.resetDraft();
    closeList();
    editedRef.current = false;
    apiRef.current?.blur();
  };

  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    apiRef.current?.focus();
  }, [binding.authored]);

  const pick = (index: number) => {
    const row = rowAt(rows, index);
    if (!row) return;
    finish();
    if (row.kind === "detach") {
      refocusRef.current = true;
      binding.onDetach(boundResolved);
    } else if (row.kind === "token") {
      if (row.cssVar === boundVar) {
        apiRef.current?.focus();
        return;
      }
      refocusRef.current = true;
      binding.onBind(row.cssVar, row.resolved);
    } else if (!row.item.disabled) {
      if (row.item.active) {
        apiRef.current?.focus();
        return;
      }
      refocusRef.current = true;
      row.item.onSelect();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey;
    if (!open) {
      if (event.key === "ArrowDown" && plain) {
        event.preventDefault();
        openList();
        return true;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        boundVar &&
        !editedRef.current
      ) {
        event.preventDefault();
        finish();
        refocusRef.current = true;
        binding.onDetach(boundResolved);
        return true;
      }
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return true;
      const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
      setActive((activeIndex + step) % rows.length);
      return true;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      pick(activeIndex);
      return true;
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      boundVar &&
      !editedRef.current
    ) {
      event.preventDefault();
      pick(0);
      return true;
    }
    if (
      event.key === "Escape" ||
      event.key === "Tab" ||
      event.key === "Enter"
    ) {
      closeList();
    }
    return false;
  };

  const handleDraftChange = (draft: string) => {
    editedRef.current = true;
    if (isNumericDraft(draft)) {
      closeList();
      return;
    }
    source?.request();
    setQuery(draft);
    setActive(0);
    setOpen(true);
  };

  const bound = boundName !== null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) closeList();
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          className="min-w-0 w-full"
          onFocusCapture={() => {
            editedRef.current = false;
            source?.request();
          }}
          onBlurCapture={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || !anchorRef.current?.contains(next)) closeList();
          }}
        >
          <ScrubInput
            {...props}
            textValue={bound ? boundName : props.textValue}
            apiRef={apiRef}
            onInputKeyDown={handleKeyDown}
            onDraftChange={handleDraftChange}
            inputAriaProps={{
              role: "combobox",
              "aria-expanded": open,
              "aria-controls": open ? listId : undefined,
              "aria-autocomplete": "list",
              "aria-activedescendant": open ? activeRow?.id : undefined,
            }}
            className={cn(
              props.className,
              "rounded-md focus-within:ring-1 focus-within:ring-[var(--design-editor-accent-color)]",
            )}
            inputClassName={cn(
              props.inputClassName,
              "rounded-r-none border-r-0 focus-visible:ring-0",
              bound && "truncate text-[var(--design-brand-ink)]",
            )}
            trailing={
              showChevron ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("designEditor.tokens.field.open")}
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  disabled={props.disabled}
                  data-token-field-chevron=""
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (open) {
                      closeList();
                      return;
                    }
                    apiRef.current?.focus();
                    openList();
                  }}
                  className={cn(
                    "flex h-6 w-5 shrink-0 items-center justify-center rounded-r-md border border-l-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
                    chevronClassName,
                  )}
                >
                  <IconChevronDown className="size-3" aria-hidden />
                </button>
              ) : null
            }
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        data-design-chrome-region="right-panel"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
        className={cn(
          designMenuContentClass,
          "max-h-[min(var(--radix-popover-content-available-height),360px)] min-w-[200px] w-[var(--radix-popover-trigger-width)] overflow-y-auto",
        )}
      >
        <div
          id={listId}
          role="listbox"
          aria-label={t("designEditor.tokens.field.open")}
        >
          {rows.length === 0 ? (
            <div className={cn(designMenuLabelClass, "text-muted-foreground")}>
              {source?.tokens.status === "loading"
                ? t("designEditor.tokens.field.loading")
                : source?.tokens.status === "error"
                  ? t("editPanel.colorPicker.tokensFailed")
                  : query
                    ? t("designEditor.tokens.noMatches")
                    : t("designEditor.tokens.empty")}
            </div>
          ) : null}
          {sections.map((section, sectionIndex) => (
            <div key={section.key} role="group" aria-label={section.label}>
              {!section.label && sectionIndex > 0 ? (
                <div role="separator" className="-mx-1 my-1 h-px bg-border" />
              ) : null}
              {section.label ? (
                <div
                  role="presentation"
                  className={cn(designMenuLabelClass, "text-muted-foreground")}
                >
                  {section.label}
                </div>
              ) : null}
              {section.rows.map((row) => {
                const index = rows.indexOf(row);
                const highlighted = index === activeIndex;
                const selected =
                  row.kind === "token"
                    ? row.cssVar === boundVar
                    : row.kind === "extra"
                      ? Boolean(row.item.active)
                      : false;
                const disabled = row.kind === "extra" && row.item.disabled;
                return (
                  <div
                    key={row.id}
                    id={row.id}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={disabled || undefined}
                    data-highlighted={highlighted ? "" : undefined}
                    data-token-field-option={
                      row.kind === "token" ? row.name : row.kind
                    }
                    onPointerDown={(event) => {
                      event.preventDefault();
                      if (!disabled) pick(index);
                    }}
                    onPointerMove={() => {
                      if (!highlighted) setActive(index);
                    }}
                    className={cn(
                      designMenuItemClass,
                      "relative flex cursor-default select-none items-center outline-none",
                      disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    {row.kind === "detach" ? (
                      <>
                        <IconUnlink className="size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          {t("designEditor.tokens.field.detach")}
                        </span>
                        <span className="text-muted-foreground">⌫</span>
                      </>
                    ) : row.kind === "token" ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          {row.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {row.value}
                        </span>
                      </>
                    ) : (
                      <>
                        {row.item.icon ? (
                          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                            {row.item.icon}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {row.item.label}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
