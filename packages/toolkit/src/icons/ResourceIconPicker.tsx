import {
  IconCheck,
  IconChevronRight,
  IconPhotoPlus,
  IconSearch,
} from "@tabler/icons-react";
import * as React from "react";

import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { cn } from "../utils.js";
import { loadTablerCatalog } from "./catalog.js";
import { loadEmojiCatalog, EMOJI_CATEGORIES } from "./emoji-catalog.js";
import { resourceIconColorClasses } from "./icon-colors.js";
import { useResourceIconRecents } from "./recents.js";
import { ResourceIcon } from "./ResourceIcon.js";
import { TABLER_ICON_GROUPS } from "./tabler-groups.js";
import type {
  ResourceIconColor,
  ResourceIconImage,
  ResourceIconValue,
} from "./types.js";

const colors: Array<ResourceIconColor | undefined> = [
  undefined,
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];
const columns = 7;
const rowHeight = 36;
const MAX_ICON_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ResourceIconPickerLabels {
  trigger: string;
  iconsTab: string;
  emojiTab: string;
  uploadTab: string;
  search: string;
  noResults: string;
  recents: string;
  colors: string;
  defaultColor: string;
  remove: string;
  upload: string;
  uploading: string;
  loadError?: string;
  saveError?: string;
  retry?: string;
  uploadHint?: string;
  uploadTooLarge?: string;
  allCategories?: string;
  colorNames?: Partial<Record<ResourceIconColor, string>>;
  categoryNames?: Record<string, string>;
  groupNames?: Record<string, string>;
}

export interface ResourceIconPickerProps {
  value: ResourceIconValue | null;
  onValueChange: (value: ResourceIconValue | null) => void | Promise<void>;
  labels: ResourceIconPickerLabels;
  recentValues?: readonly ResourceIconValue[];
  onRecentsChange?: (recents: ResourceIconValue[]) => void;
  uploadedImages?: readonly ResourceIconImage[];
  onUpload?: (file: File) => Promise<ResourceIconImage>;
  onUploadError?: (error: unknown) => void;
  resolveImageUrl?: (
    image: Extract<ResourceIconValue, { kind: "image" }>,
  ) => string | undefined;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  portalled?: boolean;
  container?: React.ComponentProps<typeof PopoverContent>["container"];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchored?: boolean;
  anchorElement?: HTMLElement | null;
  children?: React.ReactNode;
}

export function persistedIconValue(
  value: ResourceIconValue,
): ResourceIconValue {
  if (value.kind !== "image") return value;
  return {
    version: 1,
    kind: "image",
    assetId: value.assetId,
    authority: value.authority,
    ...(value.alt === undefined ? {} : { alt: value.alt }),
  };
}

type ChoiceItem = {
  value: ResourceIconValue;
  label: string;
  category: string;
  search: string;
};
type CatalogRow =
  | { id: string; label: string; collapsed: boolean; depth: number }
  | { items: ChoiceItem[] };
type CatalogSection = {
  id: string;
  label: string;
  categories: readonly string[];
  initiallyCollapsed?: boolean;
  children?: CatalogSection[];
};
function choiceLabel(value: ResourceIconValue) {
  return value.kind === "emoji"
    ? value.emoji
    : value.kind === "library"
      ? value.name.replaceAll("-", " ")
      : (value.alt ?? value.assetId);
}

function IconGrid({
  items,
  sections,
  labels,
  recents,
  query,
  selectedKey,
  resolveImageUrl,
  onSelect,
}: {
  items: ChoiceItem[];
  sections: CatalogSection[];
  labels: ResourceIconPickerLabels;
  recents: readonly ResourceIconValue[];
  query: string;
  selectedKey: string;
  resolveImageUrl?: ResourceIconPickerProps["resolveImageUrl"];
  onSelect: (value: ResourceIconValue) => void;
}) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () =>
      new Set(
        sections.flatMap((section) => [
          ...(section.initiallyCollapsed ? [section.id] : []),
          ...(section.children ?? [])
            .filter((child) => child.initiallyCollapsed)
            .map((child) => child.id),
        ]),
      ),
  );
  const normalized = query.trim().toLowerCase();
  const rows = React.useMemo(() => {
    const result: CatalogRow[] = [];
    const addRows = (entries: ChoiceItem[]) => {
      if (!entries.length) return;
      for (let i = 0; i < entries.length; i += columns)
        result.push({ items: entries.slice(i, i + columns) });
    };
    const addSection = (section: CatalogSection, depth = 0) => {
      const entries = items.filter((item) =>
        section.categories.includes(item.category),
      );
      if (!entries.length) return;
      result.push({
        id: section.id,
        label: section.label,
        collapsed: collapsed.has(section.id),
        depth,
      });
      if (collapsed.has(section.id)) return;
      if (section.children) {
        for (const child of section.children) addSection(child, depth + 1);
      } else addRows(entries);
    };
    if (normalized)
      addRows(
        items.filter(
          (item) =>
            (item.value.kind === "emoji" &&
              item.value.emoji === query.trim()) ||
            normalized
              .split(/\s+/u)
              .every((part) => item.search.includes(part)),
        ),
      );
    else {
      if (recents.length) {
        result.push({
          id: "recent",
          label: labels.recents,
          collapsed: collapsed.has("recent"),
          depth: 0,
        });
        if (!collapsed.has("recent"))
          addRows(
            recents.slice(0, columns).map((value) => ({
              value,
              label: choiceLabel(value),
              category: "recent",
              search: "",
            })),
          );
      }
      for (const section of sections) addSection(section);
    }
    return result;
  }, [items, sections, labels, recents, query, normalized, collapsed]);
  React.useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [normalized]);
  const maxScrollTop = Math.max(0, rows.length * rowHeight - 256);
  const first = Math.max(
    0,
    Math.floor(Math.min(scrollTop, maxScrollTop) / rowHeight) - 2,
  );
  const last = Math.min(rows.length, first + 13);
  return (
    <div
      ref={viewport}
      className="h-64 overflow-y-auto overscroll-contain px-2"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {rows.length === 0 ? (
        <p
          className="py-10 text-center text-sm text-muted-foreground"
          role="status"
        >
          {labels.noResults}
        </p>
      ) : (
        <div className="relative" style={{ height: rows.length * rowHeight }}>
          {rows.slice(first, last).map((row, index) => (
            <div
              key={first + index}
              className="absolute inset-x-0"
              style={{ top: (first + index) * rowHeight, height: rowHeight }}
            >
              {"label" in row ? (
                <button
                  type="button"
                  aria-expanded={!row.collapsed}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  className={cn(
                    "flex h-full w-full items-end gap-1 rounded px-1 pb-1 text-start text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    row.depth > 0 && "ps-4",
                  )}
                >
                  <IconChevronRight
                    aria-hidden
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      !row.collapsed && "rotate-90",
                    )}
                  />
                  {row.label}
                </button>
              ) : (
                <div className="grid h-full grid-cols-7 gap-1">
                  {row.items.map((item) => (
                    <button
                      key={JSON.stringify(item.value)}
                      type="button"
                      title={item.label}
                      aria-label={item.label}
                      aria-pressed={selectedKey === JSON.stringify(item.value)}
                      onClick={() => onSelect(item.value)}
                      className={cn(
                        "flex h-9 min-w-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selectedKey === JSON.stringify(item.value) &&
                          "bg-accent ring-1 ring-inset ring-ring",
                      )}
                    >
                      <ResourceIcon
                        value={item.value}
                        size={20}
                        resolveImageUrl={resolveImageUrl}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResourceIconPicker({
  value,
  onValueChange,
  labels,
  recentValues,
  onRecentsChange,
  uploadedImages = [],
  onUpload,
  onUploadError,
  resolveImageUrl,
  disabled,
  className,
  contentClassName,
  portalled,
  container,
  open: controlledOpen,
  onOpenChange,
  anchored,
  anchorElement,
  children,
}: ResourceIconPickerProps) {
  const [localRecents, setLocalRecents] = React.useState<ResourceIconValue[]>(
    [],
  );
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const changeOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [tab, setTab] = React.useState("icons");
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [catalog, setCatalog] = React.useState<ChoiceItem[]>([]);
  const [emoji, setEmoji] = React.useState<ChoiceItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string>();
  const [color, setColor] = React.useState<ResourceIconColor | undefined>(
    value?.kind === "library" ? value.color : undefined,
  );
  const fileInput = React.useRef<HTMLInputElement>(null);
  const saveQueue = React.useRef<Promise<void>>(Promise.resolve());
  const effectiveRecents = recentValues ?? localRecents;
  React.useEffect(() => {
    if (!open) return;
    setColor(value?.kind === "library" ? value.color : undefined);
    try {
      const parsed: unknown = JSON.parse(
        window.localStorage.getItem("agent-native.resource-icon-recents") ??
          "[]",
      );
      if (Array.isArray(parsed))
        setLocalRecents(
          parsed
            .filter(
              (entry) =>
                entry &&
                entry.version === 1 &&
                ["emoji", "library", "image"].includes(entry.kind),
            )
            .slice(0, 24)
            .map(persistedIconValue),
        );
      // coercion-ok: recents are optional browser convenience; selection does not depend on storage.
    } catch {}
  }, [open]);
  const remember = useResourceIconRecents(effectiveRecents, (next) => {
    if (recentValues === undefined) {
      setLocalRecents(next);
      try {
        window.localStorage.setItem(
          "agent-native.resource-icon-recents",
          JSON.stringify(next),
        );
      } catch {
        // coercion-ok: recents are optional browser convenience; selection does not depend on storage.
      }
    }
    onRecentsChange?.(next);
  });
  React.useEffect(() => {
    if (!open || tab === "upload") return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    const request =
      tab === "icons"
        ? loadTablerCatalog().then((entries) =>
            entries.map(
              (entry): ChoiceItem => ({
                category: entry.category,
                search: entry.search,
                label: entry.name.replaceAll("-", " "),
                value: {
                  version: 1,
                  kind: "library",
                  library: "tabler",
                  name: entry.name.endsWith("-filled")
                    ? entry.name.slice(0, -7)
                    : entry.name,
                  ...(entry.name.endsWith("-filled")
                    ? { variant: "filled" }
                    : {}),
                },
              }),
            ),
          )
        : loadEmojiCatalog().then((entries) =>
            entries.map(
              (entry): ChoiceItem => ({
                category: entry.category,
                search: entry.search,
                label: entry.label,
                value: { version: 1, kind: "emoji", emoji: entry.emoji },
              }),
            ),
          );
    void request
      .then((entries) => {
        if (active) tab === "icons" ? setCatalog(entries) : setEmoji(entries);
      })
      .catch((error) => {
        console.error("Icon catalog could not load", error);
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, tab, retry]);
  const select = async (next: ResourceIconValue | null, close = true) => {
    setSaveFailed(false);
    setUploadError(undefined);
    const persisted = next ? persistedIconValue(next) : null;
    try {
      const save = saveQueue.current.then(() => onValueChange(persisted));
      saveQueue.current = save.catch(() => {});
      await save;
      if (persisted) remember(persisted);
      if (close) changeOpen(false);
    } catch (error) {
      console.error("Icon could not be saved", error);
      setSaveFailed(true);
    }
  };
  const upload = async (file: File) => {
    if (!onUpload) return;
    if (file.size > MAX_ICON_UPLOAD_BYTES) {
      setSaveFailed(false);
      setUploadError(labels.uploadTooLarge ?? labels.saveError);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    setSaveFailed(false);
    setUploadError(undefined);
    try {
      await select(await onUpload(file));
    } catch (error) {
      setSaveFailed(true);
      onUploadError?.(error);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const coloredCatalog = React.useMemo(
    () =>
      catalog.map((item) => ({
        ...item,
        value:
          item.value.kind === "library" ? { ...item.value, color } : item.value,
      })),
    [catalog, color],
  );
  const sections: CatalogSection[] =
    tab === "icons"
      ? TABLER_ICON_GROUPS.map((group) => ({
          id: group.id,
          label: labels.groupNames?.[group.id] ?? group.label,
          categories: group.categories,
          initiallyCollapsed: category === "all",
          ...(group.id === "more"
            ? {
                children: group.categories.map((sourceCategory) => ({
                  id: sourceCategory,
                  label:
                    labels.categoryNames?.[sourceCategory] ?? sourceCategory,
                  categories: [sourceCategory],
                  initiallyCollapsed: true,
                })),
              }
            : {}),
        }))
      : EMOJI_CATEGORIES.map((sourceCategory) => ({
          id: sourceCategory,
          label: labels.categoryNames?.[sourceCategory] ?? sourceCategory,
          categories: [sourceCategory],
        }));
  const uploadChoices = [
    ...uploadedImages,
    ...effectiveRecents.filter(
      (entry): entry is ResourceIconImage => entry.kind === "image",
    ),
  ].filter(
    (entry, index, all) =>
      all.findIndex(
        (other) =>
          other.assetId === entry.assetId &&
          other.authority === entry.authority,
      ) === index,
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        changeOpen(next);
        if (next) {
          setQuery("");
          setSaveFailed(false);
          setUploadError(undefined);
        }
      }}
    >
      {anchored ? (
        anchorElement ? (
          <PopoverAnchor virtualRef={{ current: anchorElement }} />
        ) : null
      ) : (
        <PopoverTrigger asChild disabled={disabled}>
          {children ?? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={labels.trigger}
            >
              <ResourceIcon
                value={value}
                fallback={<IconPhotoPlus />}
                resolveImageUrl={resolveImageUrl}
              />
            </Button>
          )}
        </PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        collisionPadding={8}
        portalled={portalled}
        container={container}
        className={cn(
          "max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto p-0",
          className,
          contentClassName,
        )}
      >
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setTab(next);
            setQuery("");
            setCategory("all");
            setSaveFailed(false);
            setUploadError(undefined);
          }}
        >
          <div className="p-2">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="icons">{labels.iconsTab}</TabsTrigger>
              <TabsTrigger value="emoji">{labels.emojiTab}</TabsTrigger>
              <TabsTrigger value="upload">{labels.uploadTab}</TabsTrigger>
            </TabsList>
          </div>
          {tab !== "upload" && (
            <div className="relative mx-3 mb-2">
              <IconSearch
                aria-hidden
                className="pointer-events-none absolute start-2 top-2 size-4 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={labels.search}
                placeholder={labels.search}
                className="h-8 ps-8 focus-visible:ring-1"
              />
            </div>
          )}
          {tab === "icons" && (
            <div
              className="flex items-center justify-between px-3 pb-2"
              aria-label={labels.colors}
            >
              {colors.map((nextColor) => (
                <button
                  key={nextColor ?? "default"}
                  type="button"
                  title={
                    nextColor
                      ? (labels.colorNames?.[nextColor] ?? nextColor)
                      : labels.defaultColor
                  }
                  aria-label={
                    nextColor
                      ? (labels.colorNames?.[nextColor] ?? nextColor)
                      : labels.defaultColor
                  }
                  aria-pressed={color === nextColor}
                  onClick={() => {
                    setColor(nextColor);
                    if (value?.kind === "library")
                      void select({ ...value, color: nextColor }, false);
                  }}
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    color === nextColor && "border-border bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full bg-current",
                      nextColor
                        ? resourceIconColorClasses[nextColor]
                        : "text-foreground",
                    )}
                  >
                    {color === nextColor && (
                      <IconCheck
                        className="size-3 text-background"
                        stroke={3}
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {tab !== "upload" && !query && (
            <div className="px-3 pb-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger
                  className="h-7 border-0 px-1 text-xs text-muted-foreground shadow-none"
                  aria-label={labels.allCategories}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[320]" container={container}>
                  <SelectGroup>
                    <SelectItem value="all">{labels.allCategories}</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
          {tab === "upload" ? (
            <div className="grid gap-3 p-3 pt-1">
              {onUpload && (
                <button
                  type="button"
                  disabled={uploading}
                  className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const file = event.dataTransfer.files[0];
                    if (file && !uploading) void upload(file);
                  }}
                >
                  <IconPhotoPlus className="size-6 text-muted-foreground" />
                  <span>{uploading ? labels.uploading : labels.upload}</span>
                  {labels.uploadHint && (
                    <span className="text-xs text-muted-foreground">
                      {labels.uploadHint}
                    </span>
                  )}
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              {uploadChoices.length > 0 && (
                <div className="grid grid-cols-7 gap-1">
                  {uploadChoices.map((entry) => (
                    <button
                      key={`${entry.authority}:${entry.assetId}`}
                      type="button"
                      title={entry.alt}
                      aria-label={entry.alt ?? labels.upload}
                      className="flex size-9 items-center justify-center rounded-md hover:bg-accent"
                      onClick={() => void select(entry)}
                    >
                      <ResourceIcon
                        value={entry}
                        size={24}
                        resolveImageUrl={resolveImageUrl}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : loadFailed ? (
            <div
              role="alert"
              className="grid h-64 content-center justify-items-center gap-3 px-4 text-sm"
            >
              <p>{labels.loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((current) => current + 1)}
              >
                {labels.retry}
              </Button>
            </div>
          ) : loading ? (
            <div
              aria-busy="true"
              className="grid h-64 grid-cols-7 content-start gap-2 p-3"
            >
              {Array.from({ length: 28 }, (_, index) => (
                <div
                  key={index}
                  className="size-7 animate-pulse rounded-md bg-muted"
                />
              ))}
            </div>
          ) : (
            <IconGrid
              key={`${tab}:${category}`}
              items={tab === "icons" ? coloredCatalog : emoji}
              sections={
                category === "all" || query
                  ? sections
                  : sections.filter((section) => section.id === category)
              }
              labels={labels}
              recents={
                category === "all"
                  ? effectiveRecents.filter(
                      (entry) =>
                        entry.kind === (tab === "icons" ? "library" : "emoji"),
                    )
                  : []
              }
              query={query}
              selectedKey={value ? JSON.stringify(value) : ""}
              resolveImageUrl={resolveImageUrl}
              onSelect={(next) => void select(next)}
            />
          )}
        </Tabs>
        {(saveFailed || uploadError) && (
          <p role="alert" className="px-3 py-2 text-sm text-destructive">
            {uploadError ?? labels.saveError}
          </p>
        )}
        {value && (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full text-xs text-muted-foreground"
              onClick={() => void select(null)}
            >
              {labels.remove}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
