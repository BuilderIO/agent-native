import { useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseSource, Document } from "@shared/api";
import type { ReactNode } from "react";

import {
  isContentDatabaseUnavailable,
  useContentDatabaseById,
  useContentDatabaseRowSourceOverlays,
} from "@/hooks/use-content-database";

import { builderSourceWriteMode } from "./database/builder-source-progress";

function SyncedPageLine({
  provider,
  children,
  link,
}: {
  provider: string;
  children: ReactNode;
  link?: { href: string; label: string } | null;
}) {
  return (
    <div
      className="border-b bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground"
      role="status"
      data-synced-page-banner={provider}
    >
      {children}
      {link ? (
        <>
          {" "}
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {link.label}
          </a>
        </>
      ) : null}
    </div>
  );
}

const BUILDER_EDIT_KEYS = {
  read_only: "editor.syncedPageBuilderReadOnly",
  stage_only: "editor.syncedPageBuilderStageOnly",
  publish_updates: "editor.syncedPageBuilderPublish",
} as const;

type RowPageSources =
  | { state: "pending" }
  | { state: "unreadable"; retry: () => void }
  | { state: "read"; sources: ContentDatabaseSource[] };

function useRowPageSources(document: Document): RowPageSources {
  const membership = document.databaseMembership;
  const read = useContentDatabaseById(
    membership?.databaseId &&
      !membership.systemRole &&
      document.source?.mode !== "github"
      ? membership.databaseId
      : null,
    { limit: 0 },
  );
  if (read.data) {
    const data = isContentDatabaseUnavailable(read.data) ? null : read.data;
    return {
      state: "read",
      sources: data?.sources ?? (data?.source ? [data.source] : []),
    };
  }
  if (read.isError) {
    return { state: "unreadable", retry: () => void read.refetch() };
  }
  return { state: "pending" };
}

export function SyncedPageBanner({ document }: { document: Document }) {
  const t = useT();
  const rowPage = useRowPageSources(document);
  const sources = rowPage.state === "read" ? rowPage.sources : [];
  const notionSources = sources.filter(
    (source) =>
      source.sourceType === "notion-database" &&
      source.metadata.federation?.role === "secondary",
  );
  // Notion adds details only to the rows it matched, so the line waits on
  // this page's row.
  const overlays = useContentDatabaseRowSourceOverlays(
    notionSources.length > 0
      ? (document.databaseMembership?.databaseId ?? null)
      : null,
    document.id,
  );

  if (document.source?.mode === "github") {
    return (
      <SyncedPageLine
        provider="github"
        link={
          document.source.url
            ? {
                href: document.source.url,
                label: t("editor.githubSourceOpenFile"),
              }
            : null
        }
      >
        {t("editor.githubSourceReadOnly")}
      </SyncedPageLine>
    );
  }

  if (rowPage.state === "unreadable") {
    return (
      <SyncedPageLine provider="unknown">
        {t("editor.syncedPageSourceUnreadable")}{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={rowPage.retry}
        >
          {t("editor.syncedPageCheckAgain")}
        </button>
      </SyncedPageLine>
    );
  }
  const membershipSourceId = document.databaseMembership?.sourceId ?? null;
  const builder = sources.find(
    (source) =>
      source.sourceType === "builder-cms" &&
      source.metadata.federation?.role !== "secondary" &&
      (source.id === membershipSourceId ||
        document.bodyHydration?.sourceId === source.id),
  );
  if (builder) {
    return (
      <SyncedPageLine provider="builder">
        {t("editor.syncedPageBuilder", { name: builder.sourceName })}{" "}
        {t(BUILDER_EDIT_KEYS[builderSourceWriteMode(builder)])}
      </SyncedPageLine>
    );
  }

  const notion = notionSources.find((source) =>
    overlays?.some((overlay) => overlay.sourceId === source.id),
  );
  if (notion) {
    return (
      <SyncedPageLine provider="notion">
        {t("editor.syncedPageNotion", { name: notion.sourceName })}
      </SyncedPageLine>
    );
  }

  return null;
}
