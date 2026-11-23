// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_SETTINGS_EVENT,
  settingsSectionHref,
  useAgentSettingsNavigation,
} from "./useAgentSettingsNavigation";

/**
 * sprint-analytics-2#791: the shared HubSpot MCP dialog's "Add workspace
 * credentials" asks the host app to open `secrets:HUBSPOT_MCP_CLIENT_ID`. Before
 * this listener existed the dialog closed and nothing opened.
 */
const visited: string[] = [];

function Host() {
  useAgentSettingsNavigation((to) => {
    visited.push(to);
  });
  return null;
}

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  visited.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Host />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
});

function announce(section?: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(AGENT_SETTINGS_EVENT, { detail: { section } }),
    );
  });
}

describe("agent settings navigation", () => {
  it("opens this app's Secrets screen for the key the dialog names", () => {
    announce("secrets:HUBSPOT_MCP_CLIENT_ID");
    expect(visited).toEqual([
      "/settings/secrets#secrets:HUBSPOT_MCP_CLIENT_ID",
    ]);
  });

  it("leaves other sections alone rather than guessing a route", () => {
    announce("skills");
    announce(undefined);
    expect(visited).toEqual([]);
  });

  it("parses only the secrets request", () => {
    expect(settingsSectionHref("secrets:SLACK_BOT_TOKEN")).toBe(
      "/settings/secrets#secrets:SLACK_BOT_TOKEN",
    );
    expect(settingsSectionHref("secretskipper")).toBeNull();
    expect(settingsSectionHref(undefined)).toBeNull();
  });
});
