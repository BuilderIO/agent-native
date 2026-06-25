import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  errors.push(...(await checkCatalogScriptContamination(catalogDirs)));
  errors.push(...(await checkCatalogKeyCoverage(catalogDirs)));

  const catalogEnglishValueResult =
    await checkCatalogEnglishValueDebt(catalogDirs);
  if (process.env.UPDATE_I18N_CATALOG_VALUE_BASELINE === "1") {
    writeFileSync(
      catalogEnglishValueBaselinePath,
      [
        "# Existing non-English catalog values that still exactly match English.",
        "# Keep this file sorted. Remove entries as catalogs get translated.",
        "# Format: relative/catalog/locale|key|English source string",
        ...catalogEnglishValueResult.issueIds,
        "",
      ].join("\n"),
    );
    console.log(
      `[guard:i18n-catalogs] updated ${path.relative(
        rootDir,
        catalogEnglishValueBaselinePath,
      )} with ${catalogEnglishValueResult.issueIds.length} entries`,
    );
  } else {
    errors.push(...catalogEnglishValueResult.errors);
    errors.push(
      ...checkStaleBaselineEntries(
        readCatalogEnglishValueBaseline(),
        catalogEnglishValueResult.issueIds,
        catalogEnglishValueBaselinePath,
      ),
    );
  }

  const rawLiteralResult = checkRawVisibleLiterals();
  if (process.env.UPDATE_I18N_RAW_LITERAL_BASELINE === "1") {
    writeFileSync(
      rawLiteralBaselinePath,
      [
        "# Existing raw visible UI literals.",
        "# Keep this file sorted. Remove entries as surfaces move to i18n.",
        "# Format: relative/source/path.tsx|Visible string",
        ...rawLiteralResult.issueIds,
        "",
      ].join("\n"),
    );
    console.log(
      `[guard:i18n-catalogs] updated ${path.relative(
        rootDir,
        rawLiteralBaselinePath,
      )} with ${rawLiteralResult.issueIds.length} entries`,
    );
  } else {
    errors.push(...rawLiteralResult.errors);
    errors.push(
      ...checkStaleBaselineEntries(
        readRawLiteralBaseline(),
        rawLiteralResult.issueIds,
        rawLiteralBaselinePath,
      ),
    );
  }

  const localizedDocsResult = checkLocalizedDocsEmbeddedStrings();
  if (process.env.UPDATE_I18N_DOCS_BASELINE === "1") {
    writeFileSync(
      localizedDocsBaselinePath,
      [
        "# Existing localized docs strings that still match English source.",
        "# Keep this file sorted. Remove entries as translated docs improve.",
        "# Format: relative/localized/path.md|English source string",
        ...localizedDocsResult.issueIds,
        "",
      ].join("\n"),
    );
    console.log(
      `[guard:i18n-catalogs] updated ${path.relative(
        rootDir,
        localizedDocsBaselinePath,
      )} with ${localizedDocsResult.issueIds.length} entries`,
    );
  } else {
    errors.push(...localizedDocsResult.errors);
    errors.push(
      ...checkStaleBaselineEntries(
        readLocalizedDocsBaseline(),
        localizedDocsResult.issueIds,
        localizedDocsBaselinePath,
      ),
    );
  }
  errors.push(...checkLocalizedDocsProtectedIdentifiers());

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

async function checkCatalogKeyCoverage(catalogDirs: string[]) {
  const errors: string[] = [];
  for (const dir of catalogDirs) {
    const sourceCatalog = path.join(dir, `${DEFAULT_LOCALE}.ts`);
    if (!existsSync(sourceCatalog)) continue;

    const source = await loadFlatCatalog(sourceCatalog);
    if (source.errors.length > 0) continue;
    const sourceKeys = source.flat;
    const sourceRoot = path.dirname(dir);

    for (const file of collectSourceFiles(sourceRoot)) {
      const rel = path.relative(rootDir, file);
      if (
        rel.includes("/i18n/") ||
        rawLiteralFileIgnore.some((part) => rel.includes(part))
      ) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (!text.includes("useT") && !text.includes("t(")) continue;
      const lines = text.split(/\r?\n/);

      for (const match of text.matchAll(/\bt\(\s*(["'`])([^"'`]+)\1/g)) {
        const key = match[2];
        if (key?.includes("${")) continue;
        if (!key || hasCatalogKey(sourceKeys, key)) continue;
        const line = lineNumberAt(text, match.index ?? 0);
        const lineText = lines[line - 1] ?? "";
        if (lineText.includes("i18n-key-ignore")) continue;
        errors.push(
          `${rel}:${line}: i18n key "${key}" is missing from ${path.relative(
            rootDir,
            sourceCatalog,
          )}; add the English fallback string or // i18n-key-ignore for a deliberate dynamic/stable key`,
        );
      }
    }
  }
  return errors;
}

function hasCatalogKey(flat: FlatCatalog, key: string) {
  return (
    flat.has(key) ||
    flat.has(`${key}_zero`) ||
    flat.has(`${key}_one`) ||
    flat.has(`${key}_two`) ||
    flat.has(`${key}_few`) ||
    flat.has(`${key}_many`) ||
    flat.has(`${key}_other`)
  );
}

async function checkCatalogEnglishValueDebt(catalogDirs: string[]) {
  const errors: string[] = [];
  const issueIds = new Set<string>();
  const baseline = readCatalogEnglishValueBaseline();
  const noTranslateTerms = readNoTranslateTerms();

  for (const dir of catalogDirs) {
    const relDir = path.relative(rootDir, dir);
    const sourceCatalog = path.join(dir, `${DEFAULT_LOCALE}.ts`);
    if (!existsSync(sourceCatalog)) continue;

    const source = await loadFlatCatalog(sourceCatalog);
    if (source.errors.length > 0) continue;

    for (const file of safeReadDir(dir).sort()) {
      if (!file.endsWith(".ts") || file === "index.ts") continue;
      const locale = file.replace(/\.ts$/, "");
      if (locale === DEFAULT_LOCALE || !supportedLocaleSet.has(locale)) {
        continue;
      }
      const target = await loadFlatCatalog(path.join(dir, file));
      if (target.errors.length > 0) continue;

      for (const [key, sourceValue] of source.flat) {
        const targetValue = target.flat.get(key);
        if (targetValue !== sourceValue) continue;
        if (noTranslateTerms.has(sourceValue)) continue;
        if (!isLikelyVisibleLiteral(sourceValue)) continue;
        const id = `${relDir}/${locale}|${key}|${sourceValue}`;
        issueIds.add(id);
        if (baseline.has(id)) continue;
        errors.push(
          `${relDir}/${locale}: ${key} still exactly matches English "${sourceValue}" — translate it, add the source string to ${path.relative(
            rootDir,
            noTranslateTermsPath,
          )}, or update ${path.relative(
            rootDir,
            catalogEnglishValueBaselinePath,
          )}`,
        );
      }
    }
  }

  return { errors, issueIds: [...issueIds].sort() };
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
  for (const file of localeFiles.values()) {
    errors.push(...checkDuplicateTopLevelCatalogKeys(file));
  }
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

async function checkCatalogScriptContamination(
  catalogDirs: string[],
): Promise<string[]> {
  const errors: string[] = [];
  for (const dir of catalogDirs) {
    const relDir = path.relative(rootDir, dir);
    for (const file of safeReadDir(dir).sort()) {
      if (!file.endsWith(".ts") || file === "index.ts") continue;
      const locale = file.replace(/\.ts$/, "");
      if (locale === DEFAULT_LOCALE || !supportedLocaleSet.has(locale)) {
        continue;
      }

      const target = await loadFlatCatalog(path.join(dir, file));
      if (target.errors.length > 0) continue;
      for (const [key, value] of target.flat) {
        const scripts = disallowedScriptsForLocale(locale as LocaleCode, value);
        if (scripts.length === 0) continue;
        errors.push(
          `${relDir}/${locale}: ${key} contains ${scripts.join(
            ", ",
          )} text; fix the locale translation or add a stable no-translate term only when this is intentional`,
        );
      }
    }
  }
  return errors;
}

function disallowedScriptsForLocale(locale: LocaleCode, value: string) {
  const scripts: string[] = [];
  if (
    !["zh-CN", "ja-JP", "ko-KR"].includes(locale) &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      value,
    )
  ) {
    scripts.push("CJK-script");
  }
  if (locale !== "ar-SA" && /\p{Script=Arabic}/u.test(value)) {
    scripts.push("Arabic-script");
  }
  if (locale !== "hi-IN" && /\p{Script=Devanagari}/u.test(value)) {
    scripts.push("Devanagari-script");
  }
  return scripts;
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

function checkDuplicateTopLevelCatalogKeys(file: string) {
  const rel = path.relative(rootDir, file);
  const text = readFileSync(file, "utf8");
  const start = findCatalogObjectStart(text);
  if (start < 0) return [];

  const errors: string[] = [];
  const seen = new Map<string, number>();
  let depth = 1;
  let index = start;
  let line = lineNumberAt(text, start);
  let atPropertyStart = true;
  let inString: string | null = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  const readIdentifier = (from: number) => {
    const match = text.slice(from).match(/^[$A-Z_a-z][$\w]*/);
    return match?.[0] ?? null;
  };

  while (index < text.length && depth > 0) {
    const ch = text[index]!;
    const next = text[index + 1];
    if (ch === "\n") line += 1;

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      index += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      index += 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      atPropertyStart = true;
      index += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      atPropertyStart = false;
      index += 1;
      continue;
    }
    if (depth === 1 && ch === ",") {
      atPropertyStart = true;
      index += 1;
      continue;
    }

    if (depth === 1 && atPropertyStart) {
      if (/\s/.test(ch)) {
        index += 1;
        continue;
      }
      const key = readIdentifier(index);
      if (key) {
        let afterKey = index + key.length;
        while (/\s/.test(text[afterKey] ?? "")) afterKey += 1;
        if (text[afterKey] === ":") {
          const previousLine = seen.get(key);
          if (previousLine) {
            errors.push(
              `${rel}:${line}: duplicate top-level i18n catalog key "${key}" also defined on line ${previousLine}; duplicate keys overwrite earlier translations`,
            );
          } else {
            seen.set(key, line);
          }
        }
        atPropertyStart = false;
        index = afterKey + 1;
        continue;
      }
      atPropertyStart = false;
    }
    index += 1;
  }

  return errors;
}

function findCatalogObjectStart(text: string) {
  for (const pattern of [
    /const\s+(?:messages|enUS|catalog|docsMessages)\s*=\s*\{/g,
    /export\s+default\s+\{/g,
  ]) {
    const match = pattern.exec(text);
    if (match) return match.index + match[0].length;
  }
  return -1;
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
      if (
        !pluralCategories.has(suffix) &&
        !args.sourceShape.plurals.get(base)?.has(suffix)
      ) {
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

const rawLiteralRoots = [
  "packages/docs/app/components",
  "packages/docs/app/routes/_index.tsx",
  "packages/docs/app/routes/skills.tsx",
  "packages/docs/app/routes/templates._index.tsx",
  "packages/docs/app/routes/templates.$slug.tsx",
  ...safeReadDir(path.join(rootDir, "templates")).flatMap((template) => [
    path.join("templates", template, "app", "components"),
    path.join("templates", template, "app", "pages"),
    path.join("templates", template, "app", "routes"),
  ]),
];

const rawLiteralBaselinePath = path.join(
  rootDir,
  "scripts",
  "i18n-raw-literal-baseline.txt",
);

const catalogEnglishValueBaselinePath = path.join(
  rootDir,
  "scripts",
  "i18n-catalog-english-value-baseline.txt",
);

const localizedDocsBaselinePath = path.join(
  rootDir,
  "scripts",
  "i18n-localized-docs-baseline.txt",
);

const noTranslateTermsPath = path.join(
  rootDir,
  "scripts",
  "i18n-no-translate-terms.txt",
);

const rawLiteralFileIgnore = [
  ".test.",
  ".spec.",
  ".stories.",
  "/ui/",
  "/__tests__/",
];

const rawLiteralAttributeNames = [
  "aria-label",
  "aria-description",
  "placeholder",
  "title",
  "alt",
  "label",
];

const rawLiteralObjectPropertyNames = [
  "actionLabel",
  "ariaLabel",
  "badge",
  "caption",
  "description",
  "emptyDescription",
  "emptyStateText",
  "emptyTitle",
  "heading",
  "helperText",
  "label",
  "message",
  "name",
  "placeholder",
  "searchPlaceholder",
  "subtitle",
  "summary",
  "text",
  "title",
  "tooltip",
];

const rawLiteralCallNames = [
  "toast.error",
  "toast.info",
  "toast.message",
  "toast.success",
  "toast.warning",
];

const rawLiteralAllowPatterns = [
  /^(?:Agent-Native|GitHub|LinkedIn|HubSpot)$/,
  /^[A-Z0-9_./:@#?&=%+ -]+$/,
  /^[a-z0-9_./:@#?&=%+ -]+$/,
  /^\d+$/,
  /^(?:GET|POST|PUT|PATCH|DELETE)\s+\/[^\s]+$/,
  /^\/[_a-zA-Z0-9./:$*?-]+$/,
  /^[$A-Z_a-z][$\w]*\(\)$/,
  /^(?=.*[a-z])(?=.*[A-Z])[$A-Z_a-z][$\w]*$/,
  /^[A-Z][a-zA-Z]+(?:\.[a-zA-Z]+)+$/,
  /^https?:\/\//,
  /^#[a-zA-Z0-9_-]+$/,
];
const codeLikeRawLiteralPattern =
  /[{}();=<>]|\b(?:const|let|return|useState|useRef|useMemo|ReactNode|Record|Map|Set|Promise|queryClient|undefined|null|true|false)\b/;

function readRawLiteralBaseline() {
  return readLineBaseline(rawLiteralBaselinePath);
}

function readCatalogEnglishValueBaseline() {
  return readLineBaseline(catalogEnglishValueBaselinePath);
}

function readLocalizedDocsBaseline() {
  return readLineBaseline(localizedDocsBaselinePath);
}

function readNoTranslateTerms() {
  return readLineBaseline(noTranslateTermsPath);
}

function readLineBaseline(file: string) {
  if (!existsSync(file)) return new Set<string>();
  return new Set(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

function checkStaleBaselineEntries(
  baseline: Set<string>,
  currentIssueIds: string[],
  file: string,
) {
  const current = new Set(currentIssueIds);
  return [...baseline]
    .filter((entry) => !current.has(entry))
    .map(
      (entry) =>
        `${path.relative(
          rootDir,
          file,
        )}: stale baseline entry no longer matches current i18n debt "${entry}" — remove it or run the matching UPDATE_I18N_*_BASELINE command`,
    );
}

function checkRawVisibleLiterals(): { errors: string[]; issueIds: string[] } {
  const errors: string[] = [];
  const issueIds = new Set<string>();
  const baseline = readRawLiteralBaseline();
  for (const entry of rawLiteralRoots) {
    const abs = path.join(rootDir, entry);
    if (!existsSync(abs)) continue;
    const files = collectSourceFiles(abs);
    for (const file of files) {
      const rel = path.relative(rootDir, file);
      if (rawLiteralFileIgnore.some((part) => rel.includes(part))) continue;
      const text = readFileSync(file, "utf8");
      const issues = checkRawVisibleLiteralFile(rel, text);
      for (const issue of issues) {
        issueIds.add(issue.id);
        if (baseline.has(issue.id)) continue;
        errors.push(issue.message);
      }
    }
  }
  return { errors, issueIds: [...issueIds].sort() };
}

function collectSourceFiles(entry: string): string[] {
  if (!existsSync(entry)) return [];
  const basename = path.basename(entry);
  if (
    basename === "node_modules" ||
    basename === "dist" ||
    basename === ".cache"
  ) {
    return [];
  }
  const stat = readdirOrFile(entry);
  if (stat.type === "file") return isSourceFile(entry) ? [entry] : [];
  const out: string[] = [];
  for (const child of safeReadDir(entry)) {
    out.push(...collectSourceFiles(path.join(entry, child)));
  }
  return out;
}

function readdirOrFile(entry: string): { type: "file" | "dir" } {
  try {
    const stat = statSync(entry);
    return { type: stat.isDirectory() ? "dir" : "file" };
  } catch {
    return { type: "file" };
  }
}

function isSourceFile(file: string): boolean {
  return /\.(tsx?|jsx?)$/.test(file);
}

function checkRawVisibleLiteralFile(
  rel: string,
  text: string,
): Array<{ id: string; message: string }> {
  if (text.includes("i18n-raw-literal-disable-file")) return [];
  const issues: Array<{ id: string; message: string }> = [];
  const lines = text.split(/\r?\n/);
  const report = (index: number, value: string) => {
    const line = lineNumberAt(text, index);
    const lineText = lines[line - 1] ?? "";
    if (lineText.includes("i18n-ignore")) return;
    if (/^\s*(?:\/\/|\*)/.test(lineText)) return;
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!isLikelyVisibleLiteral(trimmed)) return;
    const id = `${rel}|${trimmed}`;
    issues.push({
      id,
      message: `${rel}:${line}: raw visible string "${trimmed}" must use i18n, add // i18n-ignore, or update ${path.relative(
        rootDir,
        rawLiteralBaselinePath,
      )}`,
    });
  };

  for (const match of text.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    report(match.index ?? 0, match[1] ?? "");
  }

  const attrPattern = new RegExp(
    `\\b(?:${rawLiteralAttributeNames.join("|")})="([^"{]*[A-Za-z][^"]*)"`,
    "g",
  );
  for (const match of text.matchAll(attrPattern)) {
    report(match.index ?? 0, match[1] ?? "");
  }

  const propertyPattern = new RegExp(
    `\\b(?:${rawLiteralObjectPropertyNames.join(
      "|",
    )})\\s*:\\s*(["'\`])([^"'\\\`]*[A-Za-z][^"'\\\`]*)\\1`,
    "g",
  );
  for (const match of text.matchAll(propertyPattern)) {
    report(match.index ?? 0, match[2] ?? "");
  }

  const callPattern = new RegExp(
    `\\b(?:${rawLiteralCallNames
      .map(escapeRegExp)
      .join("|")})\\s*\\(\\s*(["'\`])([^"'\\\`]*[A-Za-z][^"'\\\`]*)\\1`,
    "g",
  );
  for (const match of text.matchAll(callPattern)) {
    report(match.index ?? 0, match[2] ?? "");
  }

  return issues;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function isLikelyVisibleLiteral(value: string): boolean {
  if (value.length < 3) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (value.includes("{") || value.includes("}")) return false;
  if (codeLikeRawLiteralPattern.test(value)) return false;
  return !rawLiteralAllowPatterns.some((pattern) => pattern.test(value));
}

const localizedDocsDir = path.join(
  rootDir,
  "packages",
  "core",
  "docs",
  "content",
  "locales",
);
const sourceDocsDir = path.join(rootDir, "packages", "core", "docs", "content");
const localizedDocsStringProperties = [
  "body",
  "label",
  "note",
  "summary",
  "title",
];

const protectedLocalizedDocsIdentifiers = [
  "AgentComposerFrame",
  "PromptComposer",
  "TiptapComposer",
  "buildPromptComposerSubmission",
  "encodeComposerDraft",
  "message/send",
];

const corruptedLocalizedDocsIdentifierPatterns = [
  /Prompt(?!Composer)[\p{L}]+r/u,
  /Agent(?!ComposerFrame)[\p{L}]+rFrame/u,
  /Tiptap(?!Composer)[\p{L}]+r/u,
  /buildPrompt(?!ComposerSubmission)[\p{L}]+rSubmission/u,
  /encode(?!ComposerDraft)[\p{L}]+Draft/u,
  /Nachricht\/send/u,
];

function checkLocalizedDocsEmbeddedStrings(): {
  errors: string[];
  issueIds: string[];
} {
  const errors: string[] = [];
  const issueIds = new Set<string>();
  const baseline = readLocalizedDocsBaseline();
  const noTranslateTerms = readNoTranslateTerms();
  if (!existsSync(localizedDocsDir)) return { errors, issueIds: [] };

  for (const locale of safeReadDir(localizedDocsDir).sort()) {
    if (!supportedLocaleSet.has(locale)) continue;
    const localeDir = path.join(localizedDocsDir, locale);
    for (const file of collectMarkdownFiles(localeDir)) {
      const relWithinLocale = path.relative(localeDir, file);
      const sourceFile = path.join(sourceDocsDir, relWithinLocale);
      if (!existsSync(sourceFile)) continue;
      const localizedText = readFileSync(file, "utf8");
      if (localizedText.includes("i18n-docs-ignore")) continue;

      const sourceStrings = extractEmbeddedDocsStrings(
        readFileSync(sourceFile, "utf8"),
      );
      if (sourceStrings.length === 0) continue;

      const rel = path.relative(rootDir, file);
      for (const source of sourceStrings) {
        if (noTranslateTerms.has(source)) continue;
        if (!containsSourcePhrase(localizedText, source)) continue;
        const id = `${rel}|${source}`;
        issueIds.add(id);
        if (baseline.has(id)) continue;
        errors.push(
          `${rel}: embedded docs string still matches English source "${source}" — translate it, add <!-- i18n-docs-ignore -->, or update ${path.relative(
            rootDir,
            localizedDocsBaselinePath,
          )}`,
        );
      }
    }
  }
  return { errors, issueIds: [...issueIds].sort() };
}

function checkLocalizedDocsProtectedIdentifiers(): string[] {
  const errors: string[] = [];
  if (!existsSync(localizedDocsDir)) return errors;

  for (const locale of safeReadDir(localizedDocsDir).sort()) {
    if (!supportedLocaleSet.has(locale)) continue;
    const localeDir = path.join(localizedDocsDir, locale);
    for (const file of collectMarkdownFiles(localeDir)) {
      const relWithinLocale = path.relative(localeDir, file);
      const sourceFile = path.join(sourceDocsDir, relWithinLocale);
      if (!existsSync(sourceFile)) continue;

      const sourceText = readFileSync(sourceFile, "utf8");
      const localizedText = readFileSync(file, "utf8");
      const rel = path.relative(rootDir, file);

      for (const identifier of protectedLocalizedDocsIdentifiers) {
        if (!sourceText.includes(identifier)) continue;
        if (localizedText.includes(identifier)) continue;
        errors.push(
          `${rel}: protected docs identifier "${identifier}" is missing; code/API identifiers must not be translated`,
        );
      }

      for (const pattern of corruptedLocalizedDocsIdentifierPatterns) {
        const match = localizedText.match(pattern);
        if (!match) continue;
        errors.push(
          `${rel}: likely translated/corrupted code identifier "${match[0]}" must be restored to the English API identifier`,
        );
      }
    }
  }

  return errors;
}

function containsSourcePhrase(text: string, source: string) {
  if (!text.includes(source)) return false;
  if (!/^[\w -]+$/.test(source)) return true;
  const escaped = escapeRegExp(source).replace(/\s+/g, "\\s+");
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
    "u",
  ).test(text);
}

function collectMarkdownFiles(entry: string): string[] {
  if (!existsSync(entry)) return [];
  const stat = readdirOrFile(entry);
  if (stat.type === "file") return entry.endsWith(".md") ? [entry] : [];
  const out: string[] = [];
  for (const child of safeReadDir(entry)) {
    out.push(...collectMarkdownFiles(path.join(entry, child)));
  }
  return out;
}

function extractEmbeddedDocsStrings(text: string): string[] {
  if (text.includes("i18n-docs-ignore")) return [];
  const strings = new Set<string>();
  const fencePattern = /^```([^\n]*)\n([\s\S]*?)^```/gm;
  for (const match of text.matchAll(fencePattern)) {
    const fenceInfo = match[1] ?? "";
    const body = match[2] ?? "";
    const isAgentNativeBlock = fenceInfo.startsWith("an-");

    if (isAgentNativeBlock) {
      for (const attr of ["title", "summary"]) {
        const attrPattern = new RegExp(`\\b${attr}="([^"]+)"`, "g");
        for (const attrMatch of fenceInfo.matchAll(attrPattern)) {
          addLikelyTranslatableDocsString(strings, attrMatch[1] ?? "");
        }
      }

      const propertyPattern = new RegExp(
        `"(${localizedDocsStringProperties.join(
          "|",
        )})"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
        "g",
      );
      for (const propMatch of body.matchAll(propertyPattern)) {
        addLikelyTranslatableDocsString(
          strings,
          unescapeJsonString(propMatch[2] ?? ""),
        );
      }

      const htmlPattern = /"html"\s*:\s*"((?:\\.|[^"\\])*)"/g;
      for (const htmlMatch of body.matchAll(htmlPattern)) {
        for (const htmlString of extractVisibleHtmlStrings(
          unescapeJsonString(htmlMatch[1] ?? ""),
        )) {
          addLikelyTranslatableDocsString(strings, htmlString);
        }
      }
    }

    for (const line of body.split(/\r?\n/)) {
      const comment = line.match(/#\s+(.+)$/)?.[1];
      if (comment) addLikelyTranslatableDocsString(strings, comment);
    }
  }
  return [...strings].sort();
}

function addLikelyTranslatableDocsString(out: Set<string>, value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!isLikelyVisibleLiteral(trimmed)) return;
  out.add(trimmed);
}

function extractVisibleHtmlStrings(html: string): string[] {
  const withoutCode = html
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutCode
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|span|small|strong|h[1-6])>/gi, "\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return text
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&rarr;/g, "->")
    .replace(/&darr;/g, "v")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

void main();
