// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

const received = vi.hoisted(() => ({
  focusKey: undefined as string | undefined,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  SecretsSection: ({ focusKey }: { focusKey?: string }) => {
    received.focusKey = focusKey;
    return <div data-focus={focusKey ?? ""} />;
  },
}));

import { resolveRoutePage } from "../workspace/pages";
import {
  AnalyticsSecretsPage,
  secretFocusKeyFromHash,
} from "./AnalyticsSecretsPage";

/**
 * sprint-analytics-2#791: "Add workspace credentials" lands on
 * /settings/secrets#secrets:HUBSPOT_MCP_CLIENT_ID. The Secrets list hides unset
 * keys unless one is focused, so the page must hand the hash's key to the list or
 * the HubSpot entry never appears.
 */
it("reads the focused key from a secrets: hash", () => {
  expect(secretFocusKeyFromHash("#secrets:HUBSPOT_MCP_CLIENT_ID")).toBe(
    "HUBSPOT_MCP_CLIENT_ID",
  );
  expect(secretFocusKeyFromHash("")).toBeUndefined();
  expect(secretFocusKeyFromHash("#profile")).toBeUndefined();
});

it("decodes percent-encoded keys and survives malformed encoding", () => {
  expect(secretFocusKeyFromHash("#secrets:MY%5FKEY")).toBe("MY_KEY");
  expect(() => secretFocusKeyFromHash("#secrets:%E0%A4%A")).not.toThrow();
  expect(secretFocusKeyFromHash("#secrets:%E0%A4%A")).toBe("%E0%A4%A");
  expect(secretFocusKeyFromHash("#secrets:100%")).toBe("100%");
});

it("renders the Secrets list when the deep link is malformed", () => {
  received.focusKey = undefined;
  const host = document.createElement("div");
  const root = createRoot(host);
  expect(() =>
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/settings/secrets#secrets:%E0%A4%A"]}>
          <AnalyticsSecretsPage />
        </MemoryRouter>,
      ),
    ),
  ).not.toThrow();
  expect(received.focusKey).toBe("%E0%A4%A");
  act(() => root.unmount());
});

it("passes the hash's key to the Secrets list", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      <MemoryRouter
        initialEntries={["/settings/secrets#secrets:HUBSPOT_MCP_CLIENT_ID"]}
      >
        <AnalyticsSecretsPage />
      </MemoryRouter>,
    ),
  );
  expect(received.focusKey).toBe("HUBSPOT_MCP_CLIENT_ID");
  act(() => root.unmount());
});

it("is the page the settings:secrets route renders", () => {
  expect(
    resolveRoutePage({ id: "settings", view: "secrets" } as never),
  ).toBeTruthy();
});
