// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsSectionId } from "./agent-settings-search.js";
import {
  normalizeSettingsSection,
  settingsSectionDomId,
  useSettingsPanelController,
  type SettingsPanelController,
  type SettingsPanelControllerOptions,
} from "./useSettingsPanelController.js";

function ControllerProbe({
  options,
  onController,
}: {
  options: SettingsPanelControllerOptions;
  onController: (controller: SettingsPanelController) => void;
}) {
  const controller = useSettingsPanelController(options);
  onController(controller);
  return null;
}

describe("useSettingsPanelController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: SettingsPanelController;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState({}, "", "http://localhost:3000/settings");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(options: SettingsPanelControllerOptions) {
    act(() => {
      root.render(
        createElement(ControllerProbe, {
          options,
          onController: (nextController) => {
            controller = nextController;
          },
        }),
      );
    });
  }

  it("normalizes supported section names and compatibility aliases", () => {
    expect(normalizeSettingsSection("#secrets:OPENAI_API_KEY")).toBe("secrets");
    expect(normalizeSettingsSection("workspace-settings")).toBe("secrets");
    expect(normalizeSettingsSection("agent-engine")).toBe("llm");
    expect(normalizeSettingsSection("models")).toBe("app-models");
    expect(normalizeSettingsSection("loop-settings")).toBe("limits");
    expect(normalizeSettingsSection("not-a-section")).toBeNull();
    expect(settingsSectionDomId("usage")).toBe("agent-settings-section-usage");
  });

  it("owns visible-section and accordion state without presentation details", () => {
    const sections = ["secrets", "usage"] satisfies SettingsSectionId[];
    render({ sections });

    expect(controller.sections).toBe(sections);
    expect(controller.openSection).toBe("secrets");
    expect(controller.isSectionVisible("usage")).toBe(true);
    expect(controller.isSectionVisible("llm")).toBe(false);
    expect(controller.isSectionOpen("secrets")).toBe(true);

    act(() => controller.toggleSection("secrets"));
    expect(controller.openSection).toBeNull();

    act(() => controller.toggleSection("usage"));
    expect(controller.openSection).toBe("usage");
  });

  it("opens requested visible sections and delegates scrolling", () => {
    const onScrollToSection = vi.fn();
    render({
      sections: ["llm", "usage"],
      initialSection: "usage",
      sectionRequestKey: 1,
      onScrollToSection,
    });

    expect(controller.openSection).toBe("usage");
    expect(onScrollToSection).toHaveBeenCalledWith("usage");

    act(() =>
      controller.openSettingsSection("llm", {
        scroll: true,
      }),
    );
    expect(controller.openSection).toBe("llm");
    expect(onScrollToSection).toHaveBeenLastCalledWith("llm");
  });

  it("tracks secret deep links and ignores sections outside its scope", () => {
    const onScrollToSection = vi.fn();
    render({ sections: ["secrets", "usage"], onScrollToSection });

    act(() => {
      window.location.hash = "secrets:OPENAI_API_KEY";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(controller.openSection).toBe("secrets");
    expect(controller.focusSecretKey).toBe("OPENAI_API_KEY");

    act(() => {
      window.location.hash = "usage";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(controller.openSection).toBe("usage");
    expect(controller.focusSecretKey).toBeUndefined();

    act(() => {
      window.location.hash = "llm";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(controller.openSection).toBe("usage");
  });
});
