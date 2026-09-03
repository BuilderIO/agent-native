import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findTemplateUiImports } from "./guard-template-ui-imports";

describe("template UI import guard", () => {
  it("finds static, exported, dynamic, and required Toolkit UI imports", () => {
    const violations = findTemplateUiImports(
      "templates/example/app/page.tsx",
      `
        import { Button } from "@agent-native/toolkit/ui/button";
        export { Dialog } from "@agent-native/toolkit/ui/dialog";
        const menu = import("@agent-native/toolkit/ui/dropdown-menu");
        const tooltip = require("@agent-native/toolkit/ui/tooltip");
      `,
    );

    assert.deepEqual(
      violations.map(({ line, specifier }) => [line, specifier]),
      [
        [2, "@agent-native/toolkit/ui/button"],
        [3, "@agent-native/toolkit/ui/dialog"],
        [4, "@agent-native/toolkit/ui/dropdown-menu"],
        [5, "@agent-native/toolkit/ui/tooltip"],
      ],
    );
  });

  it("allows the semantic contract and ignores comments and string examples", () => {
    assert.deepEqual(
      findTemplateUiImports(
        "templates/example/app/design-system.ts",
        `
          import { defineDesignSystem } from "@agent-native/toolkit/design-system";
          // import { Button } from "@agent-native/toolkit/ui/button";
          const docs = 'require("@agent-native/toolkit/ui/button")';
        `,
      ),
      [],
    );
  });
});
