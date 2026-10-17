import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_SETTINGS_REDIRECTS,
  landsOnSettingsPage,
  newSettingsPath,
} from "./settings";

test("builds the new page path, with and without a sub-page", () => {
  assert.equal(newSettingsPath({ page: "members" }), "/settings/members");
  assert.equal(
    newSettingsPath({ page: "integrations", sub: "builder" }),
    "/settings/integrations/builder",
  );
});

test("matches the new page path under a workspace mount", () => {
  assert.equal(
    landsOnSettingsPage("/dispatch/settings/instructions", {
      page: "instructions",
    }),
    true,
  );
  assert.equal(landsOnSettingsPage("/settings/app/", { page: "app" }), true);
});

test("does not treat a legacy or sibling path as the new page", () => {
  assert.equal(
    landsOnSettingsPage("/settings/general", { page: "app" }),
    false,
  );
  assert.equal(
    landsOnSettingsPage("/settings/instructions-archive", {
      page: "instructions",
    }),
    false,
  );
  assert.equal(
    landsOnSettingsPage("/settings/integrations", {
      page: "integrations",
      sub: "builder",
    }),
    false,
  );
});

test("samples three distinct legacy links, none already a new path", () => {
  assert.equal(LEGACY_SETTINGS_REDIRECTS.length, 3);
  assert.equal(
    new Set(LEGACY_SETTINGS_REDIRECTS.map((link) => link.from)).size,
    3,
  );
  for (const link of LEGACY_SETTINGS_REDIRECTS) {
    assert.notEqual(link.from, newSettingsPath(link));
  }
});
