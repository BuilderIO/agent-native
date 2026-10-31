import assert from "node:assert/strict";
import test from "node:test";

import {
  devModuleUrl,
  findBlockedModuleNames,
} from "./guard-blocker-safe-module-names.mjs";

test("maps package sources to their dist URL and keeps template paths", () => {
  assert.equal(
    devModuleUrl("packages/core/src/localization/core-messages.ts"),
    "/@fs/node_modules/@agent-native/core/dist/localization/core-messages.js",
  );
  assert.equal(
    devModuleUrl("templates/chat/app/routes/_index.tsx"),
    "/app/routes/_index.tsx",
  );
});

test("ignores tests, type declarations and files outside the browser", () => {
  for (const file of [
    "packages/core/src/localization/consent-banner-messages.spec.ts",
    "packages/core/src/consent-banner-types.d.ts",
    "templates/chat/server/consent-banner-route.ts",
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

test("matches rules in any letter case, in template and package files", () => {
  const files = [
    "templates/mail/app/components/Cookie-Notice-Panel.tsx",
    "packages/toolkit/src/app/analytics-events-client.ts",
  ];
  assert.deepEqual(
    findBlockedModuleNames(files).map(({ rule }) => rule),
    ["/cookie-notice-", "/analytics-events-"],
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
