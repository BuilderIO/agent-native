import { useSyncExternalStore } from "react";

/** One Google Fonts family, with the weights and italics it really ships. */
export interface GoogleFontCatalogEntry {
  family: string;
  category: string;
  /** Upright weights, ascending. */
  weights: readonly number[];
  /** Italic weights, ascending. */
  italicWeights: readonly number[];
  /** A variable font with a `wght` axis, so a weight range can be requested. */
  variable: boolean;
}

/**
 * `idle`: no catalog was requested, or the app registered no loader.
 * `error`: the catalog was requested and could not be read; the static list
 * still works, but it is not the library.
 */
export type GoogleFontCatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; fonts: readonly GoogleFontCatalogEntry[] }
  | { status: "error"; error: unknown };

type StaticRow = readonly [
  family: string,
  category: string,
  weights: readonly number[],
  italicWeights: readonly number[],
  variable: boolean,
];

// Snapshot of the catalog for the families the picker has always offered.
// It serves canvases before (or without) the live catalog.
const STATIC_ROWS: readonly StaticRow[] = [
  ["Abril Fatface", "Display", [400], [], false],
  ["Anton", "Sans Serif", [400], [], false],
  [
    "Archivo",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Arimo", "Sans Serif", [400, 500, 600, 700], [400, 500, 600, 700], true],
  [
    "Asap",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Assistant", "Sans Serif", [200, 300, 400, 500, 600, 700, 800], [], true],
  [
    "Barlow",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    false,
  ],
  [
    "Barlow Condensed",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    false,
  ],
  ["Bebas Neue", "Sans Serif", [400], [], false],
  [
    "Bodoni Moda",
    "Serif",
    [400, 500, 600, 700, 800, 900],
    [400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Bricolage Grotesque",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800],
    [],
    true,
  ],
  ["Cabin", "Sans Serif", [400, 500, 600, 700], [400, 500, 600, 700], true],
  [
    "Catamaran",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  ["Caveat", "Handwriting", [400, 500, 600, 700], [], true],
  [
    "Chivo",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Cormorant Garamond",
    "Serif",
    [300, 400, 500, 600, 700],
    [300, 400, 500, 600, 700],
    true,
  ],
  ["Cousine", "Monospace", [400, 700], [400, 700], false],
  ["Crimson Text", "Serif", [400, 600, 700], [400, 600, 700], false],
  [
    "DM Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    true,
  ],
  ["Dancing Script", "Handwriting", [400, 500, 600, 700], [], true],
  ["David Libre", "Serif", [400, 500, 700], [], false],
  [
    "EB Garamond",
    "Serif",
    [400, 500, 600, 700, 800],
    [400, 500, 600, 700, 800],
    true,
  ],
  [
    "Epilogue",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Exo 2",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Figtree",
    "Sans Serif",
    [300, 400, 500, 600, 700, 800, 900],
    [300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Fira Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    false,
  ],
  [
    "Fraunces",
    "Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Geist",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Geist Mono",
    "Monospace",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Heebo",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  ["Hind", "Sans Serif", [300, 400, 500, 600, 700], [], false],
  ["Homemade Apple", "Handwriting", [400], [], false],
  [
    "IBM Plex Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700],
    [100, 200, 300, 400, 500, 600, 700],
    true,
  ],
  [
    "Inconsolata",
    "Monospace",
    [200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  [
    "Instrument Sans",
    "Sans Serif",
    [400, 500, 600, 700],
    [400, 500, 600, 700],
    true,
  ],
  [
    "Inter",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "JetBrains Mono",
    "Monospace",
    [100, 200, 300, 400, 500, 600, 700, 800],
    [100, 200, 300, 400, 500, 600, 700, 800],
    true,
  ],
  [
    "Josefin Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700],
    [100, 200, 300, 400, 500, 600, 700],
    true,
  ],
  [
    "Jost",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Kanit",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    false,
  ],
  [
    "Karla",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800],
    [200, 300, 400, 500, 600, 700, 800],
    true,
  ],
  [
    "Lato",
    "Sans Serif",
    [100, 300, 400, 700, 900],
    [100, 300, 400, 700, 900],
    false,
  ],
  [
    "League Spartan",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  [
    "Lexend",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  [
    "Libre Baskerville",
    "Serif",
    [400, 500, 600, 700],
    [400, 500, 600, 700],
    true,
  ],
  [
    "Libre Franklin",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Lora", "Serif", [400, 500, 600, 700], [400, 500, 600, 700], true],
  ["Manrope", "Sans Serif", [200, 300, 400, 500, 600, 700, 800], [], true],
  [
    "Merriweather",
    "Serif",
    [300, 400, 500, 600, 700, 800, 900],
    [300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Montserrat",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Mulish",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    true,
  ],
  [
    "Noto Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Noto Serif",
    "Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Nova Square", "Display", [400], [], false],
  [
    "Nunito",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    true,
  ],
  [
    "Nunito Sans",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    true,
  ],
  [
    "Onest",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  [
    "Open Sans",
    "Sans Serif",
    [300, 400, 500, 600, 700, 800],
    [300, 400, 500, 600, 700, 800],
    true,
  ],
  ["Oswald", "Sans Serif", [200, 300, 400, 500, 600, 700], [], true],
  [
    "Outfit",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  [
    "Overpass",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Oxygen", "Sans Serif", [300, 400, 700], [], false],
  ["PT Sans", "Sans Serif", [400, 700], [400, 700], false],
  ["PT Serif", "Serif", [400, 700], [400, 700], false],
  ["Pacifico", "Handwriting", [400], [], false],
  [
    "Playfair Display",
    "Serif",
    [400, 500, 600, 700, 800, 900],
    [400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Plus Jakarta Sans",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800],
    [200, 300, 400, 500, 600, 700, 800],
    true,
  ],
  [
    "Poppins",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    false,
  ],
  [
    "Prompt",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    false,
  ],
  [
    "Public Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Quicksand", "Sans Serif", [300, 400, 500, 600, 700], [], true],
  [
    "Raleway",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Red Hat Display",
    "Sans Serif",
    [300, 400, 500, 600, 700, 800, 900],
    [300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Roboto",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Roboto Condensed",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Roboto Mono",
    "Monospace",
    [100, 200, 300, 400, 500, 600, 700],
    [100, 200, 300, 400, 500, 600, 700],
    true,
  ],
  [
    "Roboto Slab",
    "Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [],
    true,
  ],
  [
    "Rubik",
    "Sans Serif",
    [300, 400, 500, 600, 700, 800, 900],
    [300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Schibsted Grotesk",
    "Sans Serif",
    [400, 500, 600, 700, 800, 900],
    [400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Sora", "Sans Serif", [100, 200, 300, 400, 500, 600, 700, 800], [], true],
  [
    "Source Sans 3",
    "Sans Serif",
    [200, 300, 400, 500, 600, 700, 800, 900],
    [200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Space Grotesk", "Sans Serif", [300, 400, 500, 600, 700], [], true],
  ["Syne", "Sans Serif", [400, 500, 600, 700, 800], [], true],
  ["Teko", "Sans Serif", [300, 400, 500, 600, 700], [], true],
  ["Tinos", "Serif", [400, 700], [400, 700], false],
  [
    "Titillium Web",
    "Sans Serif",
    [200, 300, 400, 600, 700, 900],
    [200, 300, 400, 600, 700],
    false,
  ],
  ["Ubuntu", "Sans Serif", [300, 400, 500, 700], [300, 400, 500, 700], false],
  [
    "Urbanist",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  [
    "Work Sans",
    "Sans Serif",
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
    true,
  ],
  ["Yanone Kaffeesatz", "Sans Serif", [200, 300, 400, 500, 600, 700], [], true],
];

export const STATIC_GOOGLE_FONTS: readonly GoogleFontCatalogEntry[] =
  STATIC_ROWS.map(([family, category, weights, italicWeights, variable]) => ({
    family,
    category,
    weights,
    italicWeights,
    variable,
  }));

const CSS2_URL = "https://fonts.googleapis.com/css2";

function familyParam(family: string): string {
  return encodeURIComponent(family.trim()).replace(/%20/g, "+");
}

function weightTokens(weights: readonly number[], variable: boolean): string[] {
  const first = weights.at(0);
  const last = weights.at(-1);
  if (first === undefined || last === undefined) return [];
  // A variable family serves every weight between its named instances.
  if (variable && first !== last) return [`${first}..${last}`];
  return weights.map(String);
}

/**
 * The css2 `family=` value for a family. Google rejects the whole request
 * (HTTP 400) when it names a weight or style the family lacks, so this only
 * ever names faces from the family's own catalog entry.
 */
export function googleFontFamilyQuery(
  entry: GoogleFontCatalogEntry,
  styles: "all" | "upright" = "all",
): string | undefined {
  const upright = weightTokens(entry.weights, entry.variable);
  const italic =
    styles === "all" ? weightTokens(entry.italicWeights, entry.variable) : [];
  const name = familyParam(entry.family);
  if (italic.length === 0) {
    return upright.length ? `${name}:wght@${upright.join(";")}` : undefined;
  }
  const tuples = [
    ...upright.map((weight) => `0,${weight}`),
    ...italic.map((weight) => `1,${weight}`),
  ];
  return `${name}:ital,wght@${tuples.join(";")}`;
}

export function googleFontStylesheetUrl(
  entry: GoogleFontCatalogEntry,
  styles: "all" | "upright" = "all",
): string | undefined {
  const query = googleFontFamilyQuery(entry, styles);
  return query ? `${CSS2_URL}?family=${query}&display=swap` : undefined;
}

function closestTo400(weights: readonly number[]): number | undefined {
  let best: number | undefined;
  for (const weight of weights) {
    if (best === undefined || Math.abs(weight - 400) < Math.abs(best - 400)) {
      best = weight;
    }
  }
  return best;
}

/** The one face a picker row previews: regular when the family has it. */
export function googleFontPreviewFace(entry: GoogleFontCatalogEntry): {
  weight: number;
  italic: boolean;
} {
  const upright = closestTo400(entry.weights);
  if (upright !== undefined) return { weight: upright, italic: false };
  const italic = closestTo400(entry.italicWeights);
  if (italic !== undefined) return { weight: italic, italic: true };
  throw new Error(`Google font ${entry.family} has no faces`);
}

/** One css2 request for several families, subset to `text`. */
export function googleFontPreviewUrl(
  entries: readonly GoogleFontCatalogEntry[],
  text: string,
): string {
  const families = entries.map((entry) => {
    const face = googleFontPreviewFace(entry);
    const name = familyParam(entry.family);
    return face.italic
      ? `family=${name}:ital,wght@1,${face.weight}`
      : `family=${name}:wght@${face.weight}`;
  });
  return `${CSS2_URL}?${families.join("&")}&text=${encodeURIComponent(text)}&display=swap`;
}

/** A CSS `font-family` stack for a catalog family. */
export function googleFontFamilyValue(entry: GoogleFontCatalogEntry): string {
  const category = entry.category.toLowerCase();
  const generic =
    category === "serif"
      ? "serif"
      : category === "monospace"
        ? "monospace"
        : category === "handwriting"
          ? "cursive"
          : "sans-serif";
  return `'${entry.family}', ${generic}`;
}

const GOOGLE_FONT_ALIASES: Record<string, string> = {
  "source sans pro": "source sans 3",
  bodoni: "bodoni moda",
};

const FONT_WEIGHT_SUFFIX =
  /\s+(?:thin|extra ?light|ultra ?light|light|book|regular|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique)$/i;

function normalizeGoogleFontName(name: string): string {
  return name.replace(/["']/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

const catalogIndexes = new WeakMap<
  readonly GoogleFontCatalogEntry[],
  Map<string, GoogleFontCatalogEntry>
>();

function catalogIndex(
  fonts: readonly GoogleFontCatalogEntry[],
): Map<string, GoogleFontCatalogEntry> {
  let index = catalogIndexes.get(fonts);
  if (!index) {
    index = new Map(fonts.map((entry) => [entry.family.toLowerCase(), entry]));
    catalogIndexes.set(fonts, index);
  }
  return index;
}

/**
 * Finds the Google family a name refers to: the live catalog when it has
 * loaded, the static snapshot otherwise. Accepts quoted names, retired
 * aliases, and weight-suffixed names such as "Work Sans Medium".
 */
export function resolveGoogleFont(
  name: string,
  fonts: readonly GoogleFontCatalogEntry[] | undefined = catalogState.status ===
  "ready"
    ? catalogState.fonts
    : undefined,
): GoogleFontCatalogEntry | undefined {
  const key = normalizeGoogleFontName(name);
  if (!key) return undefined;
  const live = fonts ? catalogIndex(fonts) : undefined;
  const fallback = catalogIndex(STATIC_GOOGLE_FONTS);
  const lookup = (candidate: string) => {
    const canonical = GOOGLE_FONT_ALIASES[candidate] ?? candidate;
    return live?.get(canonical) ?? fallback.get(canonical);
  };
  return lookup(key) ?? lookup(key.replace(FONT_WEIGHT_SUFFIX, "").trim());
}

// ---------------------------------------------------------------------------
// Catalog store. The app registers how to read the catalog (its own action);
// the toolkit asks for it only when a picker opens or a canvas names a family
// the static snapshot does not know.

export type GoogleFontCatalogLoader = () => Promise<
  readonly GoogleFontCatalogEntry[]
>;

const CATALOG_RETRY_MS = 30_000;

let catalogLoader: GoogleFontCatalogLoader | null = null;
let catalogState: GoogleFontCatalogState = { status: "idle" };
let catalogInflight: Promise<GoogleFontCatalogState> | null = null;
let catalogFailedAt = 0;
const catalogListeners = new Set<() => void>();

function setCatalogState(next: GoogleFontCatalogState) {
  catalogState = next;
  for (const listener of catalogListeners) listener();
}

export function setGoogleFontCatalogLoader(
  loader: GoogleFontCatalogLoader | null,
): void {
  catalogLoader = loader;
}

export function getGoogleFontCatalogState(): GoogleFontCatalogState {
  return catalogState;
}

export function subscribeGoogleFontCatalog(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
}

function isCatalogEntry(value: unknown): value is GoogleFontCatalogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.family === "string" &&
    typeof entry.category === "string" &&
    Array.isArray(entry.weights) &&
    Array.isArray(entry.italicWeights) &&
    entry.weights.length + entry.italicWeights.length > 0 &&
    typeof entry.variable === "boolean"
  );
}

/** Starts (or joins) the catalog read; resolves with the settled state. */
export function loadGoogleFontCatalog(): Promise<GoogleFontCatalogState> {
  if (catalogState.status === "ready") return Promise.resolve(catalogState);
  if (catalogInflight) return catalogInflight;
  const loader = catalogLoader;
  if (!loader) return Promise.resolve(catalogState);
  if (
    catalogState.status === "error" &&
    Date.now() - catalogFailedAt < CATALOG_RETRY_MS
  ) {
    return Promise.resolve(catalogState);
  }
  setCatalogState({ status: "loading" });
  const inflight = (async (): Promise<GoogleFontCatalogState> => {
    try {
      const fonts = await loader();
      if (!Array.isArray(fonts) || fonts.length === 0) {
        throw new Error("The Google Fonts catalog came back empty.");
      }
      const invalid = fonts.find((entry) => !isCatalogEntry(entry));
      if (invalid !== undefined) {
        throw new Error("The Google Fonts catalog has a malformed family.");
      }
      setCatalogState({ status: "ready", fonts });
    } catch (error) {
      catalogFailedAt = Date.now();
      setCatalogState({ status: "error", error });
    }
    return catalogState;
  })();
  catalogInflight = inflight;
  void inflight.finally(() => {
    if (catalogInflight === inflight) catalogInflight = null;
  });
  return inflight;
}

export function useGoogleFontCatalog(): GoogleFontCatalogState {
  return useSyncExternalStore(
    subscribeGoogleFontCatalog,
    getGoogleFontCatalogState,
    getGoogleFontCatalogState,
  );
}

/** Test hook: forget the catalog, loader, and every injected stylesheet. */
export function resetGoogleFontsForTests(): void {
  catalogLoader = null;
  catalogInflight = null;
  catalogFailedAt = 0;
  injectedStylesheets.clear();
  pendingStylesheetLoads.clear();
  previewStatus.clear();
  previewQueue.length = 0;
  previewQueued.clear();
  previewActive = 0;
  previewGeneration += 1;
  setCatalogState({ status: "idle" });
}

// ---------------------------------------------------------------------------
// Canvas stylesheets.

const injectedStylesheets = new Set<string>();
const pendingStylesheetLoads = new Set<Promise<void>>();

export function injectGoogleFontStylesheet(href: string): void {
  if (typeof document === "undefined" || injectedStylesheets.has(href)) return;
  injectedStylesheets.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Loads the stylesheet for each named Google family. Names the static
 * snapshot does not know wait for the catalog, so any catalog family renders;
 * names that are not Google families are left alone.
 */
export function ensureGoogleFontStylesheets(
  names: readonly string[],
): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const unresolved: string[] = [];
  for (const name of names) {
    const entry = resolveGoogleFont(name);
    const href = entry && googleFontStylesheetUrl(entry);
    if (href) injectGoogleFontStylesheet(href);
    else if (name.trim()) unresolved.push(name);
  }
  if (unresolved.length === 0 || catalogState.status === "ready") {
    return Promise.resolve();
  }
  const pending = loadGoogleFontCatalog().then((state) => {
    if (state.status !== "ready") return;
    for (const name of unresolved) {
      const entry = resolveGoogleFont(name, state.fonts);
      const href = entry && googleFontStylesheetUrl(entry);
      if (href) injectGoogleFontStylesheet(href);
    }
  });
  pendingStylesheetLoads.add(pending);
  void pending.finally(() => pendingStylesheetLoads.delete(pending));
  return pending;
}

/** Resolves once every family requested so far has its stylesheet linked. */
export async function settleGoogleFontStylesheets(): Promise<void> {
  await Promise.all([...pendingStylesheetLoads]);
}

// ---------------------------------------------------------------------------
// Picker previews. Each batch is one css2 request for several families, subset
// to the characters of their names, and its faces are loaded through the
// FontFace API under a private alias (so they never mix with canvas faces). A
// stylesheet alone downloads nothing until text renders; loading the faces up
// front is what lets a row paint in its own face the first time it scrolls in.

export type GoogleFontPreviewStatus = "loading" | "loaded" | "failed";

const PREVIEW_BATCH_SIZE = 20;
const PREVIEW_MAX_CONCURRENT = 3;
const PREVIEW_FILE_ORIGIN = "https://fonts.gstatic.com";

const previewStatus = new Map<string, GoogleFontPreviewStatus>();
const previewQueue: GoogleFontCatalogEntry[] = [];
const previewQueued = new Set<string>();
let previewActive = 0;
let previewGeneration = 0;
const previewListeners = new Set<() => void>();
let previewVersion = 0;

function notifyPreviews() {
  previewVersion += 1;
  for (const listener of previewListeners) listener();
}

function setPreviewStatus(
  entries: readonly GoogleFontCatalogEntry[],
  status: GoogleFontPreviewStatus,
) {
  if (entries.length === 0) return;
  for (const entry of entries) previewStatus.set(entry.family, status);
  notifyPreviews();
}

export function getGoogleFontPreviewStatus(
  family: string,
): GoogleFontPreviewStatus | undefined {
  return previewStatus.get(family);
}

/** The private family name a loaded preview face is registered under. */
export function googleFontPreviewFamily(family: string): string {
  return `${family} Font Picker Preview`;
}

type PreviewFaceRule = {
  family: string;
  style: string;
  weight: string;
  src: string;
};

function parsePreviewFaceRules(css: string): PreviewFaceRule[] {
  const rules: PreviewFaceRule[] = [];
  for (const block of css.split("@font-face").slice(1)) {
    const family = /font-family:\s*['"]([^'"]+)['"]/.exec(block)?.[1];
    const src = /src:\s*url\(\s*['"]?(https:\/\/[^'")\s]+)['"]?\s*\)/.exec(
      block,
    )?.[1];
    if (!family || !src || new URL(src).origin !== PREVIEW_FILE_ORIGIN) {
      continue;
    }
    rules.push({
      family,
      src,
      style: /font-style:\s*(\w+)/.exec(block)?.[1] ?? "normal",
      weight: /font-weight:\s*(\d+)/.exec(block)?.[1] ?? "400",
    });
  }
  return rules;
}

async function loadPreviewBatch(
  batch: readonly GoogleFontCatalogEntry[],
): Promise<void> {
  // jsdom and some embedded webviews have no document.fonts.
  const doc: Partial<Pick<Document, "fonts">> = document;
  const fonts = doc.fonts;
  if (typeof FontFace === "undefined" || !fonts) {
    setPreviewStatus(batch, "failed");
    return;
  }
  const text = [...new Set(batch.map((entry) => entry.family).join(""))]
    .sort()
    .join("");
  let rules: PreviewFaceRule[];
  try {
    const response = await fetch(googleFontPreviewUrl(batch, text), {
      credentials: "omit",
      mode: "cors",
    });
    if (!response.ok) throw new Error(`css2 returned ${response.status}`);
    rules = parsePreviewFaceRules(await response.text());
  } catch {
    // A failed preview keeps the UI font for these rows; selection still works.
    setPreviewStatus(batch, "failed");
    return;
  }
  const loaded: GoogleFontCatalogEntry[] = [];
  const failed: GoogleFontCatalogEntry[] = [];
  await Promise.all(
    batch.map(async (entry) => {
      const rule = rules.find((candidate) => candidate.family === entry.family);
      if (!rule) {
        failed.push(entry);
        return;
      }
      try {
        const face = new FontFace(
          googleFontPreviewFamily(entry.family),
          `url(${rule.src})`,
          { style: rule.style, weight: rule.weight, display: "block" },
        );
        await face.load();
        fonts.add(face);
        loaded.push(entry);
      } catch {
        failed.push(entry);
      }
    }),
  );
  setPreviewStatus(loaded, "loaded");
  setPreviewStatus(failed, "failed");
}

function pumpPreviewQueue() {
  while (previewActive < PREVIEW_MAX_CONCURRENT && previewQueue.length > 0) {
    const batch = previewQueue.splice(0, PREVIEW_BATCH_SIZE);
    for (const entry of batch) previewQueued.delete(entry.family);
    setPreviewStatus(batch, "loading");
    previewActive += 1;
    const generation = previewGeneration;
    void loadPreviewBatch(batch).finally(() => {
      if (generation !== previewGeneration) return;
      previewActive -= 1;
      pumpPreviewQueue();
    });
  }
}

/**
 * Queues row previews for families not loaded or loading yet. `next` jumps
 * the queue (rows on screen now); the rest load in order behind it, at most
 * three requests at a time. Loaded faces are kept for the session.
 */
export function requestGoogleFontPreviews(
  entries: readonly GoogleFontCatalogEntry[],
  priority: "next" | "later" = "later",
): void {
  if (typeof document === "undefined") return;
  const wanted = entries.filter((entry) => !previewStatus.has(entry.family));
  if (wanted.length === 0) return;
  if (priority === "next") {
    const families = new Set(wanted.map((entry) => entry.family));
    for (let index = previewQueue.length - 1; index >= 0; index -= 1) {
      const queued = previewQueue.at(index);
      if (queued && families.has(queued.family)) previewQueue.splice(index, 1);
    }
    previewQueue.unshift(...wanted);
    for (const entry of wanted) previewQueued.add(entry.family);
  } else {
    for (const entry of wanted) {
      if (previewQueued.has(entry.family)) continue;
      previewQueued.add(entry.family);
      previewQueue.push(entry);
    }
  }
  pumpPreviewQueue();
}

function subscribePreviews(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

const getPreviewVersion = () => previewVersion;

/** Re-renders when any preview settles; read statuses with `getGoogleFontPreviewStatus`. */
export function useGoogleFontPreviewVersion(): number {
  return useSyncExternalStore(
    subscribePreviews,
    getPreviewVersion,
    getPreviewVersion,
  );
}
