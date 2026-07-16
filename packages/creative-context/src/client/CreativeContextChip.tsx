import { useT } from "@agent-native/core/client";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconBrain,
  IconCheck,
  IconPin,
  IconSettings,
} from "@tabler/icons-react";

import type { ContextPackSummary } from "../types.js";
import { useCreativeContextPacks } from "./actions.js";
import { useCreativeContextState } from "./application-state.js";
import type { CreativeContextApplicationState } from "./application-state.js";

export interface CreativeContextChipProps {
  state: CreativeContextApplicationState;
  packs?: ContextPackSummary[];
  className?: string;
}

export function CreativeContextChip({
  state,
  packs = [],
  className,
}: CreativeContextChipProps) {
  const t = useT();
  const packId = state.pinnedPackId ?? state.currentPackId;
  const pack = packs.find((candidate) => candidate.id === packId);
  const label =
    state.contextMode === "off"
      ? t("creativeContext.off")
      : pack?.name || (packId ? packId : t("creativeContext.automatic"));

  return (
    <Badge
      variant="outline"
      className={className}
      title={pack?.description ?? undefined}
    >
      {state.pinnedPackId ? (
        <IconPin className="me-1 size-3" />
      ) : (
        <IconBrain className="me-1 size-3" />
      )}
      <span className="max-w-44 truncate">{label}</span>
    </Badge>
  );
}

export function CreativeContextComposerChip({
  href = "/agent#library",
  className,
}: {
  href?: string;
  className?: string;
}) {
  const t = useT();
  const contextState = useCreativeContextState();
  const packsQuery = useCreativeContextPacks();
  const packs = packsQuery.data?.packs ?? [];

  async function selectAutomatic() {
    await contextState.setState({
      ...contextState.state,
      contextMode: "auto",
      pinnedPackId: null,
    });
  }

  async function selectOff() {
    await contextState.setState({
      contextMode: "off",
      currentPackId: null,
      pinnedPackId: null,
    });
  }

  async function selectPack(packId: string) {
    await contextState.setState({
      ...contextState.state,
      contextMode: "auto",
      pinnedPackId: packId,
    });
  }

  return (
    <div className={className ?? "px-3 pb-1"}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex max-w-full rounded-full outline-none ring-offset-background transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <CreativeContextChip
              state={contextState.state}
              packs={packs}
              className="max-w-full cursor-pointer bg-background/80"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>
            {t("creativeContext.modeLabel")}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void selectAutomatic()}>
            {contextState.state.contextMode === "auto" &&
            !contextState.state.pinnedPackId ? (
              <IconCheck />
            ) : (
              <IconBrain />
            )}
            {t("creativeContext.automatic")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void selectOff()}>
            {contextState.state.contextMode === "off" ? (
              <IconCheck />
            ) : (
              <IconBrain />
            )}
            {t("creativeContext.off")}
          </DropdownMenuItem>
          {packs.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("creativeContext.packsTitle")}
              </DropdownMenuLabel>
              {packs.slice(0, 8).map((pack) => (
                <DropdownMenuItem
                  key={pack.id}
                  onSelect={() => void selectPack(pack.id)}
                >
                  {contextState.state.pinnedPackId === pack.id ? (
                    <IconCheck />
                  ) : (
                    <IconPin />
                  )}
                  <span className="truncate">{pack.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={href}>
              <IconSettings />
              {t("creativeContext.title")}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
