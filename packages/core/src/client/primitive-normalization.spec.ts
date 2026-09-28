import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const settingsSurfaces = [
  "./settings/SettingsPanel.tsx",
  "./settings/SecretsSection.tsx",
];

// The Team page is split across these modules. TeamPrimitives owns the Button
// wrapper the others render through.
const teamPageModules = [
  "./org/TeamPage.tsx",
  "./org/TeamPrimitives.tsx",
  "./org/TeamOnboardingCards.tsx",
  "./org/OrgGeneralSection.tsx",
  "./org/MembersSection.tsx",
  "./org/MemberAppRoles.tsx",
  "./org/BulkInviteForm.tsx",
  "./org/GroupsSection.tsx",
  "./org/AuthenticationSection.tsx",
  "./org/OrgIdentitySettings.tsx",
  "./org/AppsAccessSection.tsx",
];

const buttonWrapperSurfaces = [...settingsSurfaces, "./org/TeamPrimitives.tsx"];

describe("Core design-system primitive normalization", () => {
  it.each([...settingsSurfaces, ...teamPageModules])(
    "%s routes buttons and pickers through Toolkit primitives",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      if (sourcePath.includes("settings/")) {
        expect(source).toContain("@agent-native/toolkit/ui/button");
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
    "%s keeps explicit icon dimensions when routed through Toolkit buttons",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      expect(source).toContain("@agent-native/toolkit/ui/button");
      expect(source).toContain("[&_svg]:!size-auto");
    },
  );

  it.each(buttonWrapperSurfaces)(
    "%s does not inherit hover text for solid buttons",
    (sourcePath) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      expect(source).toContain(
        'props.emphasis === "solid" ? null : "hover:text-inherit"',
      );
    },
  );
});
