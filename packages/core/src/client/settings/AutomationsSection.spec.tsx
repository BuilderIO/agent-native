// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTOMATION_CREATION_SCOPE,
  AutomationsSection,
  automationCreationContext,
} from "./AutomationsSection.js";

describe("automationCreationContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("truthfully routes creation to the supported personal scope", () => {
    const context = automationCreationContext();

    expect(AUTOMATION_CREATION_SCOPE).toBe("personal");
    expect(context).toContain("personal automation");
    expect(context).toContain("manage-automations with action=define");
    expect(context).not.toContain("organization");
  });

  it("links settings to the consolidated Automations page", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MemoryRouter>
          <AutomationsSection />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Scheduled");
    expect(container.textContent).toContain("Event-triggered");
    expect(
      container.querySelector('a[href="/settings#agent:automations"]'),
    ).not.toBe(null);

    act(() => root.unmount());
  });
});
