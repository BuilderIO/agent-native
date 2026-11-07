import assert from "node:assert/strict";
import test from "node:test";

import {
  browserModules,
  devModuleUrl,
  emptyBrowserRoots,
  findBlockedModuleNames,
  uncheckedUnits,
} from "./guard-blocker-safe-module-names";

test("maps every browser root to the URL it is served at", () => {
  for (const [file, url] of [
    [
      "packages/core/src/localization/core-messages.ts",
      "/@fs/node_modules/@agent-native/core/dist/localization/core-messages.js",
    ],
    [
      "packages/toolkit/src/styles.css",
      "/@fs/node_modules/@agent-native/toolkit/dist/styles.css",
    ],
    [
      "packages/shared-app-config/templates.ts",
      "/@fs/node_modules/@agent-native/shared-app-config/dist/templates.js",
    ],
    [
      "packages/core/docs/content/getting-started.md",
      "/@fs/packages/core/docs/content/getting-started.md?raw",
    ],
    [
      "packages/core/docs/content/locales/ja-JP/actions.mdx",
      "/@fs/packages/core/docs/content/locales/ja-JP/actions.mdx?raw",
    ],
    ["templates/chat/app/routes/_index.tsx", "/app/routes/_index.tsx"],
    ["templates/chat/app/locales/en-US.json", "/app/locales/en-US.json"],
    ["templates/mail/shared/types.ts", "/shared/types.ts"],
    [
      "templates/content/actions/_builder-cms-write-adapter.js",
      "/actions/_builder-cms-write-adapter.js",
    ],
    [
      "templates/analytics/server/lib/dbt-connection.ts",
      "/server/lib/dbt-connection.ts",
    ],
    [
      "templates/design/.generated/bridge/editor-chrome.generated.ts",
      "/.generated/bridge/editor-chrome.generated.ts",
    ],
    ["community-templates/account-expert/app/root.tsx", "/app/root.tsx"],
    ["community-templates/account-expert/public/sw.js", "/sw.js"],
    ["templates/clips/public/sw.js", "/sw.js"],
    ["packages/docs/app/root.tsx", "/app/root.tsx"],
    ["packages/docs/lib/docs-nav.ts", "/lib/docs-nav.ts"],
    ["packages/docs/public/search.js", "/search.js"],
    ["packages/frame/client/main.ts", "/client/main.ts"],
    ["templates/chat/CHANGELOG.md", "/CHANGELOG.md"],
    [
      "packages/docs/app/legal-policies/privacy.md",
      "/app/legal-policies/privacy.md",
    ],
    [
      "packages/toolkit/src/app/shared/ocean/noise.wgsl",
      "/@fs/node_modules/@agent-native/toolkit/dist/app/shared/ocean/noise.wgsl",
    ],
    [
      "templates/clips/public/mediapipe/selfie_segmenter.tflite",
      "/mediapipe/selfie_segmenter.tflite",
    ],
  ] as const) {
    assert.equal(devModuleUrl(file), url, file);
  }
});

test("ignores tests, type declarations and files outside every root", () => {
  for (const file of [
    "packages/core/src/localization/consent-banner-messages.spec.ts",
    "packages/core/src/consent-banner-types.d.ts",
    "templates/chat/server/consent-banner-route.spec.ts",
    "packages/mobile-app/app/consent-banner-screen.tsx",
    "packages/core/README.md",
    "scripts/consent-banner-check.ts",
  ]) {
    assert.equal(devModuleUrl(file), null, file);
  }
});

test("reports every browser root that has no code to check", () => {
  assert.equal(emptyBrowserRoots([]).length, 8);
  assert.deepEqual(
    emptyBrowserRoots([
      "packages/core/src/index.ts",
      "packages/shared-app-config/index.ts",
      "packages/core/docs/content/actions.md",
      "templates/chat/app/root.tsx",
      "packages/docs/README.md",
      "templates/clips/public/sw.js",
    ]),
    ["packages/docs/public/**", "packages/docs/**", "packages/frame/client/**"],
  );
  assert.deepEqual(
    emptyBrowserRoots([
      "packages/core/src/index.ts",
      "packages/shared-app-config/index.ts",
      "packages/core/docs/content/actions.md",
      "community-templates/account-expert/public/sw.js",
      "community-templates/account-expert/shared/types.ts",
      "packages/docs/public/search.js",
      "packages/docs/app/root.tsx",
      "packages/frame/client/main.ts",
    ]),
    [],
  );
});

test("doesn't count public files as the rest of an app", () => {
  assert.deepEqual(
    emptyBrowserRoots([
      "packages/core/src/index.ts",
      "packages/shared-app-config/index.ts",
      "packages/core/docs/content/actions.md",
      "templates/clips/public/sw.js",
      "packages/docs/public/search.js",
      "packages/frame/client/main.ts",
    ]),
    ["templates/*/**, community-templates/*/**", "packages/docs/**"],
  );
});

test("reports a package or template whose modules moved out of every root", () => {
  assert.deepEqual(
    uncheckedUnits([
      "packages/core/lib/index.ts",
      "packages/core/docs/content/actions.md",
      "packages/toolkit/src/index.ts",
      "packages/core-corpus/README.md",
      "packages/mobile-app/app/index.tsx",
      "packages/docs/public/search.js",
      "packages/README.md",
      "templates/chat/app/root.tsx",
      "templates/clips/public/sw.js",
      "templates/mail/README.md",
    ]),
    ["packages/core", "packages/docs", "templates/clips", "templates/mail"],
  );
});

test("checks the files code imports as modules, whatever their type", () => {
  const sources: Record<string, string> = {
    "templates/chat/app/routes/settings.tsx":
      'import changelog from "../../CHANGELOG.md?raw";',
    "packages/docs/app/legal-policy-content.ts":
      'import privacy from "./legal-policies/privacy.md?raw";',
    "packages/docs/app/components/docs-source-loaders.ts":
      'import.meta.glob("../../../core/docs/content/locales/*/*.mdx", {});',
    "packages/docs/lib/site-content.server.ts":
      'import.meta.glob<string>(\n  ["../content/articles/**/*.md"],\n);',
    "packages/dispatch/src/routes/pages/settings.tsx":
      'void import("../../../CHANGELOG.md?raw");',
    "templates/clips/desktop/src/lib/person-cutout.ts":
      'import modelUrl from "../../../public/mediapipe/model.tflite?url";',
  };
  const imported = [
    "templates/chat/CHANGELOG.md",
    "packages/docs/app/legal-policies/privacy.md",
    "packages/core/docs/content/locales/ja-JP/actions.mdx",
    "packages/docs/content/articles/2026/launch.md",
    "packages/dispatch/CHANGELOG.md",
    "templates/clips/public/mediapipe/model.tflite",
  ];
  assert.deepEqual(
    browserModules(
      [
        ...Object.keys(sources),
        ...imported,
        "templates/chat/changelog/2026-08-07-cookie-banner-fix.md",
        "templates/chat/README.md",
        "packages/docs/app/legal-policies/README.txt",
        "packages/dispatch/README.md",
      ],
      (file) => sources[file] ?? "",
    ).sort(),
    [...Object.keys(sources), ...imported].sort(),
  );
});

test("reads glob calls with type arguments, comments, braces and exclusions", () => {
  const loader = "templates/chat/app/content.ts";
  const matched = [
    "templates/chat/app/content/intro.md",
    "templates/chat/app/content/intro.mdx",
    "templates/chat/app/notes/2026/plan.md",
    "templates/chat/app/notes/2027/plan.md",
  ];
  const source = [
    'throw new Error("Unresolved import.meta.glob dependency");',
    "import.meta.glob /* loaders */ <Record<string, () => Promise<string>>>(",
    "  [",
    "    // Pages and their drafts",
    '    "./content/*.{md,mdx}",',
    '    "./notes/{2026,2027}/*.md", /* by year */',
    '    "!./content/draft-*.md",',
    "  ],",
    '  { query: "?raw" },',
    ");",
  ].join("\n");
  assert.deepEqual(
    browserModules(
      [
        loader,
        ...matched,
        "templates/chat/app/content/draft-intro.md",
        "templates/chat/app/content/intro.txt",
        "templates/chat/app/notes/2028/plan.md",
      ],
      (file) => (file === loader ? source : ""),
    ).sort(),
    [loader, ...matched].sort(),
  );
});

test("stops at a glob it can't follow, instead of skipping files", () => {
  for (const call of [
    'import.meta.glob("./content/[ab].md")',
    'import.meta.glob(["./notes/[x].md"])',
    'import.meta.glob("./notes/{1..3}.md")',
    'import.meta.glob("/src/*.md")',
    'import.meta.glob("!/src/*.md")',
    "import.meta.glob(patterns)",
    'import.meta.glob("./content/" + name)',
    "import.meta.glob(`./${dir}/*.md`)",
    "import.meta.glob<Record<string, string>>(patterns)",
    "import.meta.glob /* pages */ (patterns)",
  ]) {
    assert.throws(
      () => browserModules(["templates/chat/app/content.ts"], () => `${call};`),
      /can't follow/,
      call,
    );
  }
});

test("finds the module name that kept apps from loading in Brave", () => {
  assert.deepEqual(
    findBlockedModuleNames([
      "packages/core/src/localization/consent-banner-messages.ts",
      "packages/core/src/localization/privacy-choice-messages.ts",
    ]),
    [
      {
        file: "packages/core/src/localization/consent-banner-messages.ts",
        words: "consent-banner",
        list: "cookie-notice lists",
      },
    ],
  );
});

test("catches every spelling of a blocked word pair", () => {
  assert.deepEqual(
    findBlockedModuleNames([
      "packages/core/src/client/cookie-banner.min.ts",
      "templates/mail/public/cookie_banner_v2.js",
      "templates/mail/app/CookieBanner.tsx",
      "packages/core/src/consentbanner-fragment/app.ts",
      "templates/clips/public/gdpr_popup.min.js",
      "templates/plan/app/lib/tracking-analytics-events.ts",
      "templates/mail/app/CookieLawBar.tsx",
      "templates/clips/public/cookie.notice.min.js",
      "packages/core/src/client/cookies-message.ts",
      "packages/core/src/client/eu-cookie.ts",
    ]).map(({ words }) => words),
    [
      "cookie-banner",
      "cookie_banner",
      "cookiebanner",
      "consentbanner-",
      "gdpr_popup",
      "tracking-analytics-events",
      "cookielaw",
      "cookie.notice",
      "cookies-message",
      "eu-cookie",
    ],
  );
});

test("matches rules in any letter case, in every browser root", () => {
  const files = [
    "templates/mail/app/components/Cookie-Notice-Panel.tsx",
    "templates/mail/shared/gdpr-consent-copy.ts",
    "templates/mail/app/styles/site-cookie-banner.css",
    "packages/docs/public/click-tracking.js",
    "packages/toolkit/src/app/analytics-events-client.ts",
    "packages/core/docs/content/Cookie-Consent.mdx",
    "packages/docs/app/legal-policies/Cookie-Policy.md",
    "packages/dispatch/Cookie_Banner.md",
  ];
  assert.deepEqual(
    findBlockedModuleNames(files).map(({ words }) => words),
    [
      "cookie-notice",
      "gdpr-consent",
      "cookie-banner",
      "click-tracking",
      "analytics-events-",
      "cookie-consent",
      "cookie-policy",
      "cookie_banner",
    ],
  );
});

test("allows the names the blocker lists let through", () => {
  assert.deepEqual(
    findBlockedModuleNames([
      "packages/core/src/client/consent.ts",
      "packages/core/src/client/analytics.ts",
      "packages/core/src/shared/analytics-events.ts",
      "packages/core/src/shared/builder-link-tracking.ts",
      "packages/core/src/mcp-client/oauth-flow-cookie.ts",
      "packages/core/src/server/cookie-namespace.ts",
      "packages/core/src/onboarding/shared-cookie.ts",
      "packages/core/src/localization/privacy-choice-messages.ts",
      "packages/toolkit/src/app/shared/ConsentBanner.tsx",
      "templates/clips/app/hooks/use-view-tracking.ts",
    ]),
    [],
  );
});
