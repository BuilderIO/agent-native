import { useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseSource, Document } from "@shared/api";
import type { ReactNode } from "react";

import {
  isContentDatabaseUnavailable,
  useContentDatabaseById,
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

function useRowPageSources(document: Document): ContentDatabaseSource[] {
  const membership = document.databaseMembership;
  const read = useContentDatabaseById(
    membership?.databaseId &&
      !membership.systemRole &&
      document.source?.mode !== "github"
      ? membership.databaseId
      : null,
    { limit: 0 },
  );
  const data =
    read.data && !isContentDatabaseUnavailable(read.data) ? read.data : null;
  return data?.sources ?? (data?.source ? [data.source] : []);
}

export function SyncedPageBanner({ document }: { document: Document }) {
  const t = useT();
  const sources = useRowPageSources(document);

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

  const notion = sources.find(
    (source) =>
      source.sourceType === "notion-database" &&
      source.metadata.federation?.role === "secondary",
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
