import { COMPONENTS_FILE, importComponentToken } from "./component-inputs.js";
import {
  colorComponents,
  colorToken,
  componentsToHex,
  componentsToHslTriplet,
  type DtcgToken,
  EXTENSION,
  flattenTokens,
  TokenError,
  unflattenTokens,
} from "./dtcg.js";
import { createPalette } from "./palette.js";
import {
  FOUNDATIONS_FILE,
  PALETTE_FILE,
  type TextStyle,
  readTokenFiles,
  THEME_MODES,
  THEME_NAMES,
  themeFile,
  type TokenFiles,
} from "./source.js";

/** A Figma collection: its folder, and the source file behind each of its modes. */
interface Collection {
  folder: string;
  modes: ReadonlyArray<{ mode: string; source: string }>;
}

const MODE_LABELS = { light: "Light", dark: "Dark" } as const;

export const COLLECTIONS: readonly Collection[] = [
  {
    folder: "Foundations",
    modes: [{ mode: "Value", source: FOUNDATIONS_FILE }],
  },
  { folder: "Palette", modes: [{ mode: "Value", source: PALETTE_FILE }] },
  { folder: "Components", modes: [{ mode: "Value", source: COMPONENTS_FILE }] },
  ...THEME_NAMES.map((name) => ({
    folder: `Theme ${name}`,
    modes: THEME_MODES.map((mode) => ({
      mode: MODE_LABELS[mode],
      source: themeFile(name, mode),
    })),
  })),
];

const SUFFIX = ".tokens.json";

/** The files to import into Figma, by path: `<collection>/<mode>.tokens.json`. */
export function exportForFigma(sources: TokenFiles): Map<string, unknown> {
  const files = new Map<string, unknown>();
  for (const collection of COLLECTIONS) {
    for (const { mode, source } of collection.modes) {
      if (!(source in sources)) {
        throw new TokenError(source, "(file)", "is missing");
      }
      files.set(`${collection.folder}/${mode}${SUFFIX}`, sources[source]);
    }
  }
  return files;
}

/** A text style as the Figma sync creates it, bound to Foundations variables by name. */
export interface FigmaTextStyle {
  name: string;
  description: string;
  variables: {
    fontFamily: string;
    fontSize: string;
    lineHeight: string;
    letterSpacing: string;
    fontWeight: string;
  };
}

/**
 * The text styles for Figma, which its variable import cannot create: each
 * style's name and the Foundations variable each property binds to.
 */
export function textStylesForFigma(
  styles: readonly TextStyle[],
): FigmaTextStyle[] {
  return styles.map((style) => ({
    name: style.name,
    description: style.description,
    variables: {
      fontFamily: `font/family/${style.family}`,
      fontSize: `font/size/${style.step}`,
      lineHeight: `font/line-height/${style.step}`,
      letterSpacing: `font/letter-spacing/${style.step}`,
      fontWeight: `font/weight/${style.weight}`,
    },
  }));
}

/** Token files as the formatter writes them: two-space JSON, number arrays on one line. */
export function formatTokenFile(group: unknown): string {
  return `${JSON.stringify(group, null, 2).replace(
    /\[\s+([^[\]{}"]*?)\s+\]/g,
    (_match, items: string) => `[${items.split(/,\s*/).join(", ")}]`,
  )}\n`;
}

const ALIAS = /^\{(.+)\}$/;

function importToken(
  file: string,
  tokenPath: string,
  current: DtcgToken,
  incoming: unknown,
  source: string,
): DtcgToken {
  if (typeof incoming !== "object" || incoming === null) {
    throw new TokenError(file, tokenPath, "is not a token");
  }
  const token = incoming as Partial<DtcgToken>;
  if (token.$type !== current.$type) {
    throw new TokenError(
      file,
      tokenPath,
      `is a ${String(token.$type)}, expected a ${current.$type}`,
    );
  }
  if (source === COMPONENTS_FILE)
    return importComponentToken(file, tokenPath, current, token as DtcgToken);
  const value = token.$value;
  if (typeof value === "string" && ALIAS.test(value)) {
    throw new TokenError(
      file,
      tokenPath,
      `is an alias of ${value}; give it its own value`,
    );
  }
  const extensions: Record<string, unknown> = { ...current.$extensions };
  for (const [key, extension] of Object.entries(token.$extensions ?? {})) {
    if (key !== EXTENSION) extensions[key] = extension;
  }
  const description =
    typeof token.$description === "string" && token.$description !== ""
      ? { $description: token.$description }
      : {};

  if (current.$type === "color") {
    const components = colorComponents(value, file, tokenPath);
    const before = colorComponents(current.$value, file, tokenPath);
    if (componentsToHex(components) === componentsToHex(before)) {
      return { ...current, ...description, $extensions: extensions };
    }
    const changed = colorToken(components, componentsToHslTriplet(components));
    return {
      ...changed,
      ...description,
      $extensions: { ...extensions, ...changed.$extensions },
    };
  }
  if (current.$type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TokenError(file, tokenPath, "is not a finite number");
    }
  } else if (typeof value !== "string" || value.trim() === "") {
    throw new TokenError(file, tokenPath, "is not a non-empty string");
  }
  return { ...current, ...description, $value: value, $extensions: extensions };
}

function withoutEmptyExtensions(token: DtcgToken): DtcgToken {
  if (!token.$extensions || Object.keys(token.$extensions).length > 0) {
    return token;
  }
  const trimmed: DtcgToken = { $type: token.$type, $value: token.$value };
  if (token.$description !== undefined) {
    trimmed.$description = token.$description;
  }
  return trimmed;
}

export interface ImportResult {
  /** Every source file the export touched, by path under `files/`, as it should now read. */
  files: Map<string, unknown>;
  /** Token paths whose value changed, by source file. */
  changed: Map<string, string[]>;
}

/**
 * The source files for a Figma export, keyed by path under `files/`. Takes
 * any subset of collections, but every mode of one it takes, and refuses an
 * unknown file, a missing or extra token, a changed type, or a value code
 * cannot read. Nothing is returned unless every file passes.
 */
export function importFromFigma(
  exported: ReadonlyMap<string, unknown>,
  sources: TokenFiles,
): ImportResult {
  const problems: string[] = [];
  const byFolder = new Map<string, Map<string, unknown>>();
  for (const [path, group] of exported) {
    const [folder, fileName, ...nested] = path.split("/");
    const collection =
      folder === undefined
        ? undefined
        : COLLECTIONS.find(
            (candidate) =>
              candidate.folder.toLowerCase() === folder.toLowerCase(),
          );
    if (
      !collection ||
      fileName === undefined ||
      nested.length > 0 ||
      !fileName.endsWith(SUFFIX)
    ) {
      problems.push(
        `${path}: not a known collection file (<collection>/<mode>${SUFFIX})`,
      );
      continue;
    }
    const modes = byFolder.get(collection.folder) ?? new Map<string, unknown>();
    modes.set(fileName.slice(0, -SUFFIX.length).toLowerCase(), group);
    byFolder.set(collection.folder, modes);
  }

  const files = new Map<string, unknown>();
  const changed = new Map<string, string[]>();
  for (const collection of COLLECTIONS) {
    const modes = byFolder.get(collection.folder);
    if (!modes) continue;
    const single = collection.modes.length === 1;
    if (single && modes.size !== 1) {
      problems.push(
        `${collection.folder}: has ${modes.size} modes, expected 1`,
      );
      continue;
    }
    for (const name of modes.keys()) {
      if (
        !single &&
        !collection.modes.some(({ mode }) => mode.toLowerCase() === name)
      ) {
        problems.push(
          `${collection.folder}/${name}${SUFFIX}: not a mode of this collection (${collection.modes.map(({ mode }) => mode).join(", ")})`,
        );
      }
    }
    for (const { mode, source } of collection.modes) {
      const group = single
        ? [...modes.values()][0]
        : modes.get(mode.toLowerCase());
      const label = `${collection.folder}/${mode}${SUFFIX}`;
      if (group === undefined) {
        problems.push(
          `${label}: is missing; export every mode of the collection`,
        );
        continue;
      }
      try {
        const current = flattenTokens(sources[source], source);
        const incoming = flattenTokens(group, label);
        const next = new Map<string, DtcgToken>();
        const changes: string[] = [];
        for (const tokenPath of incoming.keys()) {
          if (!current.has(tokenPath)) {
            problems.push(`${label}: ${tokenPath} is not a token code reads`);
          }
        }
        for (const [tokenPath, token] of current) {
          if (!incoming.has(tokenPath)) {
            problems.push(`${label}: ${tokenPath} is missing`);
            continue;
          }
          try {
            const imported = withoutEmptyExtensions(
              importToken(
                label,
                tokenPath,
                token,
                incoming.get(tokenPath),
                source,
              ),
            );
            if (
              JSON.stringify(imported.$value) !== JSON.stringify(token.$value)
            ) {
              changes.push(tokenPath);
            }
            next.set(tokenPath, imported);
          } catch (error) {
            if (!(error instanceof TokenError)) throw error;
            problems.push(error.message);
          }
        }
        files.set(source, unflattenTokens(next));
        if (changes.length > 0) changed.set(source, changes);
      } catch (error) {
        if (!(error instanceof TokenError)) throw error;
        problems.push(error.message);
      }
    }
  }

  if (problems.length === 0) {
    const merged: Record<string, unknown> = { ...sources };
    for (const [path, group] of files) merged[path] = group;
    try {
      const read = readTokenFiles(merged);
      createPalette(read.palette);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (problems.length > 0) throw new TokenImportError(problems);
  return { files, changed };
}

export class TokenImportError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The export was not imported; fix these and export again:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
    this.name = "TokenImportError";
  }
}
