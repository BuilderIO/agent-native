import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef, KeyboardEvent } from "react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { cn } from "../utils.js";
import {
  type GoogleFontCatalogEntry,
  type GoogleFontCatalogState,
  STATIC_GOOGLE_FONTS,
  getGoogleFontCatalogState,
  getGoogleFontPreviewStatus,
  googleFontPreviewFamily,
  googleFontFamilyQuery,
  googleFontFamilyValue,
  googleFontPreviewFace,
  loadGoogleFontCatalog,
  requestGoogleFontPreviews,
  resolveGoogleFont,
  useGoogleFontCatalog,
  useGoogleFontPreviewVersion,
} from "./google-fonts.js";

export interface FontFamilyOption {
  value: string;
  key?: string;
  label?: string;
}

/** `[family, css2 axis spec]` for the families the picker offers offline. */
export const GOOGLE_FONT_FAMILIES: readonly (readonly [string, string])[] =
  STATIC_GOOGLE_FONTS.map((entry) => {
    const query = googleFontFamilyQuery(entry) ?? "";
    return [entry.family, query.slice(query.indexOf(":") + 1)] as const;
  });

export const GOOGLE_FONT_QUERIES = Object.fromEntries(
  STATIC_GOOGLE_FONTS.map((entry) => [
    entry.family,
    googleFontFamilyQuery(entry) ?? "",
  ]),
) as Record<string, string>;

const BUILTIN_FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const satisfies readonly FontFamilyOption[];

const BUILTIN_FONT_FAMILY_NAMES = new Set(
  BUILTIN_FONT_FAMILY_OPTIONS.map((option) =>
    option.value.replace(/^['"]([^'"]+)['"].*$/, "$1"),
  ),
);

export const FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  ...BUILTIN_FONT_FAMILY_OPTIONS,
  ...GOOGLE_FONT_FAMILIES.filter(
    ([family]) => !BUILTIN_FONT_FAMILY_NAMES.has(family),
  ).map(([family]) => ({
    value: `'${family}', sans-serif`,
    label: family,
  })),
];

function cleanFontFamilyName(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function splitFontFamilyList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const families: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
    }
    if (char === "," && !quote) {
      const family = cleanFontFamilyName(token);
      if (family) families.push(family);
      token = "";
    } else token += char;
  }
  const family = cleanFontFamilyName(token);
  if (family) families.push(family);
  return families;
}

function normalizeFontFamilyName(value: string): string {
  return cleanFontFamilyName(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeFontFamilyStack(value: string): string {
  return splitFontFamilyList(value).map(normalizeFontFamilyName).join(",");
}

export function displayFontFamilyName(value: string | undefined): string {
  const first = splitFontFamilyList(value)[0];
  if (!first) return "Sans Serif"; // i18n-ignore shared generic font label
  const normalized = normalizeFontFamilyName(first);
  if (normalized === "sans-serif") {
    return "Sans Serif"; // i18n-ignore shared generic font label
  }
  if (normalized === "serif") return "Serif"; // i18n-ignore shared generic font label
  if (normalized === "monospace") {
    return "Monospace"; // i18n-ignore shared generic font label
  }
  if (normalized === "system-ui" || normalized === "-apple-system")
    return "System UI"; // i18n-ignore shared generic font label
  if (normalized === "blinkmacsystemfont") {
    return "Apple System"; // i18n-ignore shared generic font label
  }
  return first;
}

export function resolveFontFamilySelectValue(
  value: string | undefined,
): string {
  const raw = value?.trim();
  if (!raw) return "sans-serif";
  const normalizedStack = normalizeFontFamilyStack(raw);
  const exact = FONT_FAMILY_OPTIONS.find(
    (option) => normalizeFontFamilyStack(option.value) === normalizedStack,
  );
  if (exact) return exact.value;
  const first = normalizeFontFamilyName(splitFontFamilyList(raw)[0] ?? "");
  return (
    FONT_FAMILY_OPTIONS.find(
      (option) =>
        normalizeFontFamilyName(splitFontFamilyList(option.value)[0] ?? "") ===
        first,
    )?.value ?? raw
  );
}

export interface FontFamilySelectOption {
  value: string;
  label: string;
}

export function sortFontFamilyOptions<T extends FontFamilySelectOption>(
  options: readonly T[],
): T[] {
  return [...options].sort((a, b) => {
    if (a.value === "inherit") return -1;
    if (b.value === "inherit") return 1;
    return a.label.localeCompare(b.label);
  });
}

export interface FontFamilyPickerLabels {
  /** Heading over the fonts the caller passes in `documentFonts`. */
  documentFonts?: string;
  /** Heading over the full list, shown when `documentFonts` has a heading. */
  allFonts?: string;
  /** Inline note when the Google Fonts catalog could not be read. */
  catalogUnavailable?: string;
}

export interface VisualFontFamilyPickerProps {
  label: string;
  value: string;
  options: readonly FontFamilySelectOption[];
  onChange: (value: string) => void;
  className?: string;
  contentProps?: Omit<
    ComponentPropsWithoutRef<typeof SelectContent>,
    "children"
  > &
    Partial<Record<`data-${string}`, string | undefined>>;
  mixed?: boolean;
  mixedLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /**
   * The Google Fonts catalog. Defaults to the shared catalog the app
   * registered with `setGoogleFontCatalogLoader`; while it loads (or when it
   * fails) the picker lists `options`.
   */
  catalog?: GoogleFontCatalogState;
  /** Fonts already used by the document or its design system, listed first. */
  documentFonts?: readonly string[];
  labels?: FontFamilyPickerLabels;
}

const FONT_ROW_HEIGHT = 28;
const FONT_LIST_HEIGHT = 280;
const FONT_LIST_OVERSCAN = 4;
const SCREEN_ROWS = Math.ceil(FONT_LIST_HEIGHT / FONT_ROW_HEIGHT);
const PREFETCH_SCREENS = 5;
const WARM_ROWS = SCREEN_ROWS * 4;
const SEARCH_PRELOAD_ROWS = 300;
const GENERIC_FONT_FAMILIES = new Set(["serif", "sans-serif", "monospace"]);

type FontPickerRow =
  | { kind: "header"; key: string; label: string }
  | {
      kind: "option";
      key: string;
      value: string;
      label: string;
      font?: GoogleFontCatalogEntry;
      custom?: true;
    };

function firstFamilyKey(value: string): string {
  return normalizeFontFamilyName(splitFontFamilyList(value)[0] ?? "");
}

function buildFontPickerRows({
  options,
  catalogFonts,
  documentFonts,
  search,
  labels,
}: {
  options: readonly FontFamilySelectOption[];
  catalogFonts: readonly GoogleFontCatalogEntry[] | undefined;
  documentFonts: readonly string[];
  search: string;
  labels: FontFamilyPickerLabels;
}): FontPickerRow[] {
  const optionByFamily = new Map<string, FontFamilySelectOption>();
  for (const option of options) {
    const key = firstFamilyKey(option.value);
    if (key && !optionByFamily.has(key)) optionByFamily.set(key, option);
  }
  const fromFont = (
    font: GoogleFontCatalogEntry,
    keyPrefix: string,
  ): FontPickerRow => {
    const option = optionByFamily.get(font.family.toLowerCase());
    return {
      kind: "option",
      key: `${keyPrefix}:${font.family}`,
      value: option?.value ?? googleFontFamilyValue(font),
      label: option?.label ?? font.family,
      font,
    };
  };

  const documentRows: FontPickerRow[] = [];
  const seenDocumentFonts = new Set<string>();
  for (const name of documentFonts) {
    const key = firstFamilyKey(name);
    if (
      !key ||
      seenDocumentFonts.has(key) ||
      GENERIC_FONT_FAMILIES.has(key) ||
      key === "inherit"
    ) {
      continue;
    }
    seenDocumentFonts.add(key);
    const font = resolveGoogleFont(key, catalogFonts);
    const option = optionByFamily.get(key);
    if (font) documentRows.push(fromFont(font, "document"));
    else {
      const family = splitFontFamilyList(name)[0] ?? name;
      documentRows.push({
        kind: "option",
        key: `document:${key}`,
        value: option?.value ?? `"${family}", sans-serif`,
        label: option?.label ?? displayFontFamilyName(name),
      });
    }
  }

  // Options that are not Google families (generics, uploads, the current
  // unknown value) keep their caller-given order ahead of the library.
  const otherRows: FontPickerRow[] = [];
  const staticGoogleRows: FontPickerRow[] = [];
  for (const option of options) {
    const key = firstFamilyKey(option.value);
    const font =
      key && !GENERIC_FONT_FAMILIES.has(key)
        ? resolveGoogleFont(key, catalogFonts)
        : undefined;
    if (font && font.family.toLowerCase() === key) {
      staticGoogleRows.push({
        kind: "option",
        key: `font:${font.family}`,
        value: option.value,
        label: option.label,
        font,
      });
    } else {
      otherRows.push({
        kind: "option",
        key: `option:${option.value}`,
        value: option.value,
        label: option.label,
      });
    }
  }
  const libraryRows = catalogFonts
    ? catalogFonts.map((font) => fromFont(font, "font"))
    : staticGoogleRows;

  const query = search.trim().toLocaleLowerCase();
  const matches = (rows: FontPickerRow[]) => {
    if (!query) return rows;
    const prefix: FontPickerRow[] = [];
    const contains: FontPickerRow[] = [];
    for (const row of rows) {
      if (row.kind !== "option") continue;
      const label = row.label.toLocaleLowerCase();
      if (label.startsWith(query)) prefix.push(row);
      else if (label.includes(query)) contains.push(row);
    }
    return [...prefix, ...contains];
  };
  const documentMatches = matches(documentRows);
  const allMatches = matches([...otherRows, ...libraryRows]);

  const rows: FontPickerRow[] = [];
  const withHeadings =
    documentMatches.length > 0 && labels.documentFonts !== undefined;
  if (withHeadings && labels.documentFonts) {
    rows.push({
      kind: "header",
      key: "h:document",
      label: labels.documentFonts,
    });
  }
  rows.push(...documentMatches);
  if (withHeadings && labels.allFonts && allMatches.length > 0) {
    rows.push({ kind: "header", key: "h:all", label: labels.allFonts });
  }
  rows.push(...allMatches);

  const customName = search
    .trim()
    .replace(/[\\"\u0000-\u001f\u007f]/g, "")
    .trim();
  const exactExists = rows.some(
    (row) =>
      row.kind === "option" && row.label.trim().toLocaleLowerCase() === query,
  );
  if (customName && !exactExists) {
    rows.push({
      kind: "option",
      key: `custom:${customName}`,
      value: `"${customName}", sans-serif`,
      label: customName,
      custom: true,
    });
  }
  return rows;
}

const PREVIEW_FADE_MS = 120;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function FontPreviewLabel({
  font,
  label,
}: {
  font: GoogleFontCatalogEntry;
  label: string;
}) {
  const loaded = getGoogleFontPreviewStatus(font.family) === "loaded";
  const labelRef = useRef<HTMLSpanElement>(null);
  // A row that mounts with its face ready paints in it from the first frame;
  // one that mounts before its face swaps once, with a short fade.
  const mountedLoaded = useRef(loaded);
  useLayoutEffect(() => {
    if (!loaded || mountedLoaded.current) return;
    mountedLoaded.current = true;
    const element = labelRef.current;
    // jsdom and older engines lack the Web Animations API.
    if (!element || prefersReducedMotion() || !("animate" in element)) return;
    element.animate([{ opacity: 0.35 }, { opacity: 1 }], {
      duration: PREVIEW_FADE_MS,
      easing: "ease-out",
    });
  }, [loaded]);
  if (!loaded) {
    // Not loaded (or failed): the UI font, muted, never a wrong fallback face.
    return (
      <span
        ref={labelRef}
        className="min-w-0 truncate text-muted-foreground"
        data-font-preview="pending"
      >
        {label}
      </span>
    );
  }
  const face = googleFontPreviewFace(font);
  return (
    <span
      ref={labelRef}
      className="min-w-0 truncate"
      data-font-preview="loaded"
      style={{
        fontFamily: `"${googleFontPreviewFamily(font.family)}"`,
        fontWeight: face.weight,
        fontStyle: face.italic ? "italic" : "normal",
      }}
    >
      {label}
    </span>
  );
}

function FontPickerRowLabel({
  row,
}: {
  row: Extract<FontPickerRow, { kind: "option" }>;
}) {
  if (row.font) return <FontPreviewLabel font={row.font} label={row.label} />;
  const generic = firstFamilyKey(row.value);
  return (
    <span
      className="min-w-0 truncate"
      style={
        GENERIC_FONT_FAMILIES.has(generic) ? { fontFamily: generic } : undefined
      }
    >
      {row.label}
    </span>
  );
}

function previewFonts(
  rows: readonly FontPickerRow[],
): GoogleFontCatalogEntry[] {
  return rows.flatMap((row) =>
    row.kind === "option" && row.font ? [row.font] : [],
  );
}

function SearchableFontFamilyPicker({
  label,
  value,
  options,
  onChange,
  className,
  contentProps,
  mixed,
  selectedLabel,
  searchPlaceholder,
  catalog,
  documentFonts,
  labels,
}: Omit<VisualFontFamilyPickerProps, "mixedLabel" | "searchable" | "mixed"> & {
  mixed: boolean;
  selectedLabel: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sharedCatalog = useGoogleFontCatalog();
  const catalogState = catalog ?? sharedCatalog;
  const catalogFonts =
    catalogState.status === "ready" ? catalogState.fonts : undefined;
  useGoogleFontPreviewVersion();

  // Callers usually pass fresh arrays and label objects each render; key the
  // row build on their contents so the full catalog is not rebuilt per render.
  const documentFontsKey = (documentFonts ?? []).join("\n");
  const optionsKey = options
    .map((option) => `${option.value}\t${option.label}`)
    .join("\n");
  const documentLabel = labels?.documentFonts;
  const allLabel = labels?.allFonts;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const rows = useMemo(
    () =>
      buildFontPickerRows({
        options: optionsRef.current,
        catalogFonts,
        documentFonts: documentFontsKey ? documentFontsKey.split("\n") : [],
        search,
        labels: {
          ...(documentLabel !== undefined
            ? { documentFonts: documentLabel }
            : {}),
          ...(allLabel !== undefined ? { allFonts: allLabel } : {}),
        },
      }),
    [
      optionsKey,
      catalogFonts,
      documentFontsKey,
      search,
      documentLabel,
      allLabel,
    ],
  );
  const selectedKey = mixed ? "" : firstFamilyKey(value);
  const selectedIndex = rows.findIndex(
    (row) => row.kind === "option" && firstFamilyKey(row.value) === selectedKey,
  );

  const listHeight = Math.min(FONT_LIST_HEIGHT, rows.length * FONT_ROW_HEIGHT);
  const first = Math.max(
    0,
    Math.floor(scrollTop / FONT_ROW_HEIGHT) - FONT_LIST_OVERSCAN,
  );
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + FONT_LIST_HEIGHT) / FONT_ROW_HEIGHT) +
      FONT_LIST_OVERSCAN,
  );
  const visibleRows = rows.slice(first, last);

  // Faces load ahead of the scroll so rows arrive already in their face: the
  // rows on screen jump the queue, then several screens in the scroll
  // direction. Search results are short, so all of them load as you type.
  const scrollDirection = useRef<1 | -1>(1);
  useEffect(() => {
    if (!open) return;
    requestGoogleFontPreviews(previewFonts(rows.slice(first, last)), "next");
    if (search.trim()) {
      requestGoogleFontPreviews(
        previewFonts(rows.slice(0, SEARCH_PRELOAD_ROWS)),
      );
      return;
    }
    const buffer = SCREEN_ROWS * PREFETCH_SCREENS;
    requestGoogleFontPreviews(
      previewFonts(
        scrollDirection.current === 1
          ? rows.slice(last, last + buffer)
          : rows.slice(Math.max(0, first - buffer), first).reverse(),
      ),
    );
  }, [open, rows, first, last, search]);

  // Warm the first screens before the list opens, so it opens loaded.
  const warm = () => {
    const request = (state: GoogleFontCatalogState) => {
      const warmRows = buildFontPickerRows({
        options,
        catalogFonts: state.status === "ready" ? state.fonts : undefined,
        documentFonts: documentFontsKey ? documentFontsKey.split("\n") : [],
        search: "",
        labels: {},
      });
      const selected = warmRows.findIndex(
        (row) =>
          row.kind === "option" && firstFamilyKey(row.value) === selectedKey,
      );
      requestGoogleFontPreviews(previewFonts(warmRows.slice(0, WARM_ROWS)));
      if (selected > 0) {
        requestGoogleFontPreviews(
          previewFonts(
            warmRows.slice(
              Math.max(0, selected - SCREEN_ROWS),
              selected + SCREEN_ROWS,
            ),
          ),
        );
      }
    };
    if (catalog) {
      request(catalog);
      return;
    }
    request(getGoogleFontCatalogState());
    void loadGoogleFontCatalog().then(request);
  };
  const warmRef = useRef(warm);
  warmRef.current = warm;
  useEffect(() => {
    // Safari has no requestIdleCallback.
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(() => warmRef.current(), {
        timeout: 2000,
      });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(() => warmRef.current(), 1000);
    return () => clearTimeout(timer);
  }, []);

  const scrollToIndex = (index: number, center = false) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = index * FONT_ROW_HEIGHT;
    let next = viewport.scrollTop;
    if (center) next = top - (FONT_LIST_HEIGHT - FONT_ROW_HEIGHT) / 2;
    else if (top < next) next = top;
    else if (top + FONT_ROW_HEIGHT > next + FONT_LIST_HEIGHT) {
      next = top + FONT_ROW_HEIGHT - FONT_LIST_HEIGHT;
    }
    next = Math.max(0, next);
    viewport.scrollTop = next;
    setScrollTop(next);
  };

  const firstOptionIndex = (from: number, step: 1 | -1) => {
    for (let index = from; index >= 0 && index < rows.length; index += step) {
      if (rows[index]?.kind === "option") return index;
    }
    return -1;
  };

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
  };

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      void loadGoogleFontCatalog();
      const index = selectedIndex >= 0 ? selectedIndex : firstOptionIndex(0, 1);
      setActiveIndex(index);
      // The list mounts with the popover; position it on the next frame.
      requestAnimationFrame(() => scrollToIndex(Math.max(index, 0), true));
    } else {
      setSearch("");
      setScrollTop(0);
    }
  };

  const onSearchChange = (next: string) => {
    setSearch(next);
    setActiveIndex(-2);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = 0;
    setScrollTop(0);
  };
  // After a search edit the first match becomes active.
  const effectiveActive =
    activeIndex === -2 ? firstOptionIndex(0, 1) : activeIndex;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const start =
        effectiveActive < 0
          ? step === 1
            ? 0
            : rows.length - 1
          : effectiveActive + step;
      const next = firstOptionIndex(start, step);
      if (next >= 0) {
        setActiveIndex(next);
        scrollToIndex(next);
      }
    } else if (event.key === "Enter") {
      const row = effectiveActive >= 0 ? rows.at(effectiveActive) : undefined;
      if (row?.kind === "option") {
        event.preventDefault();
        choose(row.value);
      }
    }
  };

  const {
    className: contentClassName,
    position: selectPosition,
    ...popoverContentProps
  } = contentProps ?? {};
  void selectPosition;
  const typedPopoverProps = popoverContentProps as ComponentPropsWithoutRef<
    typeof PopoverContent
  >;
  const activeRowId =
    effectiveActive >= 0 && rows[effectiveActive]?.kind === "option"
      ? `${listId}-${effectiveActive}`
      : undefined;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          title={selectedLabel}
          data-font-family-picker
          onPointerEnter={warm}
          onPointerDown={warm}
          onFocus={warm}
          className={cn(
            "flex h-6 w-full items-center justify-between gap-1 text-left",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          <IconChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        {...typedPopoverProps}
        align={typedPopoverProps.align ?? "start"}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-56 p-0",
          contentClassName,
        )}
      >
        <input
          role="combobox"
          aria-label={searchPlaceholder}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRowId}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-8 w-full border-b border-border bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground"
        />
        {catalogState.status === "error" && labels?.catalogUnavailable ? (
          <p
            role="status"
            data-font-catalog-unavailable
            className="border-b border-border px-2.5 py-1.5 text-[11px] text-muted-foreground"
          >
            {labels.catalogUnavailable}
          </p>
        ) : null}
        <div
          ref={viewportRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="overflow-y-auto overscroll-contain"
          style={{ height: listHeight }}
          onScroll={(event) => {
            const next = event.currentTarget.scrollTop;
            if (next !== scrollTop)
              scrollDirection.current = next > scrollTop ? 1 : -1;
            setScrollTop(next);
          }}
        >
          <div
            className="relative"
            style={{ height: rows.length * FONT_ROW_HEIGHT }}
          >
            {visibleRows.map((row, offset) => {
              const index = first + offset;
              const style = {
                top: index * FONT_ROW_HEIGHT,
                height: FONT_ROW_HEIGHT,
              };
              if (row.kind === "header") {
                return (
                  <div
                    key={row.key}
                    role="presentation"
                    className="absolute inset-x-0 flex items-end px-2.5 pb-1 text-[11px] font-medium text-muted-foreground"
                    style={style}
                  >
                    {row.label}
                  </div>
                );
              }
              const selected = index === selectedIndex;
              return (
                <div
                  key={row.key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-active={index === effectiveActive ? "" : undefined}
                  data-font-family={row.font?.family}
                  data-custom-font-option={row.custom ? "" : undefined}
                  className="absolute inset-x-1 flex cursor-pointer items-center justify-between gap-2 rounded-sm px-1.5 text-[13px] data-[active]:bg-accent data-[active]:text-accent-foreground"
                  style={style}
                  onMouseMove={() => {
                    if (index !== effectiveActive) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row.value)}
                >
                  <FontPickerRowLabel row={row} />
                  {selected ? (
                    <IconCheck className="size-3 shrink-0 opacity-70" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function VisualFontFamilyPicker({
  label,
  value,
  options,
  onChange,
  className,
  contentProps,
  mixed = false,
  mixedLabel,
  searchable = false,
  searchPlaceholder = "Search",
  catalog,
  documentFonts,
  labels,
}: VisualFontFamilyPickerProps) {
  const selectValue = mixed ? "__mixed_font_family__" : value;
  const unknown =
    !mixed && !options.some((option) => option.value === value)
      ? { value, label: displayFontFamilyName(value) }
      : null;
  const selectedLabel = mixed
    ? mixedLabel
    : (options.find((option) => option.value === value)?.label ??
      unknown?.label ??
      displayFontFamilyName(value));
  if (searchable) {
    return (
      <SearchableFontFamilyPicker
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        mixed={mixed}
        selectedLabel={selectedLabel}
        searchPlaceholder={searchPlaceholder}
        {...(className !== undefined ? { className } : {})}
        {...(contentProps !== undefined ? { contentProps } : {})}
        {...(catalog !== undefined ? { catalog } : {})}
        {...(documentFonts !== undefined ? { documentFonts } : {})}
        {...(labels !== undefined ? { labels } : {})}
      />
    );
  }
  return (
    <Select value={selectValue} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-6 w-full px-1.5 text-[11px]", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent {...contentProps}>
        {mixed ? (
          <SelectItem
            value="__mixed_font_family__"
            disabled
            className="!text-[11px] text-muted-foreground"
          >
            {mixedLabel}
          </SelectItem>
        ) : null}
        {unknown ? (
          <SelectItem value={unknown.value} className="!text-[11px]">
            {unknown.label}
          </SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="!text-[11px]"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
