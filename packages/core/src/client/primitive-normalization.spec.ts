import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const normalizedSurfaces = [
  "./settings/SettingsPanel.tsx",
  "./settings/SecretsSection.tsx",
  "./org/TeamPage.tsx",
];

describe("Core design-system primitive normalization", () => {
  it.each(normalizedSurfaces)(
    "%s routes buttons and pickers through Toolkit primitives",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      expect(source).toContain("@agent-native/toolkit/ui/button");
      if (sourcePath.includes("settings/")) {
        expect(source).toContain("@agent-native/toolkit/design-system");
        expect(source).toContain("Picker");
        expect(source).not.toContain("@agent-native/toolkit/ui/select");
      } else {
        expect(source).toContain("@agent-native/toolkit/ui/select");
      }
      expect(source).not.toMatch(/<(?:button|select)\b/);
      expect(source).not.toContain("@radix-ui/react-select");
    },
  );

  it.each(normalizedSurfaces)(
    "%s keeps explicit icon dimensions when routed through Toolkit buttons",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      expect(source).toContain("[&_svg]:!size-auto");
    },
  );
});
