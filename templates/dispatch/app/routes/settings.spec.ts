import {
  getSettingsPages,
  resolveSettingsRoute,
} from "@agent-native/toolkit/app/settings";
import { describe, expect, it } from "vitest";

import "../settings/workspace-connections-settings.js";

describe("Dispatch Settings integrations route", () => {
  it("registers workspace connections under Settings Integrations", () => {
    const integrations = getSettingsPages().find(
      (page) => page.id === "integrations",
    );

    expect(integrations?.legacyTabIds).toContain(
      "integrations:workspace-connections",
    );
    expect(integrations?.subpages).toContainEqual({
      id: "workspace-connections",
      labelKey: "integrations.connectedAccounts",
    });
    expect(
      resolveSettingsRoute(
        {
          pathname: "/settings/integrations/workspace-connections",
          hash: "",
        },
        getSettingsPages(),
      ),
    ).toMatchObject({ page: "integrations", sub: "workspace-connections" });
  });
});
