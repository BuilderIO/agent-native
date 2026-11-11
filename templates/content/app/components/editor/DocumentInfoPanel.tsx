import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { Document, DocumentProperty } from "@shared/api";
import {
  countWords,
  DEFAULT_BLOCKS_FIELD_NAME,
  isBlocksPropertyType,
  isEmptyPropertyValue,
  isPrimaryBlocksField,
} from "@shared/properties";

import {
  documentPropertiesReadFailed,
  documentPropertiesResponseMatchesScope,
  useDocumentProperties,
} from "@/hooks/use-document-properties";

import { useNow } from "./database/GitHubSourceStatusLine";
import type { DatabaseRowView } from "./database/row-view-layout";
import { DescriptionField } from "./DescriptionField";
import { DocumentProperties } from "./DocumentProperties";

interface DocumentInfoPanelProps {
  document: Document;
  documentContent: string;
  additionalBlockContents?: Readonly<Record<string, string>>;
  databaseId?: string | null | undefined;
  databaseDocumentId?: string | null | undefined;
  rowView?: DatabaseRowView | null;
  rowViewPending?: boolean;
  canEdit: boolean;
  onSaveDescription: (description: string) => Promise<unknown>;
}

export function DocumentInfoPanel({
  document,
  documentContent,
  additionalBlockContents = {},
  databaseId,
  databaseDocumentId,
  rowView,
  rowViewPending,
  canEdit,
  onSaveDescription,
}: DocumentInfoPanelProps) {
  const t = useT();
  const isLocalFileDocument = document.source?.mode === "local-files";
  const hasDatabaseFields =
    !!document.databaseMembership && !isLocalFileDocument;
  const propertyDatabaseId =
    databaseId ?? document.databaseMembership?.databaseId ?? null;
  const propertiesQuery = useDocumentProperties(
    hasDatabaseFields ? document.id : null,
    propertyDatabaseId,
  );
  const propertiesLoaded = documentPropertiesResponseMatchesScope(
    document.id,
    propertyDatabaseId,
    propertiesQuery.data,
  );
  const loadedProperties = propertiesLoaded
    ? propertiesQuery.data?.properties
    : undefined;
  // Properties below says so and offers the retry; counts can't be known.
  const contentUnknown =
    hasDatabaseFields &&
    documentPropertiesReadFailed(
      document.id,
      propertyDatabaseId,
      propertiesQuery,
    );
  const blockFields = documentInfoBlockFields({
    documentContent,
    properties:
      hasDatabaseFields && loadedProperties
        ? loadedProperties
        : hasDatabaseFields
          ? []
          : null,
    additionalBlockContents,
  });

  return (
    <div className="px-4 pb-8 pt-3" data-document-info-panel>
      <DescriptionField
        description={document.description}
        canEdit={canEdit}
        label={t("editor.properties.description")}
        placeholder={
          document.database
            ? t("editor.properties.addDatabaseDescription")
            : t("editor.properties.addPageDescription")
        }
        onSave={onSaveDescription}
      />
      {document.databaseMembership && !isLocalFileDocument ? (
        <DocumentProperties
          documentId={document.id}
          databaseId={databaseId ?? document.databaseMembership.databaseId}
          databaseDocumentId={
            databaseDocumentId ?? document.databaseMembership.databaseDocumentId
          }
          rowView={rowView}
          rowViewPending={rowViewPending}
          canEdit={canEdit}
          wrapValues
        />
      ) : null}
      <PageDetails
        document={document}
        blockFields={
          contentUnknown
            ? null
            : hasDatabaseFields && !propertiesLoaded
              ? "loading"
              : blockFields
        }
      />
    </div>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The foot of Info: how long the Page is, and when it was made and last
 * edited. Each Blocks field is counted on its own line once there are two.
 */
function PageDetails({
  document,
  blockFields,
}: {
  document: Document;
  /** Null when the Page's fields couldn't be read, so no count is known. */
  blockFields: readonly DocumentInfoBlockField[] | "loading" | null;
}) {
  const t = useT();
  const formatters = useFormatters();
  // Moves "Edited 2 minutes ago" on while Info stays open.
  const now = useNow();
  const shortDate = (date: Date) =>
    formatters.formatDate(date, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== new Date(now).getFullYear()
        ? { year: "numeric" }
        : {}),
    });
  const fullDate = (date: Date) =>
    formatters.formatDate(date, { dateStyle: "medium", timeStyle: "short" });
  const editedLabel = (edited: Date) => {
    const elapsed = Math.max(0, now - edited.getTime());
    const ago = (amount: number, unit: Intl.RelativeTimeFormatUnit) =>
      t("editor.properties.editedAgo", {
        time: formatters.formatRelativeTime(-amount, unit, {
          numeric: "auto",
        }),
      });
    if (elapsed < MINUTE) return t("editor.properties.editedJustNow");
    if (elapsed < HOUR) return ago(Math.floor(elapsed / MINUTE), "minute");
    if (elapsed < DAY) return ago(Math.floor(elapsed / HOUR), "hour");
    if (elapsed < 7 * DAY) return ago(Math.floor(elapsed / DAY), "day");
    return t("editor.properties.editedOn", { date: shortDate(edited) });
  };
  // A date the server sent unreadable is left out rather than shown wrong.
  const created = validDate(document.createdAt);
  const edited = validDate(document.updatedAt);
  const onlyField =
    blockFields !== "loading" && blockFields?.length === 1
      ? blockFields[0]
      : undefined;
  const wordCount = (content: string) =>
    t("editor.properties.wordCount", { count: countWords(content) });

  return (
    <section
      className="mt-6 grid gap-1 border-t border-border px-2 pt-3 text-xs text-muted-foreground"
      data-document-page-details
    >
      <h3 className="pb-0.5 font-medium">
        {t("editor.properties.pageDetails")}
      </h3>
      {blockFields === "loading" ? (
        <div
          className="h-4 w-24 animate-pulse rounded bg-muted/40"
          role="status"
          aria-label={t("editor.properties.loadingContent")}
        />
      ) : onlyField ? (
        <p className="tabular-nums" data-document-info-block-field>
          {wordCount(onlyField.content)}
        </p>
      ) : (
        blockFields?.map((field) => (
          <p
            key={field.propertyId ?? "primary"}
            className="flex min-w-0 gap-1.5 tabular-nums"
            data-document-info-block-field={field.propertyId ?? "primary"}
          >
            <span className="min-w-0 break-words text-foreground/80">
              {field.name}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{wordCount(field.content)}</span>
          </p>
        ))
      )}
      <p>
        {created ? (
          <span title={fullDate(created)}>
            {t("editor.properties.createdOn", { date: shortDate(created) })}
          </span>
        ) : null}
        {created && edited ? <span aria-hidden="true"> · </span> : null}
        {edited ? (
          <span title={fullDate(edited)}>{editedLabel(edited)}</span>
        ) : null}
      </p>
    </section>
  );
}

export interface DocumentInfoBlockField {
  propertyId: string | null;
  name: string;
  content: string;
}

export function documentInfoBlockFields(args: {
  documentContent: string;
  properties: DocumentProperty[] | null;
  additionalBlockContents?: Readonly<Record<string, string>>;
}): DocumentInfoBlockField[] {
  if (args.properties === null) {
    return [
      {
        propertyId: null,
        name: DEFAULT_BLOCKS_FIELD_NAME,
        content: args.documentContent,
      },
    ];
  }

  return args.properties
    .filter((property) => isBlocksPropertyType(property.definition.type))
    .sort((a, b) => a.definition.position - b.definition.position)
    .flatMap((property) => {
      const content = isPrimaryBlocksField(property.definition.options)
        ? args.documentContent
        : (args.additionalBlockContents?.[property.definition.id] ??
          (typeof property.value === "string" ? property.value : ""));
      if (
        property.definition.visibility === "always_hide" ||
        (property.definition.visibility === "hide_when_empty" &&
          isEmptyPropertyValue(content))
      ) {
        return [];
      }
      return [
        {
          propertyId: property.definition.id,
          name: property.definition.name,
          content,
        },
      ];
    });
}
