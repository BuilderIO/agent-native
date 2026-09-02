import { useT } from "@agent-native/core/client/i18n";
import type { Document, DocumentProperty } from "@shared/api";
import {
  countWords,
  DEFAULT_BLOCKS_FIELD_NAME,
  isBlocksPropertyType,
  isPrimaryBlocksField,
} from "@shared/properties";

import {
  documentPropertiesResponseMatchesScope,
  useDocumentProperties,
} from "@/hooks/use-document-properties";

import { DescriptionField } from "./DescriptionField";
import { DocumentProperties } from "./DocumentProperties";

interface DocumentInfoPanelProps {
  document: Document;
  documentContent: string;
  additionalBlockContents?: Readonly<Record<string, string>>;
  databaseId?: string | null;
  databaseDocumentId?: string | null;
  canEdit: boolean;
  onSaveDescription: (description: string) => Promise<unknown>;
}

export function DocumentInfoPanel({
  document,
  documentContent,
  additionalBlockContents = {},
  databaseId,
  databaseDocumentId,
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
      <section className="mt-5" data-document-info-content>
        <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {t("editor.properties.content")}
        </h3>
        {hasDatabaseFields && !propertiesLoaded ? (
          <div
            className="mx-2 h-8 animate-pulse rounded-md bg-muted/40"
            aria-label={t("editor.properties.loadingContent")}
          />
        ) : (
          <div className="grid gap-0.5">
            {blockFields.map((field) => (
              <div
                key={field.propertyId ?? "primary"}
                className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm"
                data-document-info-block-field={field.propertyId ?? "primary"}
              >
                <span className="truncate text-foreground">{field.name}</span>
                <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {t("editor.properties.wordCount", {
                    count: countWords(field.content),
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      {document.databaseMembership && !isLocalFileDocument ? (
        <DocumentProperties
          documentId={document.id}
          databaseId={databaseId ?? document.databaseMembership.databaseId}
          databaseDocumentId={
            databaseDocumentId ?? document.databaseMembership.databaseDocumentId
          }
          canEdit={canEdit}
        />
      ) : null}
    </div>
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
    .map((property) => ({
      propertyId: property.definition.id,
      name: property.definition.name,
      content: isPrimaryBlocksField(property.definition.options)
        ? args.documentContent
        : (args.additionalBlockContents?.[property.definition.id] ??
          (typeof property.value === "string" ? property.value : "")),
    }));
}
