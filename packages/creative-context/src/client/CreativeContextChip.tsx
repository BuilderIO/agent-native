import { useT } from "@agent-native/core/client";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui";
import {
  IconBrain,
  IconCheck,
  IconPin,
  IconSettings,
} from "@tabler/icons-react";

import type { ContextPackSummary } from "../types.js";
import {
  parseCreativeContexts,
  useCreativeContexts,
  useCreativeContextPacks,
  type CreativeContextSummary,
} from "./actions.js";
import { useCreativeContextState } from "./application-state.js";
import type { CreativeContextApplicationState } from "./application-state.js";

export interface CreativeContextChipProps {
  state: CreativeContextApplicationState;
  packs?: ContextPackSummary[];
  contexts?: CreativeContextSummary[];
  className?: string;
}

export type CreativeContextChipSelection =
  | "off"
  | "pinned-pack"
  | "selected-context"
  | "automatic";

export function resolveCreativeContextChipSelection(
  state: CreativeContextApplicationState,
): CreativeContextChipSelection {
  if (state.contextMode === "off") return "off";
  if (state.pinnedPackId) return "pinned-pack";
  if (state.selectedContextId) return "selected-context";
  return "automatic";
}

export function hasCreativeContextConfiguration(
  packs: ReadonlyArray<Pick<ContextPackSummary, "memberCount">>,
  contexts: ReadonlyArray<Pick<CreativeContextSummary, "memberCount">>,
): boolean {
  return (
    packs.some((pack) => pack.memberCount > 0) ||
    contexts.some((context) => context.memberCount > 0)
  );
}

export function CreativeContextChip({
  state,
  packs = [],
  contexts = [],
  className,
}: CreativeContextChipProps) {
  const t = useT();
  const packId = state.pinnedPackId ?? state.currentPackId;
  const pack = packs.find((candidate) => candidate.id === packId);
  const context = contexts.find(
    (candidate) => candidate.id === state.selectedContextId,
  );
  const selection = resolveCreativeContextChipSelection(state);
  const label =
    selection === "off"
      ? t("creativeContext.off")
      : selection === "pinned-pack"
        ? pack?.name || packId
        : selection === "selected-context"
          ? context?.name || state.selectedContextId
          : t("creativeContext.automatic");

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
  const contextsQuery = useCreativeContexts();
  const packs = packsQuery.data?.packs ?? [];
  const contexts = parseCreativeContexts(contextsQuery.data);

  if (!hasCreativeContextConfiguration(packs, contexts)) return null;

  async function selectAutomatic() {
    await contextState.setState({
      ...contextState.state,
      contextMode: "auto",
      selectedContextId: null,
      pinnedPackId: null,
    });
  }

  async function selectOff() {
    await contextState.setState({
      contextMode: "off",
      selectedContextId: null,
      currentPackId: null,
      pinnedPackId: null,
    });
  }

  async function selectPack(packId: string) {
    await contextState.setState({
      ...contextState.state,
      contextMode: "auto",
      selectedContextId: null,
      pinnedPackId: packId,
    });
  }

  async function selectContext(contextId: string) {
    await contextState.setState({
      ...contextState.state,
      contextMode: "auto",
      selectedContextId: contextId,
      pinnedPackId: null,
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
              contexts={contexts}
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
            !contextState.state.pinnedPackId &&
            !contextState.state.selectedContextId ? (
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
          {contexts.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Contexts</DropdownMenuLabel>
              {contexts.slice(0, 8).map((context) => (
                <DropdownMenuItem
                  key={context.id}
                  onSelect={() => void selectContext(context.id)}
                >
                  {contextState.state.selectedContextId === context.id ? (
                    <IconCheck />
                  ) : (
                    <IconBrain />
                  )}
                  <span className="truncate">{context.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          {packs.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Advanced: pin an exact pack
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
