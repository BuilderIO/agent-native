// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import * as themeFamilyConfig from "../../appearance/theme-family.js";
import * as themeFamily from "../theme-family.js";
import * as ui from "./index.js";

describe("client/ui theme family exports", () => {
  it("re-exports the theme family config resolvers", () => {
    expect(ui.resolveThemeFamilyConfig).toBe(
      themeFamilyConfig.resolveThemeFamilyConfig,
    );
    expect(ui.resolveThemeFamilyPreference).toBe(
      themeFamilyConfig.resolveThemeFamilyPreference,
    );
  });

  it("keeps the client theme family helpers beside them", () => {
    expect(ui.applyThemeFamily).toBe(themeFamily.applyThemeFamily);
    expect(ui.useThemeFamily).toBe(themeFamily.useThemeFamily);
  });
});
