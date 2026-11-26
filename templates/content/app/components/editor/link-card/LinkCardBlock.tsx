import type {
  BlockReadProps,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { useT } from "@agent-native/core/client/i18n";
import {
  linkCardBlockConfig,
  readLinkCardData,
  type LinkCardApp,
  type LinkCardData,
} from "@shared/link-card-block";
import {
  IconLink,
  IconMovie,
  IconPalette,
  IconPresentation,
} from "@tabler/icons-react";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { useLinkSummary } from "./use-link-summary";

export const LINK_CARD_APP_NAMES: Record<LinkCardApp, string> = {
  design: "Design",
  slides: "Slides",
  clips: "Clips",
};

const APP_ICONS = {
  design: IconPalette,
  slides: IconPresentation,
  clips: IconMovie,
} as const;

export function linkCardDisplayUrl(url: string): string {
  if (!URL.canParse(url)) return "";
  const { host, pathname } = new URL(url);
  return host && `${host}${pathname === "/" ? "" : pathname}`;
}

export function LinkCardView({ data }: { data: LinkCardData }) {
  const t = useT();
  const summary = useLinkSummary(data.url);
  const app = LINK_CARD_APP_NAMES[data.app];
  const Icon = APP_ICONS[data.app];
  const link = linkCardDisplayUrl(data.url);
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      title={t("linkCard.openIn", { app })}
      contentEditable={false}
      data-link-card={data.app}
      data-link-card-state={summary.state}
      className="my-1 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground no-underline hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        {summary.state === "loading" ? (
          <Skeleton className="my-0.5 h-4 w-48 max-w-full" />
        ) : (
          <span className="block truncate text-sm font-medium text-foreground">
            {summary.state === "available"
              ? summary.title || t("linkCard.untitled")
              : app}
          </span>
        )}
        <span className="block truncate text-xs text-muted-foreground">
          {summary.state === "available" ? `${app} · ${link}` : link}
        </span>
      </span>
    </a>
  );
}

function UnreadableLinkCard({ data }: { data: unknown }) {
  const url =
    data && typeof data === "object" && "url" in data
      ? String((data as { url: unknown }).url)
      : "";
  return (
    <div
      data-link-card=""
      className="my-1 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground"
    >
      <IconLink className="size-4 shrink-0" aria-hidden />
      <span className="truncate">
        {linkCardDisplayUrl(url) || linkCardBlockConfig.label}
      </span>
    </div>
  );
}

function LinkCardRead({ data }: BlockReadProps<LinkCardData>) {
  const card = useMemo(() => readLinkCardData(data), [data]);
  return card ? (
    <LinkCardView data={card} />
  ) : (
    <UnreadableLinkCard data={data} />
  );
}

export const linkCardBlock: BlockSpec<LinkCardData> = {
  ...linkCardBlockConfig,
  Read: LinkCardRead,
  editSurface: "none",
  icon: IconLink,
};
