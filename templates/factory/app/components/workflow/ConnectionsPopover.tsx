import { useT } from "@agent-native/core/client/i18n";
import { IconPlugConnectedX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { providerName } from "@/components/workflow-canvas/node-kinds";

import type { MissingConnection } from "../factory/connection-rows";
import { ConnectProviderButton } from "../factory/ConnectProviderButton";
import { useWorkflowStrings } from "./workflow-strings";

/** The providers this workflow needs and cannot reach yet, each with its one way to connect. */
export function ConnectionsPopover({
  missing,
  open,
  onOpenChange,
  onConnected,
}: {
  missing: readonly MissingConnection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const t = useT();
  const ws = useWorkflowStrings();

  if (missing.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          <IconPlugConnectedX />
          {ws.toolbar.connectionsNeeded(missing.length)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-1"
        aria-label={ws.toolbar.connectionsListName}
      >
        <ul className="flex flex-col">
          {missing.map((entry) => (
            <li
              key={entry.provider}
              className="flex items-center justify-between gap-2 px-2 py-1.5"
            >
              <span className="min-w-0 truncate text-sm">
                {entry.provider === "email"
                  ? t("settings.factory.email")
                  : providerName(entry.provider)}
              </span>
              <ConnectProviderButton
                provider={entry.provider}
                connectWith={entry.connectWith}
                readiness="needs_credentials"
                onConnected={onConnected}
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
