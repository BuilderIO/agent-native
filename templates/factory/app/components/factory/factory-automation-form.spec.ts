import { describe, expect, it } from "vitest";

import {
  canCreateFactoryAutomation,
  dispatchIntegrationsHref,
  emptyAutomationForm,
  formAuthorFilter,
  isDestinationFilled,
  isDestinationReady,
  persistAuthorFilter,
} from "./factory-automation-form";

describe("factory-automation-form authors", () => {
  it("starts with no source and Everyone", () => {
    expect(emptyAutomationForm()).toMatchObject({
      source: null,
      authorFilter: "none",
      authorIds: [],
    });
  });

  it("maps stored exclude with no ids to Everyone", () => {
    expect(formAuthorFilter("exclude", [])).toBe("none");
    expect(formAuthorFilter("include", [])).toBe("none");
  });

  it("persists Everyone as exclude with no ids", () => {
    expect(persistAuthorFilter("none", ["U1"])).toEqual({
      authorMode: "exclude",
      authorIds: [],
    });
  });

  it("keeps include and exclude when ids are present", () => {
    expect(formAuthorFilter("include", ["U1"])).toBe("include");
    expect(formAuthorFilter("exclude", ["U1"])).toBe("exclude");
    expect(persistAuthorFilter("include", ["U1"])).toEqual({
      authorMode: "include",
      authorIds: ["U1"],
    });
    expect(persistAuthorFilter("exclude", ["U1"])).toEqual({
      authorMode: "exclude",
      authorIds: ["U1"],
    });
  });
});

describe("factory-automation-form destination gating", () => {
  const connected = { slack: true, github: true, sentry: true };
  const disconnected = { slack: false, github: false, sentry: false };

  it("treats a missing connections payload as ready and explicit false as blocked", () => {
    expect(isDestinationReady("slack")).toBe(true);
    expect(isDestinationReady("slack", connected)).toBe(true);
    expect(isDestinationReady("slack", disconnected)).toBe(false);
    expect(isDestinationReady(null, connected)).toBe(false);
  });

  it("requires the source destination before create", () => {
    const slack = {
      ...emptyAutomationForm("slack"),
      displayName: "Slack feedback",
      slackChannelId: "C123",
    };
    expect(isDestinationFilled(slack)).toBe(true);
    expect(canCreateFactoryAutomation(slack, connected)).toBe(true);
    expect(canCreateFactoryAutomation(slack, disconnected)).toBe(false);
    expect(
      canCreateFactoryAutomation({ ...slack, slackChannelId: "" }, connected),
    ).toBe(false);
  });

  it("points workspace connect at Dispatch admin integrations", () => {
    expect(
      dispatchIntegrationsHref([
        {
          id: "dispatch",
          isDispatch: true,
          url: "https://beta.dispatch.agent-native.com/overview",
        },
      ]),
    ).toBe("https://beta.dispatch.agent-native.com/admin/integrations");
    expect(dispatchIntegrationsHref([])).toBe("/dispatch/admin/integrations");
    expect(
      dispatchIntegrationsHref([
        { id: "dispatch", isDispatch: true, path: "/dispatch" },
      ]),
    ).toBe("/dispatch/admin/integrations");
  });
});
