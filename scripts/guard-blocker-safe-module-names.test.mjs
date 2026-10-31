import assert from "node:assert/strict";
import test from "node:test";

import {
  devModuleUrl,
  findBlockedModuleNames,
} from "./guard-blocker-safe-module-names.mjs";

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
    ["templates/chat/app/routes/_index.tsx", "/app/routes/_index.tsx"],
    ["templates/chat/app/locales/en-US.json", "/app/locales/en-US.json"],
    ["templates/mail/shared/types.ts", "/shared/types.ts"],
    ["templates/clips/public/sw.js", "/sw.js"],
    ["packages/docs/app/root.tsx", "/app/root.tsx"],
    ["packages/docs/public/search.js", "/search.js"],
    ["packages/frame/client/main.ts", "/client/main.ts"],
  ]) {
    assert.equal(devModuleUrl(file), url, file);
  }
});

test("ignores tests, type declarations and files outside the browser", () => {
  for (const file of [
    "packages/core/src/localization/consent-banner-messages.spec.ts",
    "packages/core/src/consent-banner-types.d.ts",
    "templates/chat/server/consent-banner-route.ts",
    "templates/chat/actions/consent-banner-copy.ts",
    "packages/mobile-app/app/consent-banner-screen.tsx",
    "packages/core/README.md",
  ]) {
    assert.equal(devModuleUrl(file), null, file);
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
        rule: "/consent-banner-",
        list: "EasyList Cookie List",
      },
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
    findBlockedModuleNames(files).map(({ rule }) => rule),
    [
      "/cookie-notice-",
      "/gdpr-consent-",
      "-cookie-banner.",
      "/click-tracking.js",
      "/analytics-events-",
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
      "packages/toolkit/src/app/shared/ConsentBanner.tsx",
    ]),
    [],
  );
});
