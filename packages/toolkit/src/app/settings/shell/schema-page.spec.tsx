// @vitest-environment happy-dom

import { act, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsSectionDefinition } from "../rows/schema.js";
import { EMPTY_SETTINGS_BRIDGE } from "./bridge.js";
import {
  defineSettingsPage,
  type SettingsPageContext,
  type SettingsPageProps,
} from "./registry.js";

const context: SettingsPageContext = {
  role: "member",
  isOwner: false,
  isAdmin: false,
  hasOrganization: true,
  soloDeploymentAdmin: false,
  appId: "notes",
  labs: {},
  flags: {},
};

describe("schema settings pages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders an app's rows from its sections hook and writes through the binding", async () => {
    const seen: string[] = [];
    function useDigestSections({
      sub,
    }: SettingsPageProps): SettingsSectionDefinition[] {
      const [digest, setDigest] = useState(false);
      seen.push(sub ?? "none");
      return [
        {
          id: "digest",
          label: "Digest",
          rows: [
            {
              id: "settings.digest.enabled",
              kind: "toggle",
              label: "Daily digest",
              binding: { value: digest, set: setDigest },
            },
          ],
        },
      ];
    }
    const page = defineSettingsPage({
      id: "digest",
      group: "app",
      order: 10,
      label: "Digest",
      icon: () => null,
      sections: useDigestSections,
    });
    const Page = page.component;

    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <Page
            pageId="digest"
            sub="weekly"
            context={context}
            bridge={EMPTY_SETTINGS_BRIDGE}
          />
        </Suspense>,
      );
    });
    const selector =
      '[data-rid="settings.digest.enabled"][data-part="settings.row.control"]';
    await vi.waitFor(
      async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(container.querySelector(selector)).not.toBeNull();
      },
      { timeout: 10_000 },
    );

    expect(seen).toContain("weekly");
    const control = container.querySelector(selector);
    const toggle = control?.matches("button")
      ? control
      : control?.querySelector("button");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("no toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a component page exactly as defined", () => {
    const Component = () => null;
    const page = defineSettingsPage({
      id: "plain",
      group: "app",
      order: 10,
      label: "Plain",
      icon: () => null,
      component: Component,
    });
    expect(page.component).toBe(Component);
  });
});
