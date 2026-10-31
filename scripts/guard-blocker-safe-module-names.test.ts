import assert from "node:assert/strict";
import test from "node:test";

import {
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
  ] as const) {
    assert.equal(devModuleUrl(file), url, file);
  }
});

test("ignores tests, type declarations and files outside the browser", () => {
  for (const file of [
    "packages/core/src/localization/consent-banner-messages.spec.ts",
    "packages/core/src/consent-banner-types.d.ts",
    "templates/chat/server/consent-banner-route.spec.ts",
    "templates/chat/CHANGELOG.md",
    "packages/mobile-app/app/consent-banner-screen.tsx",
    "packages/core/README.md",
  ]) {
    assert.equal(devModuleUrl(file), null, file);
  }
});

test("reports every browser root that has no modules to check", () => {
  assert.equal(emptyBrowserRoots([]).length, 7);
  assert.deepEqual(
    emptyBrowserRoots([
      "packages/core/src/index.ts",
      "packages/shared-app-config/index.ts",
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
      "community-templates/account-expert/public/sw.js",
      "community-templates/account-expert/shared/types.ts",
      "packages/docs/public/search.js",
      "packages/docs/app/root.tsx",
      "packages/frame/client/main.ts",
    ]),
    [],
  );
});

test("reports a package or template whose modules moved out of every root", () => {
  assert.deepEqual(
    uncheckedUnits([
      "packages/core/lib/index.ts",
      "packages/toolkit/src/index.ts",
      "packages/core-corpus/README.md",
      "packages/mobile-app/app/index.tsx",
      "packages/README.md",
      "templates/chat/app/root.tsx",
      "templates/mail/README.md",
    ]),
    ["packages/core", "templates/mail"],
  );
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
  ];
  assert.deepEqual(
    findBlockedModuleNames(files).map(({ words }) => words),
    [
      "cookie-notice",
      "gdpr-consent",
      "cookie-banner",
      "click-tracking",
      "analytics-events-",
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
