/**
 * Tokens inspector panel — §6.2 of DESIGN-STUDIO-PLAN.md.
 *
 * Friendly token names + colour swatches, CSS-var name on the right, type-scale
 * section, radius input, a source chip, and a New token action. Grouped by
 * type: color → typography → spacing → radius → shadow → other.
 *
 * Alpine (Tier-A): edits go through `apply-design-token-edit` which routes
 * through the Tweaks loop (live tweak-values preview + persist in
 * designs.data.tweakSelections). No source file write-back yet.
 *
 * Real app (Tier-B): the write-back advisory from the action surfaces inline
 * as a migration CTA; no additional UI logic is needed here.
 */

import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconBrush,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconCode,
  IconLetterCase,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconRuler,
  IconSpacingVertical,
  IconShadow,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirroring the action shape)
// ---------------------------------------------------------------------------

interface DesignToken {
  name: string;
  cssVar: string;
  value: string;
  type: "color" | "typography" | "spacing" | "radius" | "shadow" | "other";
  source: string;
  isTweakOverride?: boolean;
}

interface TokenGroup {
  type: DesignToken["type"];
  tokens: DesignToken[];
}

interface IndexDesignTokensResult {
  designId: string;
  tokenCount: number;
  groups: TokenGroup[];
  tokens: DesignToken[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TokensPanelProps {
  designId: string;
  /**
   * Called after a token edit is persisted so the parent can push the
   * resolved CSS var map into the iframe via the tweak-values postMessage.
   */
  onTokensApplied?: (resolvedCssVars: Record<string, string>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the value looks like an opaque colour we can render as a swatch. */
function isColorValue(value: string): boolean {
  const v = value.trim();
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^rgba?\(/.test(v) ||
    /^hsla?\(/.test(v) ||
    /^oklch\(/.test(v) ||
    /^color\(/.test(v)
  );
}

/** Type label + icon for a section header. */
function typeLabel(type: DesignToken["type"]): {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (type) {
    case "color":
      return { label: "Colors", Icon: IconPalette };
    case "typography":
      return { label: "Typography", Icon: IconLetterCase };
    case "spacing":
      return { label: "Spacing", Icon: IconSpacingVertical };
    case "radius":
      return { label: "Radius", Icon: IconRuler };
    case "shadow":
      return { label: "Shadows & Effects", Icon: IconShadow };
    default:
      return { label: "Other", Icon: IconBrush };
  }
}

// ---------------------------------------------------------------------------
// Individual token row
// ---------------------------------------------------------------------------

interface TokenRowProps {
  token: DesignToken;
  onEdit: (cssVar: string, value: string) => void;
  editing: boolean;
  editDraft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
}

function TokenRow({
  token,
  editing,
  editDraft,
  onDraftChange,
  onCommit,
  onStartEdit,
  onCancelEdit,
}: TokenRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showSwatch = token.type === "color" && isColorValue(token.value);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  return (
    <div
      className={cn(
        "group flex min-h-[28px] items-center gap-2 rounded px-2 py-0.5",
        "hover:bg-accent/40 transition-colors",
        editing && "bg-accent/60",
      )}
    >
      {/* Swatch or type icon */}
      {showSwatch ? (
        <span
          className="size-3.5 flex-none rounded-sm ring-1 ring-border/50"
          style={{ backgroundColor: token.value }}
          aria-hidden
        />
      ) : (
        <IconCircle
          className="size-3.5 flex-none text-muted-foreground/30"
          aria-hidden
        />
      )}

      {/* Friendly name */}
      <span
        className="flex-1 cursor-pointer truncate text-[11px] text-foreground"
        onClick={onStartEdit}
        title={token.name}
      >
        {token.name}
      </span>

      {/* Value / edit input */}
      {editing ? (
        <Input
          ref={inputRef}
          value={editDraft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={onCommit}
          className="h-5 w-24 px-1 py-0 text-[11px] font-mono"
        />
      ) : (
        <span
          className="max-w-[6rem] cursor-pointer truncate text-right font-mono text-[10px] text-muted-foreground hover:text-foreground"
          title={token.value}
          onClick={onStartEdit}
        >
          {token.value}
        </span>
      )}

      {/* CSS var chip (hidden when editing, visible on hover) */}
      {!editing && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden cursor-default select-all rounded bg-muted px-1 py-0 font-mono text-[9px] text-muted-foreground/70 group-hover:inline">
              {token.cssVar}
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono text-xs">
            {token.cssVar}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Source chip */}
      {!editing && (
        <Badge
          variant="outline"
          className="hidden h-4 cursor-default px-1 py-0 text-[9px] text-muted-foreground/60 group-hover:flex"
        >
          {token.source}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token group section
// ---------------------------------------------------------------------------

interface TokenGroupSectionProps {
  group: TokenGroup;
  editingKey: string | null;
  editDraft: string;
  onStartEdit: (cssVar: string, currentValue: string) => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancelEdit: () => void;
  onEdit: (cssVar: string, value: string) => void;
}

function TokenGroupSection({
  group,
  editingKey,
  editDraft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancelEdit,
  onEdit,
}: TokenGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { label, Icon } = typeLabel(group.type);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent/30"
      >
        {collapsed ? (
          <IconChevronRight className="size-3 text-muted-foreground/50" />
        ) : (
          <IconChevronDown className="size-3 text-muted-foreground/50" />
        )}
        <Icon className="size-3 text-muted-foreground/60" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/40">
          {group.tokens.length}
        </span>
      </button>

      {!collapsed && (
        <div className="pb-1">
          {group.tokens.map((token) => (
            <TokenRow
              key={token.cssVar}
              token={token}
              editing={editingKey === token.cssVar}
              editDraft={editDraft}
              onDraftChange={onDraftChange}
              onCommit={onCommit}
              onStartEdit={() => onStartEdit(token.cssVar, token.value)}
              onCancelEdit={onCancelEdit}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Token popover
// ---------------------------------------------------------------------------

interface NewTokenPopoverProps {
  onAdd: (cssVar: string, value: string) => void;
}

function NewTokenPopover({ onAdd }: NewTokenPopoverProps) {
  const [open, setOpen] = useState(false);
  const [cssVar, setCssVar] = useState("--my-token");
  const [value, setValue] = useState("#000000");
  const t = useT();

  const handleAdd = () => {
    const cleanVar = cssVar.startsWith("--") ? cssVar : `--${cssVar}`;
    onAdd(cleanVar, value);
    setOpen(false);
    setCssVar("--my-token");
    setValue("#000000");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 cursor-pointer gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <IconPlus className="size-3" />
          {t("designEditor.tokens.newToken")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3 text-[12px]">
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">
              {t("designEditor.tokens.cssVar")}
            </label>
            <Input
              value={cssVar}
              onChange={(e) => setCssVar(e.target.value)}
              className="h-6 font-mono text-[11px]"
              placeholder="--my-token"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">
              {t("designEditor.tokens.value")}
            </label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-6 font-mono text-[11px]"
              placeholder="#3B82F6"
            />
          </div>
          <Button
            type="button"
            className="h-7 w-full cursor-pointer text-[11px]"
            onClick={handleAdd}
            disabled={!cssVar || !value}
          >
            {t("designEditor.tokens.add")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * Tokens inspector panel — displays design tokens grouped by type, supports
 * inline editing that persists through the Tweaks loop, and provides a "New
 * token" action. Matches the tokens artboard in §6.2 of DESIGN-STUDIO-PLAN.md.
 */
export function TokensPanel({ designId, onTokensApplied }: TokensPanelProps) {
  const t = useT();

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  const { data, isLoading, refetch } = useActionQuery<IndexDesignTokensResult>(
    "index-design-tokens",
    { designId },
  );

  const applyMutation = useActionMutation("apply-design-token-edit");

  // ------------------------------------------------------------------
  // Local edit state
  // ------------------------------------------------------------------
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const startEdit = (cssVar: string, currentValue: string) => {
    setEditingKey(cssVar);
    setEditDraft(currentValue);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft("");
  };

  const commitEdit = () => {
    if (!editingKey || !editDraft.trim()) {
      cancelEdit();
      return;
    }
    const cssVar = editingKey;
    const value = editDraft.trim();
    cancelEdit();
    applyMutation.mutate(
      { designId, edits: [{ cssVar, value }] },
      {
        onSuccess: (result) => {
          void refetch();
          const r = result as { resolvedCssVars?: Record<string, string> };
          if (r?.resolvedCssVars && onTokensApplied) {
            onTokensApplied(r.resolvedCssVars);
          }
        },
      },
    );
  };

  const handleNewToken = (cssVar: string, value: string) => {
    applyMutation.mutate(
      { designId, edits: [{ cssVar, value }] },
      {
        onSuccess: (result) => {
          void refetch();
          const r = result as { resolvedCssVars?: Record<string, string> };
          if (r?.resolvedCssVars && onTokensApplied) {
            onTokensApplied(r.resolvedCssVars);
          }
        },
      },
    );
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const groups = data?.groups ?? [];
  const tokenCount = data?.tokenCount ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <IconCode className="size-3.5 text-muted-foreground/60" />
          <span className="text-[11px] font-semibold text-foreground">
            {t("designEditor.tokens.title")}
          </span>
          {tokenCount > 0 && (
            <span className="tabular-nums text-[10px] text-muted-foreground/50">
              ({tokenCount})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 cursor-pointer text-muted-foreground/60 hover:text-foreground"
                onClick={() => void refetch()}
                aria-label={t("designEditor.tokens.refresh")}
              >
                <IconRefresh className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("designEditor.tokens.refresh")}</TooltipContent>
          </Tooltip>
          <NewTokenPopover onAdd={handleNewToken} />
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex flex-col gap-1.5 px-3 py-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded bg-muted/40"
                style={{ width: `${60 + (i % 3) * 15}%` }}
              />
            ))}
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <IconPalette className="size-6 text-muted-foreground/30" />
            <p className="text-[11px] leading-snug text-muted-foreground/60">
              {t("designEditor.tokens.empty")}
            </p>
            <p className="text-[10px] text-muted-foreground/40">
              {t("designEditor.tokens.emptyHint")}
            </p>
          </div>
        )}

        {!isLoading && groups.length > 0 && (
          <div className="pb-2">
            {groups.map((group) => (
              <TokenGroupSection
                key={group.type}
                group={group}
                editingKey={editingKey}
                editDraft={editDraft}
                onStartEdit={startEdit}
                onDraftChange={setEditDraft}
                onCommit={commitEdit}
                onCancelEdit={cancelEdit}
                onEdit={(cssVar, value) =>
                  applyMutation.mutate(
                    { designId, edits: [{ cssVar, value }] },
                    {
                      onSuccess: (result) => {
                        void refetch();
                        const r = result as {
                          resolvedCssVars?: Record<string, string>;
                        };
                        if (r?.resolvedCssVars && onTokensApplied) {
                          onTokensApplied(r.resolvedCssVars);
                        }
                      },
                    },
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Pending indicator */}
      {applyMutation.isPending && (
        <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="text-[10px] text-muted-foreground">
            {t("designEditor.tokens.applying")}
          </span>
        </div>
      )}
    </div>
  );
}
