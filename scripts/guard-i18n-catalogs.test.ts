import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  checkCatalogDevelopmentMarkers,
  checkCatalogKeyCoverage,
  checkLocalizedDocsCoverage,
  checkRawVisibleLiteralFile,
  checkStaleBaselineEntries,
  findCatalogDirs,
  findCorruptedLocalizedDocsIdentifiers,
  normalizeLocalizedDocSlug,
} from "./guard-i18n-catalogs";

describe("app catalog key coverage", () => {
  for (const [name, messages] of [
    ["a scalar parent", { share: "Own label" }],
    ["an object replacing a leaf", { share: { copy: { label: "Own label" } } }],
    ["an empty object replacing a leaf", { share: { copy: {} } }],
  ] as const) {
    it(`rejects a Core key shadowed by ${name}`, async () => {
      const fixture = mkdtempSync(path.join(os.tmpdir(), "catalog-shadow-"));
      const catalog = path.join(fixture, "app", "i18n");
      mkdirSync(catalog, { recursive: true });
      try {
        writeFileSync(
          path.join(catalog, "en-US.ts"),
          `export default ${JSON.stringify(messages)};`,
        );
        writeFileSync(
          path.join(fixture, "app", "View.tsx"),
          'const label = t("share.copy");',
        );
        const errors = await checkCatalogKeyCoverage([catalog]);
        assert.equal(errors.length, 1);
        assert.match(errors[0]!, /share\.copy/);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
  it("accepts Core fallback keys and still rejects missing app keys", async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "catalog-coverage-"));
    const catalog = path.join(fixture, "app", "i18n");
    mkdirSync(catalog, { recursive: true });
    try {
      writeFileSync(
        path.join(catalog, "en-US.ts"),
        'export default { workspace: { known: "Known" } };',
      );
      writeFileSync(
        path.join(fixture, "app", "View.tsx"),
        'const labels = [t("share.copy"), t("workspace.known"), t("workspace.missing")];',
      );
      const errors = await checkCatalogKeyCoverage([catalog]);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /workspace\.missing/);
      assert.doesNotMatch(errors[0]!, /share\.copy|workspace\.known/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
  it("only includes Toolkit keys for the actual imported factory and preserves shadowing", async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "catalog-toolkit-"));
    const catalog = path.join(fixture, "app", "i18n");
    mkdirSync(catalog, { recursive: true });
    const en = path.join(catalog, "en-US.ts");
    const entry = path.join(catalog, "index.ts");
    try {
      writeFileSync(
        path.join(fixture, "app", "View.tsx"),
        'const x = t("agentChat.share.loadFailed");',
      );
      writeFileSync(en, "export default {};");
      assert.equal((await checkCatalogKeyCoverage([catalog])).length, 1);
      writeFileSync(
        entry,
        'import { createToolkitI18nCatalog as make } from "@agent-native/toolkit/app/i18n"; import en from "./en-US"; export const unused = make({ messages: en }); export const i18nCatalog = { messages: en };',
      );
      assert.equal((await checkCatalogKeyCoverage([catalog])).length, 1);
      for (const options of [
        "{ messages: en, ...other }",
        "{ messages: en, messages: other }",
        "{ messages: en, [key]: other }",
        "{ messages: en, get messages() { return other; } }",
      ]) {
        writeFileSync(
          entry,
          `import { createToolkitI18nCatalog as make } from "@agent-native/toolkit/app/i18n"; import en from "./en-US"; export const i18nCatalog = make(${options});`,
        );
        assert.equal(
          (await checkCatalogKeyCoverage([catalog])).length,
          1,
          options,
        );
      }
      writeFileSync(
        entry,
        'import { createToolkitI18nCatalog as make } from "@agent-native/toolkit/app/i18n"; import en from "./en-US"; export const i18nCatalog = make({ messages: en });',
      );
      assert.deepEqual(await checkCatalogKeyCoverage([catalog]), []);
      writeFileSync(
        entry,
        'import { createToolkitI18nCatalog as make } from "@agent-native/toolkit/app/i18n"; import en from "./en-US"; export const i18nCatalog = { messages: en };',
      );
      assert.equal((await checkCatalogKeyCoverage([catalog])).length, 1);
      writeFileSync(
        entry,
        'import { createToolkitI18nCatalog as make } from "@agent-native/toolkit/app/i18n"; import en from "./en-US"; export const i18nCatalog = make({ messages: en });',
      );
      writeFileSync(en, 'export default { agentChat: { share: "shadow" } };');
      // A distinct URL avoids module-cache reuse when loading a revised fixture.
      const shadowCatalog = path.join(fixture, "shadow", "app", "i18n");
      mkdirSync(shadowCatalog, { recursive: true });
      writeFileSync(
        path.join(shadowCatalog, "en-US.ts"),
        'export default { agentChat: { share: "shadow" } };',
      );
      writeFileSync(
        path.join(shadowCatalog, "index.ts"),
        'import { createToolkitI18nCatalog as make } from "@agent-native/toolkit/app/i18n"; import en from "./en-US"; export const i18nCatalog = make({ messages: en });',
      );
      writeFileSync(
        path.join(fixture, "shadow", "app", "View.tsx"),
        'const x = t("agentChat.share.loadFailed");',
      );
      assert.equal((await checkCatalogKeyCoverage([shadowCatalog])).length, 1);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("i18n catalog locations", () => {
  it("checks Toolkit app catalogs instead of the removed Core UI catalog", () => {
    const catalogDirs = new Set(
      findCatalogDirs().map((dir) => path.relative(process.cwd(), dir)),
    );

    assert.ok(catalogDirs.has("packages/toolkit/src/app/i18n/catalogs"));
    assert.ok(!catalogDirs.has("packages/core/src/localization/core-messages"));
  });
});

describe("localized documentation identifiers", () => {
  it("does not match a prefix of a legitimate API identifier", () => {
    assert.deepEqual(
      findCorruptedLocalizedDocsIdentifiers(
        "`PromptHomeLibrary`, `PromptHomeLibraryProps`, and `PromptComposer`",
      ),
      [],
    );
  });

  it("still rejects translated composer identifiers as whole tokens", () => {
    for (const identifier of ["PromptKomponierer", "PromptGénérateur"]) {
      assert.deepEqual(
        findCorruptedLocalizedDocsIdentifiers(`Use \`${identifier}\` here.`),
        [identifier],
      );
    }
  });
});

describe("raw visible literal scanning", () => {
  it("skips generic parameter fragments only in JSX-text candidates", () => {
    const source = `
const restore = (
  current: Record<string, string>,
  missingFileIds: ReadonlySet<string>,
  restoredFilesById: ReadonlyMap<string, Snapshot>,
  meta?: Parameters<StyleChangeHandler>[2],
) => {};
function render(callback: () => Promise<{ value: string }>, next: ReadonlySet<string>) {}
const button = <button>Delete layer</button>;
const parametersButton = <button>Text parameters</button>;
const jsxTypeLikeText = <div>, missingFileIds: ReadonlySet</div>;
const jsxStatus = <div>, status: Ready<Icon /></div>;
const component = <Button aria-label="Open color picker" />;
const status = <Button aria-label=", status: Ready" />;
toast.error(", status: Ready");
`;
    const file = "packages/core/src/client/CommandMenu.tsx";

    assert.deepEqual(
      checkRawVisibleLiteralFile(file, source).map(({ id }) => id),
      [
        `${file}|Delete layer`,
        `${file}|Text parameters`,
        `${file}|, missingFileIds: ReadonlySet`,
        `${file}|, status: Ready`,
        `${file}|Open color picker`,
        `${file}|, status: Ready`,
        `${file}|, status: Ready`,
      ],
    );
  });

  it("distinguishes JSX copy from comparisons and generic type syntax", () => {
    const file = "templates/design/comparisons.tsx";
    const source = `
const result = content.querySelector<HTMLElement>("button");
const value = day > 12 && day < limit;
const other = codePoint > 0 && codePoint < 128;
type Args = Parameters<Fn>[0];
const view = <div>Visible English<span>workspace.rawKey</span></div>;
const button = <Button aria-label="Open color picker" />;
toast.error("Save failed");
`;
    assert.deepEqual(
      checkRawVisibleLiteralFile(file, source).map(({ id }) => id),
      [
        `${file}|Visible English`,
        `${file}|workspace.rawKey`,
        `${file}|Open color picker`,
        `${file}|Save failed`,
      ],
    );
  });

  it("does not mistake a closing JSX tag for a generic type", () => {
    const source = `
const content = <div>Visible text</div>, status: Ready;
`;

    assert.deepEqual(
      checkRawVisibleLiteralFile("templates/design/example.tsx", source).map(
        ({ id }) => id,
      ),
      ["templates/design/example.tsx|Visible text"],
    );
  });

  it("skips nested TypeScript type arguments while reporting matching UI text", () => {
    const cases = [
      {
        file: "templates/design/nested-types.ts",
        source: `
const tokens = new Map<NativePresentationLease<Context>, LeaseState<Context>>();
const result = task.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
  onFulfilled,
  onRejected,
);
`,
      },
      {
        file: "templates/design/nested-types.tsx",
        source: `
type Slots = Map<NativePresentationLease<Context>, LeaseState<Context>>;
const result = task.then<PromiseSettledResult<void>, PromiseSettledResult<void>>();
const message = <span>, LeaseState</span>;
const toast = <Button aria-label=", PromiseSettledResult" />;
toast.error(", LeaseState");
`,
      },
    ];

    assert.deepEqual(
      cases.flatMap(({ file, source }) =>
        checkRawVisibleLiteralFile(file, source).map(({ id }) => id),
      ),
      [
        "templates/design/nested-types.tsx|, LeaseState",
        "templates/design/nested-types.tsx|, PromiseSettledResult",
        "templates/design/nested-types.tsx|, LeaseState",
      ],
    );
  });
});

describe("catalog development markers", () => {
  it("rejects the localization marker from non-English values", () => {
    assert.deepEqual(
      checkCatalogDevelopmentMarkers({
        relDir: "templates/clips/app/i18n",
        locale: "pt-BR",
        target: new Map([
          ["recordRoute.clipsRecorder", "Clips recorder (Localizado)"],
        ]),
      }),
      [
        'templates/clips/app/i18n/pt-BR: recordRoute.clipsRecorder contains the development-only localization marker "(Localizado)" — remove it before shipping',
      ],
    );
  });

  it("allows ordinary localized values", () => {
    assert.deepEqual(
      checkCatalogDevelopmentMarkers({
        relDir: "templates/clips/app/i18n",
        locale: "es-ES",
        target: new Map([["recordRoute.clipsRecorder", "Grabador de Clips"]]),
      }),
      [],
    );
  });
});

describe("localized documentation coverage", () => {
  it("normalizes md and mdx extensions to the same slug", () => {
    assert.equal(normalizeLocalizedDocSlug("guide.md"), "guide");
    assert.equal(normalizeLocalizedDocSlug("guide.mdx"), "guide");
  });

  it("normalizes nested Windows and POSIX paths to slash-separated slugs", () => {
    assert.equal(
      normalizeLocalizedDocSlug("nested\\deeper\\guide.mdx"),
      "nested/deeper/guide",
    );
    assert.equal(
      normalizeLocalizedDocSlug("./nested/deeper/guide.md"),
      "nested/deeper/guide",
    );
  });

  it("sorts and deduplicates issue IDs from unsorted inputs", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["z.mdx", "a.md", "a.mdx"],
      localizedSlugsByLocale: new Map([
        ["fr-FR", ["z.md"]],
        ["de-DE", []],
      ]),
      supportedLocales: ["fr-FR", "en-US", "de-DE", "fr-FR"],
      defaultLocale: "en-US",
      baseline: new Set(),
    });

    assert.deepEqual(result.issueIds, ["de-DE|a", "de-DE|z", "fr-FR|a"]);
  });

  it("suppresses existing debt but reports a newly missing source slug", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["existing.mdx", "new-guide.mdx"],
      localizedSlugsByLocale: new Map([["de-DE", []]]),
      supportedLocales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      baseline: new Set(["de-DE|existing"]),
    });

    assert.deepEqual(result.issueIds, ["de-DE|existing", "de-DE|new-guide"]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? "", /new-guide/);
  });

  it("makes an old baseline entry stale after localized coverage is added", () => {
    const baseline = new Set(["de-DE|guide"]);
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["guide.mdx"],
      localizedSlugsByLocale: new Map([["de-DE", ["guide.md"]]]),
      supportedLocales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      baseline,
    });

    assert.deepEqual(result.issueIds, []);
    assert.deepEqual(
      checkStaleBaselineEntries(
        baseline,
        result.issueIds,
        "scripts/i18n-localized-doc-coverage-baseline.txt",
      ).map((message) => message.includes("de-DE|guide")),
      [true],
    );
  });

  it("treats a missing supported-locale directory as empty coverage", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["guide.mdx"],
      localizedSlugsByLocale: new Map(),
      supportedLocales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      baseline: new Set(),
    });

    assert.deepEqual(result.issueIds, ["de-DE|guide"]);
  });

  it("never treats the default locale as a localized target", () => {
    const result = checkLocalizedDocsCoverage({
      sourceSlugs: ["guide.mdx"],
      localizedSlugsByLocale: new Map(),
      supportedLocales: ["en-US"],
      defaultLocale: "en-US",
      baseline: new Set(),
    });

    assert.deepEqual(result, { errors: [], issueIds: [] });
  });
});
