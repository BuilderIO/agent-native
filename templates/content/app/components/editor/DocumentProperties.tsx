import {
  emailToName,
  useActionMutation,
  useSession,
  useT,
} from "@agent-native/core/client";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  BindContentDatabaseSourceFieldRequest,
  ContentDatabaseResponse,
  ContentDatabaseSourceFieldPropertyResponse,
  ContentDatabaseSource,
  DocumentProperty,
} from "@shared/api";
import {
  CREATABLE_DOCUMENT_PROPERTY_TYPES,
  DOCUMENT_PROPERTY_TYPE_LABELS,
  DOCUMENT_PROPERTY_VISIBILITY_LABELS,
  DOCUMENT_PROPERTY_VISIBILITIES,
  defaultPropertyOptions,
  documentPropertyDateIncludesTime,
  documentPropertyDateKey,
  documentPropertyDatePart,
  isEmptyPropertyValue,
  isComputedPropertyType,
  isOnlyBlocksFieldDeletion,
  normalizeDatePropertyValue,
  type DocumentPropertyDateValue,
  type DocumentPropertyOption,
  type DocumentPropertyOptionColor,
  type DocumentPropertyType,
  type DocumentPropertyVisibility,
} from "@shared/properties";
import {
  IconAlignLeft,
  IconAt,
  IconCalendar,
  IconCheck,
  IconCircleChevronDown,
  IconCircleDotted,
  IconClockFilled,
  IconClock,
  IconCopy,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconHash,
  IconLink,
  IconList,
  IconMapPin,
  IconNumber,
  IconNumber123,
  IconPaperclip,
  IconPalette,
  IconPhone,
  IconPlus,
  IconSearch,
  IconSquareCheck,
  IconTrash,
  IconUpload,
  IconX,
  IconUserCircle,
  type Icon,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { applySourceFieldPropertyToDatabaseResponse } from "@/hooks/use-content-database";
import {
  useConfigureDocumentProperty,
  useDeleteDocumentProperty,
  useDocumentProperties,
  useDuplicateDocumentProperty,
  useSetDocumentProperty,
} from "@/hooks/use-document-properties";
import { cn } from "@/lib/utils";

import { imageUploadErrorMessage, uploadImageFile } from "./image-upload";

type TFunction = ReturnType<typeof useT>;

function tWithFallback(
  t: TFunction | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
) {
  if (!t) return fallback;
  const value = t(key, options);
  return value === key ? fallback : value;
}

interface DocumentPropertiesProps {
  documentId: string;
  canEdit: boolean;
  popoversPortalled?: boolean;
}

export const TYPE_ICONS: Record<DocumentPropertyType, Icon> = {
  text: IconAlignLeft,
  number: IconHash,
  formula: IconNumber123,
  rollup: IconNumber123,
  select: IconCircleChevronDown,
  multi_select: IconList,
  status: IconCircleDotted,
  date: IconCalendar,
  person: IconUserCircle,
  place: IconMapPin,
  files_media: IconPaperclip,
  checkbox: IconSquareCheck,
  url: IconLink,
  email: IconAt,
  phone: IconPhone,
  relation: IconLink,
  blocks: IconFileText,
  id: IconNumber,
  created_time: IconClockFilled,
  created_by: IconUserCircle,
  last_edited_time: IconClockFilled,
  last_edited_by: IconUserCircle,
};

export const OPTION_COLOR_CLASSES: Record<DocumentPropertyOptionColor, string> =
  {
    gray: "bg-muted text-muted-foreground",
    brown: "bg-amber-950/10 text-amber-900 dark:text-amber-200",
    orange: "bg-orange-500/15 text-orange-800 dark:text-orange-200",
    yellow: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-100",
    green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    blue: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    purple: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
    pink: "bg-pink-500/15 text-pink-800 dark:text-pink-200",
    red: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
  };

export const OPTION_COLORS: DocumentPropertyOptionColor[] = [
  "gray",
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "red",
];

const PROPERTY_TYPE_SEARCH_ALIASES: Partial<
  Record<DocumentPropertyType, string[]>
> = {
  person: ["people", "user", "users", "owner", "assignee"],
  place: ["location", "address", "where"],
  files_media: ["file", "files", "media", "attachment", "attachments"],
  formula: ["calculate", "calculation", "computed", "equation"],
  relation: ["relationship", "linked", "link", "database"],
  rollup: ["aggregate", "aggregation", "sum", "count", "relation"],
  blocks: ["content", "body", "rich text", "rich-text", "page", "notes"],
};

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `option-${Date.now()}`;
}

function formatDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(year, month - 1, day));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const [datePart, timePart] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(year, month - 1, day, hour, minute));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatPropertyDateDisplayValue(
  value: DocumentProperty["value"],
  t?: TFunction,
) {
  const includeTime = documentPropertyDateIncludesTime(value);
  const formatter = includeTime ? formatDateTime : formatDate;
  const start = documentPropertyDatePart(value, "start");
  const end = documentPropertyDatePart(value, "end");
  if (!start) return tWithFallback(t, "editor.properties.empty", "Empty");
  return end ? `${formatter(start)} - ${formatter(end)}` : formatter(start);
}

function optionClass(option?: DocumentPropertyOption | null) {
  return OPTION_COLOR_CLASSES[option?.color ?? "gray"];
}

function optionById(property: DocumentProperty, id: string | null) {
  return property.definition.options.options?.find(
    (option) => option.id === id,
  );
}

export function displayValue(property: DocumentProperty, t?: TFunction) {
  const value = property.value;
  const type = property.definition.type;
  const empty = tWithFallback(t, "editor.properties.empty", "Empty");

  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/70">{empty}</span>;
  }

  if (type === "checkbox") {
    return value ? (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <IconCheck className="size-3.5" />
        {tWithFallback(t, "editor.properties.checked", "Checked")}
      </span>
    ) : (
      <span className="text-muted-foreground/70">
        {tWithFallback(t, "editor.properties.unchecked", "Unchecked")}
      </span>
    );
  }

  if (type === "date") {
    return <span>{formatPropertyDateDisplayValue(value, t)}</span>;
  }

  if (type === "created_time" || type === "last_edited_time") {
    return <span>{formatDateTime(String(value))}</span>;
  }

  if (type === "person") {
    const people = personItems(value);
    if (people.length === 0) {
      return <span className="text-muted-foreground/70">{empty}</span>;
    }
    return (
      <span className="inline-flex max-w-full flex-wrap gap-1">
        {people.map((person) => (
          <PersonPill key={person} value={person} />
        ))}
      </span>
    );
  }

  if (type === "created_by" || type === "last_edited_by") {
    return <PersonPill value={String(value)} />;
  }

  if (type === "place") {
    return <PlacePill value={String(value)} />;
  }

  if (type === "files_media") {
    const items = filesMediaItems(value);
    if (items.length === 0) {
      return <span className="text-muted-foreground/70">{empty}</span>;
    }
    return (
      <span className="inline-flex max-w-full flex-wrap gap-1">
        {items.map((item) => (
          <FilesMediaPill key={item} value={item} />
        ))}
      </span>
    );
  }

  if (type === "relation") {
    const items = relationItems(value);
    if (items.length === 0) {
      return <span className="text-muted-foreground/70">{empty}</span>;
    }
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
        <IconLink className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {tWithFallback(
            t,
            items.length === 1
              ? "editor.properties.pageCount_one"
              : "editor.properties.pageCount_other",
            `${items.length} page${items.length === 1 ? "" : "s"}`,
            { count: items.length },
          )}
        </span>
      </span>
    );
  }

  if (type === "select" || type === "status") {
    const option = optionById(property, String(value));
    return option ? (
      <OptionPill option={option} />
    ) : (
      <span>{String(value)}</span>
    );
  }

  if (type === "multi_select" && Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-muted-foreground/70">{empty}</span>;
    return (
      <span className="inline-flex flex-wrap gap-1">
        {value.map((id) => {
          const option = optionById(property, id);
          return option ? <OptionPill key={id} option={option} /> : null;
        })}
      </span>
    );
  }

  if (type === "url" && typeof value === "string") {
    return (
      <span className="underline decoration-muted-foreground/40 underline-offset-2">
        {value}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

function OptionPill({ option }: { option: DocumentPropertyOption }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs font-medium",
        optionClass(option),
      )}
    >
      <span className="truncate">{option.name}</span>
    </span>
  );
}

export function personLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Empty";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ? emailToName(trimmed)
    : trimmed;
}

export function personItems(value: DocumentProperty["value"]) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : [];
  const seen = new Set<string>();
  return rawItems
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function personInitials(value: string) {
  const label = personLabel(value);
  const parts = label.split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function PersonPill({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-background text-[9px] font-semibold text-muted-foreground">
        {personInitials(value)}
      </span>
      <span className="truncate">{personLabel(value)}</span>
    </span>
  );
}

export function placeLabel(value: string) {
  return value.trim() || "Empty";
}

function PlacePill({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
      <IconMapPin className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{placeLabel(value)}</span>
    </span>
  );
}

export function filesMediaItems(value: DocumentProperty["value"]) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function filesMediaEditorValue(value: DocumentProperty["value"]) {
  return filesMediaItems(value).join("\n");
}

export function filesMediaLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "File";
  try {
    const url = new URL(trimmed);
    const pathParts = url.pathname.split("/").filter(Boolean);
    return decodeURIComponent(pathParts[pathParts.length - 1] || url.hostname);
  } catch {
    const pathParts = trimmed.split("/").filter(Boolean);
    return pathParts[pathParts.length - 1] || trimmed;
  }
}

export function filesMediaKind(value: string) {
  const label = filesMediaLabel(value).toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/.test(label)) return "Image";
  if (/\.(mp4|mov|webm|m4v)$/.test(label)) return "Video";
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(label)) return "Audio";
  if (/^https?:\/\//i.test(value.trim())) return "Link";
  return "File";
}

export function relationItems(value: DocumentProperty["value"]) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
}

function FilesMediaPill({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
      <IconPaperclip className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{filesMediaLabel(value)}</span>
    </span>
  );
}

function makeOption(
  name: string,
  index: number,
  existingIds: string[],
): DocumentPropertyOption {
  const baseId = slugify(name);
  let id = baseId;
  let suffix = 2;
  while (existingIds.includes(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    name: name.trim(),
    color: OPTION_COLORS[index % OPTION_COLORS.length],
  };
}

export function filterPropertyOptions(
  options: DocumentPropertyOption[],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;
  return options.filter(
    (option) =>
      option.name.toLowerCase().includes(normalizedQuery) ||
      option.id.toLowerCase().includes(normalizedQuery),
  );
}

export function firstMatchingPropertyOption(
  options: DocumentPropertyOption[],
  query: string,
) {
  return filterPropertyOptions(options, query)[0] ?? null;
}

export function canCreatePropertyOption(
  options: DocumentPropertyOption[],
  name: string,
) {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) return false;
  return !options.some(
    (option) => option.name.trim().toLowerCase() === normalizedName,
  );
}

export function nextPropertyOption(
  name: string,
  options: DocumentPropertyOption[],
) {
  return makeOption(
    name,
    options.length,
    options.map((item) => item.id),
  );
}

export function renamePropertyOption(
  options: DocumentPropertyOption[],
  optionId: string,
  name: string,
) {
  const nextName = name.trim();
  if (!nextName) return options;
  const duplicate = options.some(
    (option) =>
      option.id !== optionId &&
      option.name.trim().toLowerCase() === nextName.toLowerCase(),
  );
  if (duplicate) return options;
  return options.map((option) =>
    option.id === optionId ? { ...option, name: nextName } : option,
  );
}

export function updatePropertyOptionColor(
  options: DocumentPropertyOption[],
  optionId: string,
  color: DocumentPropertyOptionColor,
) {
  return options.map((option) =>
    option.id === optionId ? { ...option, color } : option,
  );
}

export function removePropertyOption(
  options: DocumentPropertyOption[],
  optionId: string,
) {
  const nextOptions = options.filter((option) => option.id !== optionId);
  return nextOptions.length === options.length ? options : nextOptions;
}

export function formatPropertyDateInputValue(value: DocumentProperty["value"]) {
  return documentPropertyDateKey(value) ?? "";
}

export function formatPropertyDateEndInputValue(
  value: DocumentProperty["value"],
) {
  return documentPropertyDateKey(value, "end") ?? "";
}

export function formatPropertyDateTimeInputValue(
  value: DocumentProperty["value"],
  part: "start" | "end" = "start",
) {
  const rawValue = documentPropertyDatePart(value, part);
  const match = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (match)
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const dateKey = documentPropertyDateKey(value, part);
  return dateKey ? `${dateKey}T09:00` : "";
}

export function dateInputValueForOffset(baseDate: Date, offsetDays: number) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scalarPlaceholder(type: DocumentPropertyType, t: TFunction) {
  switch (type) {
    case "number":
      return "0";
    case "date":
      return t("editor.properties.selectDate");
    case "person":
      return t("editor.properties.personOrEmail");
    case "place":
      return t("editor.properties.cityVenueOrAddress");
    case "url":
      return "https://example.com";
    case "email":
      return "name@example.com";
    case "phone":
      return "+1 (555) 123-4567";
    default:
      return t("editor.properties.empty");
  }
}

export function DocumentProperties({
  documentId,
  canEdit,
  popoversPortalled = true,
}: DocumentPropertiesProps) {
  const t = useT();
  const { data, isLoading } = useDocumentProperties(documentId);
  // Blocks fields are rendered as body content (below the database/title), not
  // as scalar property rows in this panel — exclude them here.
  const properties = (data?.properties ?? []).filter(
    (property) => property.definition.type !== "blocks",
  );
  const databaseId = data?.databaseId ?? null;
  const visibleProperties = properties.filter(isPropertyVisible);
  const hiddenProperties = properties.filter(
    (property) => !isPropertyVisible(property),
  );

  return (
    <div className="mt-5 border-y border-transparent py-1">
      {isLoading ? (
        <div className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("editor.properties.loadingProperties")}
        </div>
      ) : visibleProperties.length > 0 ? (
        <div className="grid gap-0.5">
          {visibleProperties.map((property) => (
            <PropertyRow
              key={property.definition.id}
              property={property}
              documentId={documentId}
              canEdit={canEdit}
              popoversPortalled={popoversPortalled}
              t={t}
            />
          ))}
        </div>
      ) : null}

      {canEdit && hiddenProperties.length > 0 ? (
        <HiddenPropertiesMenu
          documentId={documentId}
          properties={hiddenProperties}
          t={t}
        />
      ) : null}

      {canEdit && databaseId ? (
        <AddProperty
          documentId={documentId}
          popoversPortalled={popoversPortalled}
        />
      ) : null}
    </div>
  );
}

function isPropertyVisible(property: DocumentProperty) {
  const visibility = property.definition.visibility;
  if (visibility === "always_hide") return false;
  if (visibility === "hide_when_empty") {
    return !isEmptyPropertyValue(property.value);
  }
  return true;
}

function HiddenPropertiesMenu({
  documentId,
  properties,
  t,
}: {
  documentId: string;
  properties: DocumentProperty[];
  t: TFunction;
}) {
  const configure = useConfigureDocumentProperty(documentId);

  async function showProperty(property: DocumentProperty) {
    await configure.mutateAsync({
      id: property.definition.id,
      documentId,
      name: property.definition.name,
      type: property.definition.type,
      visibility: "always_show",
      options: property.definition.options,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-1 flex h-8 items-center gap-2 rounded px-1 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <IconEyeOff className="size-4" />
          {t("editor.properties.hiddenProperties")}
          <span className="text-xs text-muted-foreground/70">
            {properties.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {properties.map((property) => {
          const Icon = TYPE_ICONS[property.definition.type];
          return (
            <DropdownMenuItem
              key={property.definition.id}
              disabled={configure.isPending}
              onSelect={(event) => {
                event.preventDefault();
                void showProperty(property);
              }}
            >
              <Icon className="mr-2 size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {property.definition.name}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {t("editor.properties.show")}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PropertyRow({
  property,
  documentId,
  canEdit,
  popoversPortalled,
  t,
}: {
  property: DocumentProperty;
  documentId: string;
  canEdit: boolean;
  popoversPortalled: boolean;
  t: TFunction;
}) {
  const Icon = TYPE_ICONS[property.definition.type];
  const value = (
    <div className="min-w-0 flex-1 truncate text-left text-sm">
      {displayValue(property, t)}
    </div>
  );

  return (
    <div className="grid min-h-8 grid-cols-[160px_minmax(0,1fr)] items-start gap-3 rounded px-1 py-1 text-sm hover:bg-muted/40">
      {canEdit ? (
        <PropertyManagementPopover
          property={property}
          documentId={documentId}
          icon={Icon}
        />
      ) : (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{property.definition.name}</span>
        </div>
      )}
      {canEdit && property.editable ? (
        <PropertyValuePopover
          property={property}
          documentId={documentId}
          portalled={popoversPortalled}
        >
          {value}
        </PropertyValuePopover>
      ) : (
        value
      )}
    </div>
  );
}

// Mirror of the server's propertyTypeForSourceField — keep in sync. Used to
// gate which source fields can bind into a column (type compatibility).
export function propertyTypeForSourceFieldType(
  sourceFieldType: string,
): DocumentPropertyType {
  const normalized = sourceFieldType.trim().toLowerCase();
  if (normalized === "number") return "number";
  if (normalized === "datetime" || normalized === "date") {
    return "date";
  }
  if (normalized === "url") return "url";
  if (normalized === "boolean" || normalized === "checkbox") {
    return "checkbox";
  }
  if (normalized === "tags" || normalized === "multi_select") {
    return "multi_select";
  }
  return "text";
}

export function PropertyManagementPopover({
  property,
  documentId,
  icon: Icon,
  triggerClassName,
  onTriggerPointerDown,
  triggerTrailing,
  sourceField,
  sourceAttached = false,
  sources,
}: {
  property: DocumentProperty;
  documentId: string;
  icon: Icon;
  triggerClassName?: string;
  onTriggerPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  triggerTrailing?: ReactNode;
  sourceField?: ContentDatabaseSource["fields"][number] | null;
  sourceAttached?: boolean;
  sources?: ContentDatabaseSource[];
}) {
  const t = useT();
  const configure = useConfigureDocumentProperty(documentId);
  const duplicate = useDuplicateDocumentProperty(documentId);
  const remove = useDeleteDocumentProperty(documentId);
  const { data: propertiesData } = useDocumentProperties(documentId);
  const bindQueryClient = useQueryClient();
  const bindSourceField = useActionMutation<
    ContentDatabaseResponse,
    BindContentDatabaseSourceFieldRequest
  >("bind-content-database-source-field", {
    onSuccess: () => {
      bindQueryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      bindQueryClient.invalidateQueries({
        queryKey: ["action", "list-document-properties", { documentId }],
      });
    },
  });
  // Per-source field bindings for THIS column (row-union): which source fields
  // feed it, and which unmapped, type-compatible fields could be bound into it
  // (at most one field per source per column).
  const allSourceFieldEntries = (sources ?? []).flatMap((src) =>
    src.fields.map((field) => ({ source: src, field })),
  );
  const boundSourceFields = allSourceFieldEntries.filter(
    (entry) => entry.field.propertyId === property.definition.id,
  );
  const boundSourceIds = new Set(boundSourceFields.map((b) => b.source.id));
  const columnType = property.definition.type;
  const bindableSourceFields = allSourceFieldEntries.filter((entry) => {
    if (
      entry.field.propertyId ||
      entry.field.mappingType === "title" ||
      entry.field.mappingType === "system" ||
      entry.field.writeOwner === "derived" ||
      boundSourceIds.has(entry.source.id)
    ) {
      return false;
    }
    const fieldIsMultiValue = [
      "list",
      "array",
      "tags",
      "multi_select",
    ].includes(entry.field.sourceFieldType.trim().toLowerCase());
    // text columns accept any SCALAR field but not multi-value ones (lossy);
    // otherwise the derived type must match the column type.
    return columnType === "text"
      ? !fieldIsMultiValue
      : columnType ===
          propertyTypeForSourceFieldType(entry.field.sourceFieldType);
  });
  const showBindingEditor =
    !isComputedPropertyType(columnType) &&
    columnType !== "blocks" &&
    (boundSourceFields.length > 0 || bindableSourceFields.length > 0);
  // Whether deleting THIS property removes the last Blocks field of the type —
  // i.e. the body. Drives the yellow warning in the delete dialog.
  const blocksFieldCount = (propertiesData?.properties ?? []).filter(
    (item) => item.definition.type === "blocks",
  ).length;
  const isOnlyBlocksField = isOnlyBlocksFieldDeletion({
    type: property.definition.type,
    blocksFieldCount,
  });
  const [open, setOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [name, setName] = useState(property.definition.name);
  const [newOption, setNewOption] = useState("");
  const propertyNameInputRef = useRef<HTMLInputElement>(null);
  const typeIsLocked = isComputedPropertyType(property.definition.type);
  const typeNeedsOptions =
    property.definition.type === "select" ||
    property.definition.type === "status" ||
    property.definition.type === "multi_select";

  function resetDraft() {
    setName(property.definition.name);
    setNewOption("");
  }

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      propertyNameInputRef.current?.focus();
      propertyNameInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  async function configureProperty(next: {
    name?: string;
    type?: DocumentPropertyType;
    visibility?: DocumentPropertyVisibility;
    options?: DocumentProperty["definition"]["options"];
  }) {
    const nextType = next.type ?? property.definition.type;
    await configure.mutateAsync({
      id: property.definition.id,
      documentId,
      name: next.name?.trim() || property.definition.name,
      type: nextType,
      visibility: next.visibility,
      options: next.options ?? property.definition.options,
    });
  }

  async function renameProperty() {
    const nextName = name.trim();
    if (!nextName || nextName === property.definition.name) return;
    await configureProperty({ name: nextName });
  }

  async function updateType(nextType: DocumentPropertyType) {
    if (nextType === property.definition.type) return;
    await configureProperty({
      type: nextType,
      options: defaultPropertyOptions(nextType),
    });
    setOpen(false);
  }

  async function updateVisibility(nextVisibility: DocumentPropertyVisibility) {
    if (nextVisibility === property.definition.visibility) return;
    await configureProperty({ visibility: nextVisibility });
    setOpen(false);
  }

  async function duplicateProperty() {
    await duplicate.mutateAsync({
      documentId,
      propertyId: property.definition.id,
    });
    setOpen(false);
  }

  async function deleteProperty() {
    await remove.mutateAsync({
      documentId,
      propertyId: property.definition.id,
    });
    setOpen(false);
  }

  async function addOption() {
    const optionName = newOption.trim();
    if (!optionName) return;
    const existing = property.definition.options.options ?? [];
    const option = makeOption(
      optionName,
      existing.length,
      existing.map((item) => item.id),
    );
    await configureProperty({
      options: { options: [...existing, option] },
    });
    setNewOption("");
  }

  async function removeOption(id: string) {
    await configureProperty({
      options: {
        options: (property.definition.options.options ?? []).filter(
          (option) => option.id !== id,
        ),
      },
    });
  }

  async function renameOption(id: string, optionName: string) {
    const options = property.definition.options.options ?? [];
    const nextOptions = renamePropertyOption(options, id, optionName);
    if (nextOptions === options) return;
    await configureProperty({ options: { options: nextOptions } });
  }

  async function recolorOption(id: string, color: DocumentPropertyOptionColor) {
    const options = property.definition.options.options ?? [];
    const nextOptions = updatePropertyOptionColor(options, id, color);
    await configureProperty({ options: { options: nextOptions } });
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) resetDraft();
          setOpen(nextOpen);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("editor.properties.propertyMenuFor", {
              name: property.definition.name,
            })}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              triggerClassName,
            )}
            onPointerDown={onTriggerPointerDown}
            onClick={
              onTriggerPointerDown
                ? (event) => {
                    event.preventDefault();
                    resetDraft();
                    setOpen(true);
                  }
                : undefined
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{property.definition.name}</span>
            {triggerTrailing}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={12}
          className="relative z-[300] w-72"
        >
          <div
            className="flex items-center gap-2 p-1"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <IconEdit className="size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={propertyNameInputRef}
              value={name}
              aria-label={t("editor.properties.propertyName")}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void renameProperty()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="h-8"
            />
          </div>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon className="mr-2 size-4 text-muted-foreground" />
              <span className="flex-1">{t("editor.properties.type")}</span>
              <span className="mr-2 text-muted-foreground">
                {t(`editor.propertyTypes.${property.definition.type}`)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-auto">
              {CREATABLE_DOCUMENT_PROPERTY_TYPES.map((propertyType) => {
                const TypeIcon = TYPE_ICONS[propertyType];
                const selected = property.definition.type === propertyType;
                const disabled = typeIsLocked && !selected;
                return (
                  <DropdownMenuItem
                    key={propertyType}
                    disabled={disabled}
                    onSelect={(event) => {
                      event.preventDefault();
                      void updateType(propertyType);
                    }}
                  >
                    <TypeIcon className="mr-2 size-4 text-muted-foreground" />
                    <span className="flex-1">
                      {t(`editor.propertyTypes.${propertyType}`)}
                    </span>
                    {selected ? (
                      <IconCheck className="size-4 text-muted-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconEye className="mr-2 size-4 text-muted-foreground" />
              <span className="flex-1">
                {t("editor.properties.visibility")}
              </span>
              <span className="mr-2 text-muted-foreground">
                {t(
                  `editor.propertyVisibility.${property.definition.visibility}`,
                )}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {DOCUMENT_PROPERTY_VISIBILITIES.map((visibility) => (
                <DropdownMenuItem
                  key={visibility}
                  onSelect={(event) => {
                    event.preventDefault();
                    void updateVisibility(visibility);
                  }}
                >
                  <span className="flex-1">
                    {t(`editor.propertyVisibility.${visibility}`)}
                  </span>
                  {property.definition.visibility === visibility ? (
                    <IconCheck className="size-4 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {typeNeedsOptions ? (
            <div className="grid gap-2 px-1 py-2">
              <div className="px-1 text-xs font-medium text-muted-foreground">
                {t("editor.properties.options")}
              </div>
              <div className="grid gap-1">
                {(property.definition.options.options ?? []).map((option) => (
                  <PropertyOptionSettingsRow
                    key={option.id}
                    option={option}
                    disabled={configure.isPending}
                    onRename={(name) => void renameOption(option.id, name)}
                    onColorChange={(color) =>
                      void recolorOption(option.id, color)
                    }
                    onRemove={() => void removeOption(option.id)}
                  />
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addOption();
                }}
              >
                <Input
                  value={newOption}
                  placeholder={t("editor.properties.addOption")}
                  onChange={(event) => setNewOption(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="h-8"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={!newOption.trim() || configure.isPending}
                >
                  {t("editor.properties.add")}
                </Button>
              </form>
            </div>
          ) : null}

          {showBindingEditor ? (
            <>
              <DropdownMenuSeparator />
              <div className="grid gap-1.5 px-2 py-1.5 text-xs">
                <div className="font-medium text-foreground">
                  {t("database.sourcesFeedingThisColumn")}
                </div>
                {boundSourceFields.length > 0 ? (
                  <div className="grid gap-1">
                    {boundSourceFields.map(({ source: src, field }) => (
                      <div
                        key={field.id}
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        <IconLink className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          <span className="text-foreground">
                            {src.sourceName}
                          </span>{" "}
                          · {field.sourceFieldLabel}
                        </span>
                        <button
                          type="button"
                          aria-label={`Unbind ${field.sourceFieldLabel} from ${src.sourceName}`}
                          disabled={bindSourceField.isPending}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          onClick={() =>
                            void bindSourceField.mutateAsync({
                              documentId,
                              sourceFieldId: field.id,
                              propertyId: null,
                            })
                          }
                        >
                          <IconX className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    {t("database.noSourceFieldsBoundYet")}
                  </div>
                )}
                {bindableSourceFields.length > 0 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="mt-0.5 rounded px-1.5 py-1 text-xs">
                      <IconPlus className="mr-1.5 size-3.5 text-muted-foreground" />
                      {t("database.bindAFieldFromASource")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 w-64 overflow-auto">
                      {bindableSourceFields.map(({ source: src, field }) => (
                        <DropdownMenuItem
                          key={field.id}
                          disabled={bindSourceField.isPending}
                          onSelect={(event) => {
                            event.preventDefault();
                            void bindSourceField.mutateAsync({
                              documentId,
                              sourceFieldId: field.id,
                              propertyId: property.definition.id,
                            });
                          }}
                        >
                          <IconLink className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {field.sourceFieldLabel}
                          </span>
                          <span className="ml-2 shrink-0 truncate text-[11px] text-muted-foreground">
                            {src.sourceName}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
              </div>
            </>
          ) : sourceAttached ? (
            <>
              <DropdownMenuSeparator />
              <div className="grid gap-1 px-2 py-1.5 text-xs">
                <div className="font-medium text-foreground">
                  {t("editor.properties.source")}
                </div>
                {sourceField ? (
                  <>
                    <div className="min-w-0 break-words text-muted-foreground">
                      {sourceField.sourceFieldLabel} (
                      {sourceField.sourceFieldKey})
                    </div>
                    <div className="text-muted-foreground">
                      {sourceField.readOnly
                        ? t("editor.properties.readOnly")
                        : sourceField.writeOwner === "source"
                          ? t("editor.properties.sourceOwned")
                          : t("editor.properties.localEditsAllowed")}
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground">
                    {t("editor.properties.notMappedToBuilder")}
                  </div>
                )}
              </div>
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={duplicate.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void duplicateProperty();
            }}
          >
            <IconCopy className="mr-2 size-4 text-muted-foreground" />
            {t("editor.properties.duplicateProperty")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={remove.isPending}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setOpen(false);
              setConfirmDeleteOpen(true);
            }}
          >
            <IconTrash className="mr-2 size-4" />
            {t("editor.properties.deleteProperty")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent className="max-w-sm gap-0 rounded-lg p-5">
          <AlertDialogHeader className="space-y-0 gap-1.5 text-start">
            <AlertDialogTitle className="text-base leading-tight tracking-tight">
              {t("editor.properties.deletePropertyQuestion")}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-normal [text-wrap:pretty]">
              {t("editor.properties.deletePropertyDescriptionPrefix")}
              <span className="font-medium text-foreground">
                {property.definition.name}
              </span>
              {t("editor.properties.deletePropertyDescriptionSuffix")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isOnlyBlocksField ? (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
              {t("editor.properties.onlyBlocksPropertyWarning")}
            </div>
          ) : null}
          <AlertDialogFooter className="mt-4 flex-row items-center justify-end gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-8 px-3 focus-visible:ring-1 focus-visible:ring-muted-foreground/40 focus-visible:ring-offset-1">
              {t("editor.properties.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-8 bg-destructive px-3 text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-1 focus-visible:ring-muted-foreground/40 focus-visible:ring-offset-1"
              onClick={() => void deleteProperty()}
            >
              {t("editor.properties.deleteProperty")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PropertyOptionSettingsRow({
  option,
  disabled,
  onRename,
  onColorChange,
  onRemove,
}: {
  option: DocumentPropertyOption;
  disabled: boolean;
  onRename: (name: string) => void;
  onColorChange: (color: DocumentPropertyOptionColor) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [draftName, setDraftName] = useState(option.name);

  useEffect(() => {
    setDraftName(option.name);
  }, [option.name]);

  function submitRename() {
    const nextName = draftName.trim();
    if (!nextName) {
      setDraftName(option.name);
      return;
    }
    if (nextName !== option.name) {
      onRename(nextName);
    }
  }

  return (
    <div className="grid gap-1 rounded px-2 py-1 hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn("size-3 shrink-0 rounded-full", optionClass(option))}
        />
        <Input
          value={draftName}
          disabled={disabled}
          aria-label={t("editor.properties.renameOption", {
            name: option.name,
          })}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={submitRename}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              submitRename();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraftName(option.name);
              event.currentTarget.blur();
            }
          }}
          className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:bg-background focus-visible:ring-1"
        />
      </div>
      <div className="flex items-center justify-between gap-2 pl-5">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={disabled}
            className="h-7 rounded px-1.5 text-xs text-muted-foreground"
          >
            <IconPalette className="mr-1.5 size-3.5" />
            {t("editor.properties.color")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {OPTION_COLORS.map((color) => (
              <DropdownMenuItem
                key={color}
                onSelect={(event) => {
                  event.preventDefault();
                  onColorChange(color);
                }}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mr-2 size-3 rounded-full",
                    OPTION_COLOR_CLASSES[color],
                  )}
                />
                <span className="flex-1 capitalize">
                  {t(`editor.propertyOptionColors.${color}`)}
                </span>
                {option.color === color ? (
                  <IconCheck className="size-4 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <button
          type="button"
          aria-label={t("editor.properties.removeOption", {
            name: option.name,
          })}
          disabled={disabled}
          className="h-7 rounded px-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
          onClick={onRemove}
        >
          {t("editor.properties.remove")}
        </button>
      </div>
    </div>
  );
}

export function PropertyValuePopover({
  property,
  documentId,
  databaseDocumentId = documentId,
  children,
  portalled = true,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId?: string;
  children: React.ReactNode;
  portalled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("editor.properties.editProperty", {
            name: property.definition.name,
          })}
          className="flex min-h-6 w-full min-w-0 items-center rounded px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" portalled={portalled} className="w-80 p-2">
        <PropertyValueEditor
          property={property}
          documentId={documentId}
          databaseDocumentId={databaseDocumentId}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function PropertyValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const type = property.definition.type;
  if (type === "select" || type === "status" || type === "multi_select") {
    return (
      <OptionValueEditor
        property={property}
        documentId={documentId}
        databaseDocumentId={databaseDocumentId}
        onDone={onDone}
      />
    );
  }

  if (type === "checkbox") {
    return (
      <CheckboxValueEditor
        property={property}
        documentId={documentId}
        databaseDocumentId={databaseDocumentId}
        onDone={onDone}
      />
    );
  }

  if (type === "date") {
    return (
      <DateValueEditor
        property={property}
        documentId={documentId}
        databaseDocumentId={databaseDocumentId}
        onDone={onDone}
      />
    );
  }

  if (type === "person") {
    return (
      <PersonValueEditor
        property={property}
        documentId={documentId}
        databaseDocumentId={databaseDocumentId}
        onDone={onDone}
      />
    );
  }

  if (type === "files_media") {
    return (
      <FilesMediaValueEditor
        property={property}
        documentId={documentId}
        databaseDocumentId={databaseDocumentId}
        onDone={onDone}
      />
    );
  }

  return (
    <ScalarValueEditor
      property={property}
      documentId={documentId}
      databaseDocumentId={databaseDocumentId}
      onDone={onDone}
    />
  );
}

function PersonValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const mutation = useSetDocumentProperty(documentId, databaseDocumentId);
  const { session } = useSession();
  const [people, setPeople] = useState(() => personItems(property.value));
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUserEmail = session?.email?.trim() ?? "";
  const currentUserLabel = currentUserEmail
    ? personLabel(currentUserEmail)
    : "";

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  function addPerson(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setPeople((current) => {
      if (
        current.some((person) => person.toLowerCase() === trimmed.toLowerCase())
      ) {
        return current;
      }
      return [...current, trimmed];
    });
    setQuery("");
  }

  function removePerson(value: string) {
    setPeople((current) =>
      current.filter((person) => person.toLowerCase() !== value.toLowerCase()),
    );
  }

  async function save(nextPeople = people) {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: nextPeople.length > 0 ? nextPeople : null,
    });
    onDone();
  }

  async function clear() {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: null,
    });
    onDone();
  }

  const filteredPeople = people.filter((person) =>
    personLabel(person).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const canAddQuery = query.trim().length > 0;
  const canAddMe =
    !!currentUserEmail &&
    !people.some(
      (person) => person.toLowerCase() === currentUserEmail.toLowerCase(),
    );

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (query.trim()) {
          addPerson(query);
          return;
        }
        void save();
      }}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1.5">
        {people.map((person) => (
          <span
            key={person}
            className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium"
          >
            <PersonPill value={person} />
            <button
              type="button"
              aria-label={t("editor.properties.removePerson", {
                name: personLabel(person),
              })}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => removePerson(person)}
            >
              <IconX className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          aria-label={t("editor.properties.addPropertyPerson", {
            name: property.definition.name,
          })}
          value={query}
          placeholder={
            people.length === 0
              ? t("editor.properties.searchOrAddPerson")
              : t("editor.properties.add")
          }
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            }
          }}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="grid gap-1">
        {canAddMe ? (
          <button
            type="button"
            className="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => addPerson(currentUserEmail)}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <PersonPill value={currentUserEmail} />
              <span className="truncate text-muted-foreground">
                {currentUserEmail}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t("editor.properties.me")}
            </span>
          </button>
        ) : null}
        {filteredPeople.length > 0 && query.trim() ? (
          <div className="px-2 pt-1 text-xs text-muted-foreground">
            {t("editor.properties.selected")}
          </div>
        ) : null}
        {query.trim()
          ? filteredPeople.map((person) => (
              <button
                type="button"
                key={person}
                className="flex items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => setQuery(person)}
              >
                <PersonPill value={person} />
              </button>
            ))
          : null}
        {canAddQuery ? (
          <button
            type="button"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => addPerson(query)}
          >
            <IconPlus className="size-4 text-muted-foreground" />
            <span>
              {t("editor.properties.addQuoted", { value: query.trim() })}
            </span>
          </button>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={mutation.isPending}
        >
          {t("editor.properties.clear")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("editor.properties.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => void save()}
        >
          {t("editor.properties.save")}
        </Button>
      </div>
    </form>
  );
}

function FilesMediaValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const mutation = useSetDocumentProperty(documentId, databaseDocumentId);
  const [items, setItems] = useState(() => filesMediaItems(property.value));
  const [linkValue, setLinkValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      linkInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function addItem(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setItems((current) => {
      if (
        current.some((item) => item.toLowerCase() === trimmed.toLowerCase())
      ) {
        return current;
      }
      return [...current, trimmed];
    });
    setLinkValue("");
  }

  function removeItem(value: string) {
    setItems((current) => current.filter((item) => item !== value));
  }

  async function save(nextItems = items) {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: nextItems.length > 0 ? nextItems : null,
    });
    onDone();
  }

  async function clear() {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: null,
    });
    onDone();
  }

  async function uploadFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    setUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of selectedFiles) {
        uploadedUrls.push(await uploadImageFile(file));
      }
      setItems((current) => [...current, ...uploadedUrls]);
      toast.success(
        t(
          uploadedUrls.length === 1
            ? "editor.properties.imageUploaded_one"
            : "editor.properties.imageUploaded_other",
          { count: uploadedUrls.length },
        ),
      );
    } catch (error) {
      toast.error(imageUploadErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (linkValue.trim()) {
          addItem(linkValue);
          return;
        }
        void save();
      }}
    >
      <div className="grid max-h-48 gap-1 overflow-auto">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("editor.properties.noFilesOrMedia")}
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item}
              className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                <IconPaperclip className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {filesMediaLabel(item)}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t(
                    `editor.properties.filesMediaKinds.${filesMediaKind(item).toLowerCase()}`,
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label={t("editor.properties.removeFileOrMedia", {
                  name: filesMediaLabel(item),
                })}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => removeItem(item)}
              >
                <IconX className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-1">
        <Input
          ref={linkInputRef}
          aria-label={t("editor.properties.addPropertyLink", {
            name: property.definition.name,
          })}
          value={linkValue}
          placeholder={t("editor.properties.pasteFileOrMediaLink")}
          onChange={(event) => setLinkValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => addItem(linkValue)}
          disabled={!linkValue.trim() || mutation.isPending}
        >
          <IconPlus className="size-3.5" />
          {t("editor.properties.add")}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => void uploadFiles(event.currentTarget.files)}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={mutation.isPending || uploading}
        >
          <IconUpload className="size-3.5" />
          {t("editor.properties.upload")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={mutation.isPending || uploading}
        >
          {t("editor.properties.clear")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("editor.properties.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending || uploading}
        >
          {t("editor.properties.save")}
        </Button>
      </div>
    </form>
  );
}

function DateValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const mutation = useSetDocumentProperty(documentId, databaseDocumentId);
  const [includeTime, setIncludeTime] = useState(
    documentPropertyDateIncludesTime(property.value),
  );
  const [startValue, setStartValue] = useState(
    documentPropertyDateIncludesTime(property.value)
      ? formatPropertyDateTimeInputValue(property.value)
      : formatPropertyDateInputValue(property.value),
  );
  const [endValue, setEndValue] = useState(
    documentPropertyDateIncludesTime(property.value)
      ? formatPropertyDateTimeInputValue(property.value, "end")
      : formatPropertyDateEndInputValue(property.value),
  );
  const dateValueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      dateValueInputRef.current?.focus();
      dateValueInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function buildValue(
    nextStartValue = startValue,
    nextEndValue = endValue,
    nextIncludeTime = includeTime,
  ): DocumentPropertyDateValue | null {
    return normalizeDatePropertyValue({
      start: nextStartValue,
      end: nextEndValue || null,
      includeTime: nextIncludeTime,
    });
  }

  async function save(nextValue = buildValue()) {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: nextValue,
    });
    onDone();
  }

  async function clear() {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: null,
    });
    onDone();
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 justify-start gap-1.5"
          disabled={mutation.isPending}
          onClick={() =>
            void save({
              start: includeTime
                ? `${dateInputValueForOffset(new Date(), 0)}T09:00`
                : dateInputValueForOffset(new Date(), 0),
              includeTime,
            })
          }
        >
          <IconCalendar className="size-3.5" />
          {t("editor.properties.today")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 justify-start gap-1.5"
          disabled={mutation.isPending}
          onClick={() =>
            void save({
              start: includeTime
                ? `${dateInputValueForOffset(new Date(), 1)}T09:00`
                : dateInputValueForOffset(new Date(), 1),
              includeTime,
            })
          }
        >
          <IconCalendar className="size-3.5" />
          {t("editor.properties.tomorrow")}
        </Button>
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {t("editor.properties.start")}
        <Input
          ref={dateValueInputRef}
          aria-label={t("editor.properties.editStartDate", {
            name: property.definition.name,
          })}
          autoFocus
          name="property-start-value"
          type={includeTime ? "datetime-local" : "date"}
          value={startValue}
          placeholder={t("editor.properties.selectDate")}
          onChange={(event) => setStartValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            }
          }}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {t("editor.properties.end")}
        <div className="flex gap-1">
          <Input
            aria-label={t("editor.properties.editEndDate", {
              name: property.definition.name,
            })}
            name="property-end-value"
            type={includeTime ? "datetime-local" : "date"}
            value={endValue}
            placeholder={t("editor.properties.optional")}
            onChange={(event) => setEndValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onDone();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setEndValue("")}
            disabled={!endValue || mutation.isPending}
          >
            {t("editor.properties.clear")}
          </Button>
        </div>
      </label>
      <label className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm">
        <input
          type="checkbox"
          checked={includeTime}
          onChange={(event) => {
            const nextIncludeTime = event.target.checked;
            setIncludeTime(nextIncludeTime);
            if (nextIncludeTime) {
              setStartValue((current) =>
                current.includes("T")
                  ? current
                  : current
                    ? `${current}T09:00`
                    : "",
              );
              setEndValue((current) =>
                current.includes("T")
                  ? current
                  : current
                    ? `${current}T17:00`
                    : "",
              );
            } else {
              setStartValue((current) => current.slice(0, 10));
              setEndValue((current) => current.slice(0, 10));
            }
          }}
        />
        {t("editor.properties.includeTime")}
      </label>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={mutation.isPending}
        >
          {t("editor.properties.clear")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("editor.properties.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {t("editor.properties.save")}
        </Button>
      </div>
    </form>
  );
}

function ScalarValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const mutation = useSetDocumentProperty(documentId, databaseDocumentId);
  const type = property.definition.type;
  const inputType =
    type === "number"
      ? "number"
      : type === "date"
        ? "date"
        : type === "email"
          ? "email"
          : type === "url"
            ? "url"
            : type === "phone"
              ? "tel"
              : "text";
  const initialValue =
    type === "date" && typeof property.value === "string"
      ? property.value.slice(0, 10)
      : property.value === null || Array.isArray(property.value)
        ? ""
        : String(property.value);
  const [value, setValue] = useState(initialValue);
  const scalarValueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scalarValueInputRef.current?.focus();
      scalarValueInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function save(nextValue = value) {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: nextValue,
    });
    onDone();
  }

  async function clear() {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: null,
    });
    onDone();
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const formValue = formData.get("property-value");
        void save(typeof formValue === "string" ? formValue : value);
      }}
    >
      <Input
        ref={scalarValueInputRef}
        aria-label={t("editor.properties.editValue", {
          name: property.definition.name,
        })}
        autoFocus
        name="property-value"
        type={inputType}
        value={value}
        placeholder={scalarPlaceholder(type, t)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={mutation.isPending}
        >
          {t("editor.properties.clear")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("editor.properties.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {t("editor.properties.save")}
        </Button>
      </div>
    </form>
  );
}

function CheckboxValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const mutation = useSetDocumentProperty(documentId, databaseDocumentId);
  const checked = Boolean(property.value);

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm hover:bg-accent"
      onClick={async () => {
        await mutation.mutateAsync({
          documentId,
          propertyId: property.definition.id,
          value: !checked,
        });
        onDone();
      }}
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded border",
          checked && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {checked ? <IconCheck className="size-3" /> : null}
      </span>
      {checked ? t("editor.properties.uncheck") : t("editor.properties.check")}
    </button>
  );
}

function OptionValueEditor({
  property,
  documentId,
  databaseDocumentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  databaseDocumentId: string;
  onDone: () => void;
}) {
  const t = useT();
  const setValue = useSetDocumentProperty(documentId, databaseDocumentId);
  const configure = useConfigureDocumentProperty(
    documentId,
    databaseDocumentId,
  );
  const options = property.definition.options.options ?? [];
  const [optionQuery, setOptionQuery] = useState("");
  const filteredOptions = filterPropertyOptions(options, optionQuery);
  const firstFilteredOption = firstMatchingPropertyOption(options, optionQuery);
  const canCreateOption = canCreatePropertyOption(options, optionQuery);
  const optionSearchInputRef = useRef<HTMLInputElement>(null);
  const currentSelectedIds = useMemo(() => {
    if (property.definition.type === "multi_select") {
      return Array.isArray(property.value) ? property.value : [];
    }
    return typeof property.value === "string" ? [property.value] : [];
  }, [property.definition.type, property.value]);
  const [selectedIds, setSelectedIds] = useState(currentSelectedIds);

  function queueOptionSearchFocus() {
    const frame = requestAnimationFrame(() => {
      optionSearchInputRef.current?.focus();
      optionSearchInputRef.current?.select();
    });
    return frame;
  }

  useEffect(() => {
    const frame = queueOptionSearchFocus();
    return () => cancelAnimationFrame(frame);
  }, []);

  async function setSelected(next: string | string[]) {
    setSelectedIds(Array.isArray(next) ? next : next ? [next] : []);
    await setValue.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: next,
    });
    if (property.definition.type !== "multi_select") onDone();
  }

  async function addOption(name = optionQuery) {
    name = name.trim();
    if (!name) return;
    const option = nextPropertyOption(name, options);
    const nextOptions = [...options, option];
    await configure.mutateAsync({
      id: property.definition.id,
      documentId,
      name: property.definition.name,
      type: property.definition.type,
      options: { options: nextOptions },
    });
    setOptionQuery("");
    if (property.definition.type === "multi_select") {
      await setSelected([...selectedIds, option.id]);
      queueOptionSearchFocus();
    } else {
      await setSelected(option.id);
    }
  }

  async function chooseOption(option: DocumentPropertyOption) {
    if (property.definition.type === "multi_select") {
      const checked = selectedIds.includes(option.id);
      const next = checked
        ? selectedIds.filter((id) => id !== option.id)
        : [...selectedIds, option.id];
      await setSelected(next);
      queueOptionSearchFocus();
    } else {
      await setSelected(option.id);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex h-8 items-center gap-1 rounded border border-border bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={optionSearchInputRef}
          autoFocus
          value={optionQuery}
          placeholder={t("editor.properties.searchOrCreateOption")}
          aria-label={t("editor.properties.searchPropertyOptions", {
            name: property.definition.name,
          })}
          onChange={(event) => setOptionQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (firstFilteredOption) {
                void chooseOption(firstFilteredOption);
                return;
              }
              if (canCreateOption) void addOption();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            }
          }}
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="max-h-52 overflow-auto">
        {filteredOptions.length === 0 && !canCreateOption ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            {t("editor.properties.noMatchingOptions")}
          </div>
        ) : null}
        {filteredOptions.map((option) => {
          const checked = selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => void chooseOption(option)}
            >
              <OptionPill option={option} />
              {checked ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>
      {canCreateOption ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          disabled={configure.isPending || setValue.isPending}
          onClick={() => void addOption()}
        >
          <IconPlus className="mr-1.5 size-3.5" />
          {t("editor.properties.createQuoted", { value: optionQuery.trim() })}
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-start"
        disabled={setValue.isPending}
        onClick={() =>
          void setSelected(
            property.definition.type === "multi_select" ? [] : "",
          )
        }
      >
        {t("editor.properties.clearValue")}
      </Button>
    </div>
  );
}

export function AddProperty({
  documentId,
  variant = "default",
  label,
  popoversPortalled = true,
  source,
  sources,
}: {
  documentId: string;
  variant?: "default" | "header" | "icon";
  label?: string;
  popoversPortalled?: boolean;
  source?: ContentDatabaseSource | null;
  sources?: ContentDatabaseSource[];
}) {
  const t = useT();
  const configure = useConfigureDocumentProperty(documentId);
  const queryClient = useQueryClient();
  const addSourceFieldProperty = useActionMutation<
    ContentDatabaseSourceFieldPropertyResponse,
    AddContentDatabaseSourceFieldPropertyRequest
  >("add-content-database-source-field-property", {
    onSuccess: (data) => {
      queryClient.setQueriesData<ContentDatabaseResponse>(
        { queryKey: ["action", "get-content-database"] },
        (current) => applySourceFieldPropertyToDatabaseResponse(current, data),
      );
      queryClient.invalidateQueries({
        queryKey: ["action", "list-document-properties", { documentId }],
      });
    },
  });
  const [open, setOpen] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const filteredPropertyTypes = filterDocumentPropertyTypes(typeQuery);
  const firstFilteredPropertyType = filteredPropertyTypes[0] ?? null;
  const allSources =
    sources && sources.length > 0 ? sources : source ? [source] : [];
  const query = typeQuery.trim().toLowerCase();
  const sourceFieldGroups = allSources
    .map((src) => ({
      source: src,
      fields: src.fields
        .filter(
          (field) =>
            !field.propertyId &&
            field.mappingType !== "title" &&
            field.sourceFieldLabel.toLowerCase().includes(query),
        )
        .sort((a, b) => {
          if (a.mappingType === "system" && b.mappingType !== "system") {
            return 1;
          }
          if (a.mappingType !== "system" && b.mappingType === "system") {
            return -1;
          }
          return a.sourceFieldLabel.localeCompare(b.sourceFieldLabel);
        }),
    }))
    .filter((group) => group.fields.length > 0);
  const addPropertySearchInputRef = useRef<HTMLInputElement>(null);
  const addActivationRef = useRef<{ key: string; at: number } | null>(null);
  const [pendingPropertyType, setPendingPropertyType] =
    useState<DocumentPropertyType | null>(null);
  const [pendingSourceFieldId, setPendingSourceFieldId] = useState<
    string | null
  >(null);
  const [addPropertyError, setAddPropertyError] = useState<string | null>(null);
  const isAddingProperty =
    configure.isPending ||
    addSourceFieldProperty.isPending ||
    pendingPropertyType !== null ||
    pendingSourceFieldId !== null;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      addPropertySearchInputRef.current?.focus();
      addPropertySearchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function closeAddPropertyPicker() {
    if (isAddingProperty) return;
    setTypeQuery("");
    setAddPropertyError(null);
    setOpen(false);
  }

  async function add(type: DocumentPropertyType) {
    const label = t(`editor.propertyTypes.${type}`);
    setPendingPropertyType(type);
    setPendingSourceFieldId(null);
    setAddPropertyError(null);
    try {
      await configure.mutateAsync({
        documentId,
        name: label,
        type,
        options: defaultPropertyOptions(type),
      });
      setTypeQuery("");
      setOpen(false);
    } catch (error) {
      setAddPropertyError(error instanceof Error ? error.message : "");
    } finally {
      setPendingPropertyType(null);
    }
  }

  async function addFromSourceField(sourceFieldId: string) {
    setPendingSourceFieldId(sourceFieldId);
    setPendingPropertyType(null);
    setAddPropertyError(null);
    try {
      await addSourceFieldProperty.mutateAsync({
        documentId,
        sourceFieldId,
      });
      setTypeQuery("");
      setOpen(false);
    } catch (error) {
      setAddPropertyError(error instanceof Error ? error.message : "");
    } finally {
      setPendingSourceFieldId(null);
    }
  }

  function runAddPropertyActivation(key: string, action: () => void) {
    const now = Date.now();
    const previous = addActivationRef.current;
    if (previous?.key === key && now - previous.at < 750) return;
    addActivationRef.current = { key, at: now };
    action();
  }

  function activateAddPropertyItem(
    event: Pick<
      ReactMouseEvent<HTMLButtonElement>,
      "button" | "preventDefault" | "stopPropagation"
    >,
    key: string,
    action: () => void,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    runAddPropertyActivation(key, action);
  }

  function activateAddPropertyItemFromKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    key: string,
    action: () => void,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    runAddPropertyActivation(key, action);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
        } else if (!isAddingProperty) {
          closeAddPropertyPicker();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? t("editor.properties.addProperty")}
          className={cn(
            "flex h-8 items-center gap-2 rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            variant === "icon" && "size-7 justify-center px-0",
            variant === "header" && "h-7 px-2 text-xs font-medium",
            variant === "default" && "mt-1 px-1 text-sm",
          )}
        >
          <IconPlus className="size-4" />
          {variant === "default" || variant === "header"
            ? (label ?? t("editor.properties.addProperty"))
            : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={variant === "default" ? "start" : "end"}
        collisionPadding={12}
        portalled={popoversPortalled}
        className="relative z-[300] w-80 p-2"
      >
        <div className="grid gap-2">
          <div className="flex h-8 items-center gap-1 rounded border border-border bg-background px-2">
            <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={addPropertySearchInputRef}
              autoFocus
              value={typeQuery}
              placeholder={t("editor.properties.searchPropertyTypes")}
              aria-label={t("editor.properties.searchPropertyTypes")}
              onChange={(event) => setTypeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && firstFilteredPropertyType) {
                  event.preventDefault();
                  void add(firstFilteredPropertyType);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeAddPropertyPicker();
                }
              }}
              className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-80 overflow-auto rounded border p-1">
            {sourceFieldGroups.map((group) => (
              <div
                key={group.source.id}
                className="mb-1 border-b border-border pb-1"
              >
                <div className="truncate px-2 py-1 text-xs font-medium text-muted-foreground">
                  {t("editor.properties.fromSource", {
                    name: group.source.sourceName,
                  })}
                </div>
                {group.fields.map((field) => {
                  const SourceFieldIcon =
                    TYPE_ICONS[
                      propertyTypeForSourceFieldType(field.sourceFieldType)
                    ];
                  return (
                    <button
                      key={field.id}
                      type="button"
                      aria-label={t("editor.properties.sourceField", {
                        name: field.sourceFieldLabel,
                      })}
                      disabled={isAddingProperty}
                      aria-busy={pendingSourceFieldId === field.id}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                      onPointerDownCapture={(event) =>
                        activateAddPropertyItem(
                          event,
                          `source:${field.id}`,
                          () => {
                            void addFromSourceField(field.id);
                          },
                        )
                      }
                      onClick={(event) =>
                        activateAddPropertyItem(
                          event,
                          `source:${field.id}`,
                          () => {
                            void addFromSourceField(field.id);
                          },
                        )
                      }
                      onKeyDown={(event) =>
                        activateAddPropertyItemFromKeyboard(
                          event,
                          `source:${field.id}`,
                          () => {
                            void addFromSourceField(field.id);
                          },
                        )
                      }
                    >
                      {pendingSourceFieldId === field.id ? (
                        <Spinner className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <SourceFieldIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {field.sourceFieldLabel}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {group.source.metadata.federation?.role === "secondary"
                          ? t("editor.properties.federated")
                          : t("editor.properties.source")}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {filteredPropertyTypes.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                {t("editor.properties.noMatchingPropertyTypes")}
              </div>
            ) : null}
            {filteredPropertyTypes.map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  aria-label={t("editor.properties.addPropertyType", {
                    type: t(`editor.propertyTypes.${type}`),
                  })}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  disabled={isAddingProperty}
                  aria-busy={pendingPropertyType === type}
                  onPointerDownCapture={(event) =>
                    activateAddPropertyItem(event, `type:${type}`, () => {
                      void add(type);
                    })
                  }
                  onClick={(event) =>
                    activateAddPropertyItem(event, `type:${type}`, () => {
                      void add(type);
                    })
                  }
                  onKeyDown={(event) =>
                    activateAddPropertyItemFromKeyboard(
                      event,
                      `type:${type}`,
                      () => {
                        void add(type);
                      },
                    )
                  }
                >
                  {pendingPropertyType === type ? (
                    <Spinner className="size-4 text-muted-foreground" />
                  ) : (
                    <Icon className="size-4 text-muted-foreground" />
                  )}
                  <span className="flex-1">
                    {t(`editor.propertyTypes.${type}`)}
                  </span>
                  {isComputedPropertyType(type) ? (
                    <span className="text-xs text-muted-foreground">
                      {t("editor.properties.computed")}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {addPropertyError !== null ? (
              <div
                role="alert"
                className="px-2 py-1.5 text-xs text-destructive"
              >
                {t("editor.properties.addPropertyFailed")}
                {addPropertyError ? ` ${addPropertyError}` : null}
              </div>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function filterDocumentPropertyTypes(
  query: string,
  types: readonly DocumentPropertyType[] = CREATABLE_DOCUMENT_PROPERTY_TYPES,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...types];

  return types.filter((type) => {
    const label = DOCUMENT_PROPERTY_TYPE_LABELS[type].toLowerCase();
    const typeName = type.replace(/_/g, " ").toLowerCase();
    const aliases = PROPERTY_TYPE_SEARCH_ALIASES[type] ?? [];
    return (
      label.includes(normalizedQuery) ||
      typeName.includes(normalizedQuery) ||
      aliases.some((alias) => alias.includes(normalizedQuery))
    );
  });
}
