import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkChangedCopyCoverage,
  hasForwardedInlineLocaleUpdate,
} from "./guard-i18n-changed-copy";

describe("changed copy localization coverage", () => {
  it("reports a source copy change with no localized counterpart", () => {
    assert.deepEqual(
      checkChangedCopyCoverage([
        {
          source: "templates/chat/app/i18n-data.ts",
          targets: [
            "templates/chat/app/i18n-data.ts#zh-CN",
            "templates/chat/app/i18n-data.ts#es-ES",
          ],
          changedTargets: new Set(["templates/chat/app/i18n-data.ts#zh-CN"]),
        },
      ]),
      [
        "templates/chat/app/i18n-data.ts: changed user-facing copy has no corresponding translation update in templates/chat/app/i18n-data.ts#es-ES — update it, or add an explicit i18n-copy-ignore marker only when the change is non-translatable",
      ],
    );
  });

  it("passes when every localized counterpart changed", () => {
    assert.deepEqual(
      checkChangedCopyCoverage([
        {
          source: "packages/core/docs/content/guide.mdx",
          targets: [
            "packages/core/docs/content/locales/de-DE/guide.mdx",
            "packages/core/docs/content/locales/fr-FR/guide.mdx",
          ],
          changedTargets: new Set([
            "packages/core/docs/content/locales/de-DE/guide.mdx",
            "packages/core/docs/content/locales/fr-FR/guide.mdx",
          ]),
        },
      ]),
      [],
    );
  });

  it("accepts an inline locale update forwarded by its sibling wrapper", () => {
    const source = "/catalog/i18n-data.ts";
    assert.equal(
      hasForwardedInlineLocaleUpdate(
        "es-ES",
        new Set(["es-ES"]),
        source,
        source,
        `const messages = {\n  ...messagesByLocale["es-ES"],\n};`,
      ),
      true,
    );
  });

  it("still fails when the target locale has no inline update", () => {
    const source = "/catalog/i18n-data.ts";
    assert.equal(
      hasForwardedInlineLocaleUpdate(
        "es-ES",
        new Set(["fr-FR"]),
        source,
        source,
        `const messages = {\n  ...messagesByLocale["es-ES"],\n};`,
      ),
      false,
    );
  });

  it("rejects a wrapper forwarding another locale or source", () => {
    const source = "/catalog/i18n-data.ts";
    const changedLocales = new Set(["es-ES"]);
    const otherLocaleWrapper = `const messages = {\n  ...messagesByLocale["fr-FR"],\n};`;
    assert.equal(
      hasForwardedInlineLocaleUpdate(
        "es-ES",
        changedLocales,
        source,
        source,
        otherLocaleWrapper,
      ),
      false,
    );
    assert.equal(
      hasForwardedInlineLocaleUpdate(
        "es-ES",
        changedLocales,
        "/catalog/other-data.ts",
        source,
        `const messages = {\n  ...messagesByLocale["es-ES"],\n};`,
      ),
      false,
    );
  });
});
