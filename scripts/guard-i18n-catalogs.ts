import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type LocaleCode,
} from "../packages/core/src/localization/shared.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const pluralSuffixes = new Set(["zero", "one", "two", "few", "many", "other"]);
const supportedLocaleSet = new Set<string>(SUPPORTED_LOCALES);

type FlatCatalog = Map<string, string>;

async function main() {
  const catalogDirs = findCatalogDirs();
  const errors: string[] = [];

  for (const dir of catalogDirs) {
    errors.push(...(await checkCatalogDir(dir)));
  }

  if (errors.length > 0) {
    console.error(`[guard:i18n-catalogs] ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    `[guard:i18n-catalogs] checked ${catalogDirs.length} catalog director${
      catalogDirs.length === 1 ? "y" : "ies"
    }`,
  );
}

function findCatalogDirs(): string[] {
  const candidates = [
    path.join(rootDir, "app", "i18n"),
    path.join(
      rootDir,
      "packages",
      "core",
      "src",
      "templates",
      "default",
      "app",
      "i18n",
    ),
    path.join(rootDir, "packages", "docs", "app", "i18n"),
    ...safeReadDir(path.join(rootDir, "templates"))
      .filter((entry) =>
        existsSync(path.join(rootDir, "templates", entry, "app", "i18n")),
      )
      .map((entry) => path.join(rootDir, "templates", entry, "app", "i18n")),
  ];
  return [...new Set(candidates)].filter((dir) => existsSync(dir)).sort();
}

function safeReadDir(dir: string) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function checkCatalogDir(dir: string): Promise<string[]> {
  const relDir = path.relative(rootDir, dir);
  const errors: string[] = [];
  const files = safeReadDir(dir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .sort();
  const localeFiles = new Map(
    files.map((file) => [file.replace(/\.ts$/, ""), path.join(dir, file)]),
  );

  if (!localeFiles.has(DEFAULT_LOCALE)) {
    errors.push(`${relDir} is missing ${DEFAULT_LOCALE}.ts`);
    return errors;
  }

  for (const locale of localeFiles.keys()) {
    if (!supportedLocaleSet.has(locale)) {
      errors.push(
        `${relDir}/${locale}.ts is not a supported locale (${SUPPORTED_LOCALES.join(
          ", ",
        )})`,
      );
    }
  }

  const source = await loadFlatCatalog(localeFiles.get(DEFAULT_LOCALE)!);
  errors.push(...source.errors.map((error) => `${relDir}: ${error}`));
  if (source.errors.length > 0) return errors;

  const sourceShape = catalogShape(source.flat);
  for (const [locale, file] of localeFiles) {
    if (locale === DEFAULT_LOCALE || !supportedLocaleSet.has(locale)) continue;
    const target = await loadFlatCatalog(file);
    errors.push(...target.errors.map((error) => `${relDir}: ${error}`));
    if (target.errors.length > 0) continue;
    errors.push(
      ...compareCatalogs({
        relDir,
        locale: locale as LocaleCode,
        source: source.flat,
        target: target.flat,
        sourceShape,
      }),
    );
  }

  return errors;
}

async function loadFlatCatalog(file: string): Promise<{
  flat: FlatCatalog;
  errors: string[];
}> {
  const errors: string[] = [];
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (error) {
    return {
      flat: new Map(),
      errors: [
        `failed to import ${path.relative(rootDir, file)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const catalog = (mod as { default?: unknown }).default;
  const flat = new Map<string, string>();
  flattenCatalog(catalog, [], flat, errors);
  return { flat, errors };
}

function flattenCatalog(
  value: unknown,
  pathParts: string[],
  out: FlatCatalog,
  errors: string[],
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${pathParts.join(".") || "<root>"} must be an object`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (typeof child === "string") {
      out.set(nextPath.join("."), child);
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenCatalog(child, nextPath, out, errors);
    } else {
      errors.push(`${nextPath.join(".")} must be a string or object`);
    }
  }
}

function pluralParts(key: string): { base: string; suffix: string } | null {
  const index = key.lastIndexOf("_");
  if (index < 0) return null;
  const suffix = key.slice(index + 1);
  if (!pluralSuffixes.has(suffix)) return null;
  return { base: key.slice(0, index), suffix };
}

function catalogShape(flat: FlatCatalog) {
  const plain = new Set<string>();
  const plurals = new Map<string, Set<string>>();
  for (const key of flat.keys()) {
    const plural = pluralParts(key);
    if (!plural) {
      plain.add(key);
      continue;
    }
    const set = plurals.get(plural.base) ?? new Set<string>();
    set.add(plural.suffix);
    plurals.set(plural.base, set);
  }
  return { plain, plurals };
}

function compareCatalogs(args: {
  relDir: string;
  locale: LocaleCode;
  source: FlatCatalog;
  target: FlatCatalog;
  sourceShape: ReturnType<typeof catalogShape>;
}) {
  const errors: string[] = [];
  const targetShape = catalogShape(args.target);
  const pluralCategories = new Set(
    new Intl.PluralRules(args.locale).resolvedOptions().pluralCategories,
  );

  for (const key of args.sourceShape.plain) {
    if (!args.target.has(key)) {
      errors.push(`${args.relDir}/${args.locale}: missing key ${key}`);
      continue;
    }
    comparePlaceholders({
      errors,
      relDir: args.relDir,
      locale: args.locale,
      key,
      source: args.source.get(key) ?? "",
      target: args.target.get(key) ?? "",
    });
  }

  for (const key of targetShape.plain) {
    if (
      !args.sourceShape.plain.has(key) &&
      !args.sourceShape.plurals.has(key)
    ) {
      errors.push(`${args.relDir}/${args.locale}: stale key ${key}`);
    }
  }

  for (const [base] of args.sourceShape.plurals) {
    const targetSuffixes = targetShape.plurals.get(base);
    if (!targetSuffixes) {
      errors.push(`${args.relDir}/${args.locale}: missing plural key ${base}`);
      continue;
    }
    for (const category of pluralCategories) {
      if (!targetSuffixes.has(category)) {
        errors.push(
          `${args.relDir}/${args.locale}: missing plural category ${base}_${category}`,
        );
      }
    }
    for (const suffix of targetSuffixes) {
      if (!pluralCategories.has(suffix)) {
        errors.push(
          `${args.relDir}/${args.locale}: extra plural category ${base}_${suffix}`,
        );
      }
    }

    const sourcePlaceholders = unionPlaceholdersForPluralBase(
      args.source,
      base,
    );
    for (const suffix of targetSuffixes) {
      const key = `${base}_${suffix}`;
      comparePlaceholderSets({
        errors,
        relDir: args.relDir,
        locale: args.locale,
        key,
        source: sourcePlaceholders,
        target: extractPlaceholders(args.target.get(key) ?? ""),
      });
    }
  }

  for (const [base] of targetShape.plurals) {
    if (!args.sourceShape.plurals.has(base)) {
      errors.push(`${args.relDir}/${args.locale}: stale plural key ${base}`);
    }
  }

  return errors;
}

function comparePlaceholders(args: {
  errors: string[];
  relDir: string;
  locale: LocaleCode;
  key: string;
  source: string;
  target: string;
}) {
  comparePlaceholderSets({
    ...args,
    source: extractPlaceholders(args.source),
    target: extractPlaceholders(args.target),
  });
}

function comparePlaceholderSets(args: {
  errors: string[];
  relDir: string;
  locale: LocaleCode;
  key: string;
  source: Set<string>;
  target: Set<string>;
}) {
  for (const placeholder of args.source) {
    if (!args.target.has(placeholder)) {
      args.errors.push(
        `${args.relDir}/${args.locale}: ${args.key} is missing placeholder ${placeholder}`,
      );
    }
  }
  for (const placeholder of args.target) {
    if (!args.source.has(placeholder)) {
      args.errors.push(
        `${args.relDir}/${args.locale}: ${args.key} has extra placeholder ${placeholder}`,
      );
    }
  }
}

function unionPlaceholdersForPluralBase(flat: FlatCatalog, base: string) {
  const out = new Set<string>();
  for (const suffix of pluralSuffixes) {
    const value = flat.get(`${base}_${suffix}`);
    if (!value) continue;
    for (const placeholder of extractPlaceholders(value)) {
      out.add(placeholder);
    }
  }
  return out;
}

function extractPlaceholders(message: string): Set<string> {
  const out = new Set<string>();
  const i18nextPattern = /\{\{\s*([a-zA-Z_$][\w$]*)[^}]*\}\}/g;
  for (const match of message.matchAll(i18nextPattern)) {
    out.add(match[1]!);
  }

  const icuArgumentPattern =
    /(?<!\{)\{([a-zA-Z_$][\w$]*)(?:\s*,\s*(?:plural|select|number|date|time)\b[^{}]*)?\}(?!\})/g;
  for (const match of message.matchAll(icuArgumentPattern)) {
    out.add(match[1]!);
  }

  return out;
}

void main();
