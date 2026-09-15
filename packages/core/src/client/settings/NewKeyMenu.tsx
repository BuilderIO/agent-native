/**
 * <NewKeyMenu /> — the "+ New" key picker shared by every place a key can be
 * added: search the keys an app declares, or type any name to add a custom
 * one. The app Keys section and the Dispatch Vault render the same menu so
 * adding a key feels identical wherever you do it.
 */

import { ButtonBase as ToolkitButtonBase } from "@agent-native/toolkit/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import { cn } from "../utils.js";
import { providerLogoForKey } from "./KeyProviderTile.js";

export interface NewKeyOption {
  /** Env-var style key name, e.g. `OPENAI_API_KEY`. */
  key: string;
  /** Human label shown in the list, e.g. "OpenAI API key". */
  label: string;
  required?: boolean;
  /** Small muted text on the right, e.g. the app that declares the key. */
  hint?: string;
}

export interface NewKeyMenuProps {
  /** Keys the caller already knows about that are not set yet. */
  options: NewKeyOption[];
  onPick: (option: NewKeyOption) => void;
  /** Custom key chosen; `name` is the typed search, already normalized. */
  onCustom: (name?: string) => void;
  /** Trigger button text. Defaults to "New". */
  label?: string;
  triggerClassName?: string;
}

/** `stripe secret` → `STRIPE_SECRET`, the shape key names must take. */
export function normalizeKeyName(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "");
}

export function NewKeyMenu({
  options,
  onPick,
  onCustom,
  label,
  triggerClassName,
}: NewKeyMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = normalizeKeyName(query);
  const triggerLabel = label ?? t("secrets.newKey");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <ToolkitButtonBase
          type="button"
          variant="outline"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground",
            triggerClassName,
          )}
        >
          <IconPlus size={11} />
          {triggerLabel}
        </ToolkitButtonBase>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command
          // cmdk's default scorer matches loose subsequences, so "logo"
          // also surfaces every "G-o-o-g-l-e ... " key.
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={t("secrets.searchKeys")}
            onValueChange={setQuery}
          />
          {options.length > 0 && (
            <CommandList>
              <CommandEmpty>{t("secrets.noKeysFound")}</CommandEmpty>
              <CommandGroup heading={t("secrets.chooseKey")}>
                {options.map((option) => {
                  const provider = providerLogoForKey(option.key);
                  return (
                    <CommandItem
                      key={option.key}
                      value={`${option.label} ${option.key}`}
                      onSelect={() => {
                        setOpen(false);
                        onPick(option);
                      }}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {provider && (
                          <McpIntegrationLogo
                            name={option.label}
                            logoUrl={provider.logoUrl}
                            integrationId={provider.id}
                            className="size-4 shrink-0 rounded-sm border-0"
                          />
                        )}
                        <span className="truncate">{option.label}</span>
                      </span>
                      {option.required ? (
                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          {t("secrets.required")}
                        </span>
                      ) : option.hint ? (
                        <span className="shrink-0 truncate text-[9px] text-muted-foreground">
                          {option.hint}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          )}
          {/* Outside the scrolling list and force-mounted: cmdk hides a
              group whose items missed the previous search, so a filtered
              item can't advertise itself. A footer stays visible and
              keyboard-reachable no matter what was typed. */}
          <CommandGroup
            forceMount
            className={cn(options.length > 0 && "border-t border-border")}
          >
            <CommandItem
              forceMount
              value="custom key"
              onSelect={() => {
                setOpen(false);
                onCustom(normalized || undefined);
              }}
              className="flex items-center justify-between gap-3"
            >
              {normalized ? (
                <span className="break-all">
                  {t("secrets.addCustomKeyNamed", { name: normalized })}
                </span>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <IconPlus size={14} />
                    {t("secrets.customKey")}
                  </span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {t("secrets.customKeyHint")}
                  </span>
                </>
              )}
            </CommandItem>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
