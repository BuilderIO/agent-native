import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconDeviceDesktop,
  IconRoute,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  AGENT_PROVIDER_CATALOG,
  getAgentProviderOption,
  type AgentProviderId,
  type AgentProviderOption,
} from "../agent-provider-catalog.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { cn } from "../utils.js";

export interface AgentProviderPickerProps {
  value: AgentProviderId;
  onChange: (provider: AgentProviderId) => void;
  options?: readonly AgentProviderOption[];
  configuredProviders?: ReadonlySet<AgentProviderId>;
  disabled?: boolean;
  className?: string;
  layout?: "compact" | "page";
}

function ProviderIcon({
  option,
  size = 15,
}: {
  option: AgentProviderOption;
  size?: number;
}) {
  if (option.kind === "local") return <IconDeviceDesktop size={size} />;
  if (option.kind === "gateway") return <IconRoute size={size} />;
  return <IconCloud size={size} />;
}

export function AgentProviderPicker({
  value,
  onChange,
  options = AGENT_PROVIDER_CATALOG,
  configuredProviders,
  disabled = false,
  className,
  layout = "compact",
}: AgentProviderPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = getAgentProviderOption(value);
  const isPage = layout === "page";

  return (
    <div className={cn("space-y-1.5", className)}>
      <p
        className={cn(
          "font-medium text-foreground",
          isPage ? "text-sm" : "text-[11px]",
        )}
      >
        {t("agentPanel.chooseProvider", {
          defaultValue: "Choose a provider",
        })}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("agentPanel.chooseProvider", {
              defaultValue: "Choose a provider",
            })}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-border bg-background text-start text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60",
              isPage ? "min-h-10 px-3 text-sm" : "min-h-9 px-2.5 text-[12px]",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/50 text-muted-foreground">
              <ProviderIcon option={active} size={isPage ? 16 : 14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{active.label}</span>
            </span>
            <IconChevronDown
              size={isPage ? 16 : 14}
              className="shrink-0 text-muted-foreground"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(390px,calc(100vw-2rem))] p-0"
        >
          <Command
            filter={(candidate, search) =>
              candidate.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput
              placeholder={t("agentPanel.searchProviders", {
                defaultValue: "Search providers...",
              })}
            />
            <CommandList className="max-h-[min(440px,calc(100vh-8rem))]">
              <CommandEmpty>
                {t("agentPanel.noProvidersFound", {
                  defaultValue: "No providers found.",
                })}
              </CommandEmpty>
              <CommandGroup
                heading={t("agentPanel.availableProviders", {
                  defaultValue: "Available providers",
                })}
              >
                {options.map((option) => {
                  const configured = configuredProviders?.has(option.id);
                  return (
                    <CommandItem
                      key={option.id}
                      value={`${option.label} ${option.description} ${option.key ?? "local"}`}
                      onSelect={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      className="items-center gap-2.5 py-2.5"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/50 text-muted-foreground">
                        <ProviderIcon option={option} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">
                            {option.label}
                          </span>
                          {configured ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-primary">
                              <IconCheck size={11} />
                              {t("agentPanel.configured", {
                                defaultValue: "Configured",
                              })}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {option.key
                          ? t("agentPanel.apiKey", {
                              defaultValue: "API key",
                            })
                          : t("agentPanel.localRuntime", {
                              defaultValue: "Local",
                            })}
                      </span>
                      <IconCheck
                        size={15}
                        className={cn(
                          "shrink-0",
                          option.id === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
