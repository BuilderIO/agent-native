/* @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchResults: [] as Array<{
    email: string;
    name: string | null;
    avatar: string | null;
    outsideOrganization: boolean;
  }>,
}));

vi.mock("./use-jobs.js", () => ({
  useAutomationAccountSearch: (query: string, enabled: boolean) => ({
    data: enabled && query.trim().length >= 2 ? mocks.searchResults : [],
    isFetching: false,
  }),
}));

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (
      key: string,
      options?: Record<string, string | number | undefined>,
    ): string => {
      let result = String(options?.defaultValue ?? key);
      for (const [name, value] of Object.entries(options ?? {})) {
        result = result.replaceAll(`{{${name}}}`, String(value));
      }
      return result;
    },
}));

import {
  AutomationSharingFields,
  automationSharingIsValid,
  automationSharingRequiresAcknowledgement,
  automationSharingStateFromSummary,
  defaultAutomationSharingState,
  type AutomationSharingState,
} from "./AutomationSharingFields.js";

describe("automation sharing validity helpers", () => {
  it("treats Personal as always valid", () => {
    expect(
      automationSharingIsValid(defaultAutomationSharingState(), null),
    ).toBe(true);
  });

  it("requires an owning organization for Organization mode", () => {
    const state: AutomationSharingState = {
      mode: "organization",
      grants: [],
      acknowledgeExternalCollaborators: false,
    };
    expect(automationSharingIsValid(state, null)).toBe(false);
    expect(automationSharingIsValid(state, "org-1")).toBe(true);
  });

  it("requires at least one grant for Specific people", () => {
    const state: AutomationSharingState = {
      mode: "specific",
      grants: [],
      acknowledgeExternalCollaborators: false,
    };
    expect(automationSharingIsValid(state, "org-1")).toBe(false);
  });

  it("requires acknowledgement for an outside-org Collaborate grant", () => {
    const state: AutomationSharingState = {
      mode: "specific",
      grants: [
        {
          email: "outsider@example.test",
          role: "collaborate",
          name: null,
          avatar: null,
          outsideOrganization: true,
        },
      ],
      acknowledgeExternalCollaborators: false,
    };
    expect(automationSharingRequiresAcknowledgement(state.grants)).toBe(true);
    expect(automationSharingIsValid(state, "org-1")).toBe(false);
    expect(
      automationSharingIsValid(
        { ...state, acknowledgeExternalCollaborators: true },
        "org-1",
      ),
    ).toBe(true);
  });

  it("does not require acknowledgement for an outside-org View grant", () => {
    const state: AutomationSharingState = {
      mode: "specific",
      grants: [
        {
          email: "outsider@example.test",
          role: "view",
          name: null,
          avatar: null,
          outsideOrganization: true,
        },
      ],
      acknowledgeExternalCollaborators: false,
    };
    expect(automationSharingIsValid(state, "org-1")).toBe(true);
  });

  it("derives Specific people state from a shared summary's grants", () => {
    const state = automationSharingStateFromSummary({
      source: "explicit",
      visibility: "shared",
      organizationId: "org-1",
      grantCount: 1,
      grants: [
        { email: "a@example.test", role: "view", name: "A", avatar: null },
      ],
    });
    expect(state.mode).toBe("specific");
    expect(state.grants).toEqual([
      {
        email: "a@example.test",
        role: "view",
        name: "A",
        avatar: null,
        outsideOrganization: false,
      },
    ]);
  });
});

describe("AutomationSharingFields", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.searchResults = [];
    onChange.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(value: AutomationSharingState, submitted = false) {
    act(() => {
      root.render(
        <AutomationSharingFields
          value={value}
          onChange={onChange}
          orgId="org-1"
          orgName="Acme"
          submitted={submitted}
        />,
      );
    });
  }

  function changeValue(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("adds a searched account as a View grant by default", () => {
    mocks.searchResults = [
      {
        email: "new@example.test",
        name: "New Person",
        avatar: null,
        outsideOrganization: false,
      },
    ];
    render({
      mode: "specific",
      grants: [],
      acknowledgeExternalCollaborators: false,
    });

    const input = container.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("No search input");
    changeValue(input, "new");

    const option = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("New Person"),
    );
    act(() => option?.click());

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        grants: [
          expect.objectContaining({ email: "new@example.test", role: "view" }),
        ],
      }),
    );
  });

  it("removes a grant", () => {
    render({
      mode: "specific",
      grants: [
        {
          email: "a@example.test",
          role: "view",
          name: "A",
          avatar: null,
          outsideOrganization: false,
        },
      ],
      acknowledgeExternalCollaborators: false,
    });

    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove"]',
    );
    act(() => removeButton?.click());

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ grants: [] }),
    );
  });

  it("shows the acknowledgement only for outside-org Collaborate grants", () => {
    render({
      mode: "specific",
      grants: [
        {
          email: "outsider@example.test",
          role: "collaborate",
          name: null,
          avatar: null,
          outsideOrganization: true,
        },
      ],
      acknowledgeExternalCollaborators: false,
    });

    expect(container.textContent).toContain(
      "outside-organization collaborators",
    );
  });
});
