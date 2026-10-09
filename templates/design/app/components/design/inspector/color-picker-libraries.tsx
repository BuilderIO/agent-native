import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { swatchStyle, UNRESOLVED_SWATCH_CLASS } from "./color-picker-swatch";
import {
  filterTokens,
  resolveVarColor,
  tokenVarCss,
  type DesignColorToken,
  type DesignColorTokens,
} from "./color-picker-tokens";

// Libraries keeps the Custom pane's height and scrolls inside it, so a long
// token list never grows the popover. 466 + the 40px header is Figma's 506.
const LIBRARIES_HEIGHT = "h-[466px]";

/**
 * The picker's Libraries pane: the design's color tokens with a search field.
 * Selecting a token only reports it; the caller binds the fill to
 * `var(--token)`. There is no way to create a token here.
 */
export function ColorLibraries({
  tokens,
  activeVar,
  disabled,
  onPick,
}: {
  tokens: DesignColorTokens | undefined;
  /** The custom property the fill is bound to, when it is bound to one. */
  activeVar?: string;
  disabled: boolean;
  onPick: (token: DesignColorToken) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");

  if (!tokens || tokens.status === "loading") {
    return (
      <div className={cn("space-y-1 p-3", LIBRARIES_HEIGHT)} aria-busy="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex h-8 items-center gap-2 px-1">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }
  if (tokens.status === "error") {
    return (
      <p
        role="alert"
        className={cn(
          "px-3 py-4 !text-[11px] text-muted-foreground",
          LIBRARIES_HEIGHT,
        )}
      >
        {t("editPanel.colorPicker.tokensFailed")}
      </p>
    );
  }
  if (tokens.tokens.length === 0) {
    return (
      <p
        className={cn(
          "px-3 py-4 !text-[11px] text-muted-foreground",
          LIBRARIES_HEIGHT,
        )}
      >
        {t("editPanel.colorPicker.noTokens")}
      </p>
    );
  }

  return (
    <LibraryList
      tokens={tokens}
      query={query}
      onQueryChange={setQuery}
      activeVar={activeVar}
      disabled={disabled}
      onPick={onPick}
    />
  );
}

function LibraryList({
  tokens,
  query,
  onQueryChange,
  activeVar,
  disabled,
  onPick,
}: {
  tokens: Extract<DesignColorTokens, { status: "ready" }>;
  query: string;
  onQueryChange: (query: string) => void;
  activeVar?: string;
  disabled: boolean;
  onPick: (token: DesignColorToken) => void;
}) {
  const t = useT();
  const shown = useMemo(
    () => filterTokens(tokens.tokens, query),
    [tokens, query],
  );

  return (
    <div className={cn("flex flex-col", LIBRARIES_HEIGHT)}>
      <label className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 px-3 text-muted-foreground">
        <IconSearch className="size-3.5 shrink-0" aria-hidden />
        <Input
          type="text"
          value={query}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("editPanel.colorPicker.searchTokens")}
          placeholder={t("editPanel.colorPicker.search")}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground shadow-none focus-visible:ring-0 !text-[11px] md:!text-[11px]"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <div className="px-3 pb-1 pt-2 !text-[11px] font-semibold text-muted-foreground">
        {t("editPanel.colorPicker.designTokens")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {shown.length === 0 ? (
          <p className="px-2 py-2 !text-[11px] text-muted-foreground">
            {t("editPanel.colorPicker.noTokenMatches")}
          </p>
        ) : (
          shown.map((token) => (
            <TokenRow
              key={token.cssVar}
              token={token}
              tokens={tokens}
              active={token.cssVar === activeVar}
              disabled={disabled}
              onPick={onPick}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TokenRow({
  token,
  tokens,
  active,
  disabled,
  onPick,
}: {
  token: DesignColorToken;
  tokens: DesignColorTokens;
  active: boolean;
  disabled: boolean;
  onPick: (token: DesignColorToken) => void;
}) {
  const t = useT();
  const resolution = resolveVarColor(tokenVarCss(token.cssVar), tokens);
  const preview = resolution?.kind === "color" ? resolution.css : null;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      title={
        preview
          ? token.cssVar
          : `${token.cssVar} — ${t("editPanel.colorPicker.tokenNoPreview")}`
      }
      onClick={() => onPick(token)}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-start !text-[11px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 text-foreground"
          : "text-foreground hover:bg-[var(--design-editor-control-bg)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 rounded-sm shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.12)]",
          !preview && UNRESOLVED_SWATCH_CLASS,
        )}
        style={preview ? swatchStyle(preview) : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{token.name}</span>
      {active ? <IconCheck className="size-3.5 shrink-0" /> : null}
    </button>
  );
}
