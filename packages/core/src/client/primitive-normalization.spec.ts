import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const settingsSurfaces = [
  "../../../toolkit/src/app/settings/SettingsPanel.tsx",
  "../../../toolkit/src/app/settings/SecretsSection.tsx",
];

// The Team page is split across these modules. TeamPrimitives owns the Button
// wrapper the others render through.
const teamPageModules = [
  "../../../toolkit/src/app/org/TeamPage.tsx",
  "../../../toolkit/src/app/org/TeamPrimitives.tsx",
  "../../../toolkit/src/app/org/TeamOnboardingCards.tsx",
  "../../../toolkit/src/app/org/OrgGeneralSection.tsx",
  "../../../toolkit/src/app/org/MembersSection.tsx",
  "../../../toolkit/src/app/org/MemberAppRoles.tsx",
  "../../../toolkit/src/app/org/BulkInviteForm.tsx",
  "../../../toolkit/src/app/org/GroupsSection.tsx",
  "../../../toolkit/src/app/org/AuthenticationSection.tsx",
  "../../../toolkit/src/app/org/OrgIdentitySettings.tsx",
  "../../../toolkit/src/app/org/AppsAccessSection.tsx",
];

const buttonWrapperSurfaces = [
  ...settingsSurfaces,
  "../../../toolkit/src/app/org/TeamPrimitives.tsx",
];

describe("Toolkit design-system primitive normalization", () => {
  it.each([...settingsSurfaces, ...teamPageModules])(
    "%s routes buttons and pickers through Toolkit primitives",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      if (sourcePath.includes("settings/")) {
        expect(source).toMatch(
          /(?:@agent-native\/toolkit\/ui\/button|PrimitiveButton)/,
        );
        expect(source).toContain("@agent-native/toolkit/design-system");
        expect(source).toContain("Picker");
        expect(source).not.toContain("@agent-native/toolkit/ui/select");
      } else if (/<Select\b/.test(source)) {
        expect(source).toContain("@agent-native/toolkit/ui/select");
      }
      expect(source).not.toMatch(/<(?:button|select)\b/);
      expect(source).not.toContain("@radix-ui/react-select");
    },
  );

  it.each(buttonWrapperSurfaces)(
    "%s routes buttons through the shared primitive wrapper",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      expect(source).toContain("PrimitiveButton");
    },
  );

  it("PrimitiveButton.tsx encapsulates Toolkit button and explicit icon dimensions", () => {
    const source = readFileSync(
      new URL("../../../toolkit/src/app/PrimitiveButton.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("@agent-native/toolkit/ui/button");
    expect(source).toContain("[&_svg]:!size-auto");
  });
});
