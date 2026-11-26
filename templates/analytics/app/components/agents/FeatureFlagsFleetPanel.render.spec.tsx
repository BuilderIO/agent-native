// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<unknown>>(),
  write: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useMutation, useQuery, useQueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    // The real hooks without the network: unless a write opts out, its
    // success refreshes every action query.
    useActionQuery: (
      action: string,
      params: unknown,
      options: Record<string, any>,
    ) =>
      useQuery({
        ...options,
        queryKey: ["action", action, params],
        queryFn: () => mocks.read(),
      }),
    useActionMutation: (
      _action: string,
      {
        skipActionQueryInvalidation,
        onSuccess,
        ...options
      }: Record<string, any>,
    ) => {
      const client = useQueryClient();
      return useMutation({
        ...options,
        mutationFn: (input: unknown) => mocks.write(input),
        onSuccess: (...args: unknown[]) => {
          if (!skipActionQueryInvalidation) {
            void client.invalidateQueries({ queryKey: ["action"] });
          }
          return onSuccess?.(...args);
        },
      });
    },
  };
});

vi.mock("@agent-native/toolkit/app/feature-flags", () => ({
  // One row per flag: what it is set to, and a button for each change.
  FeatureFlagsEditor: ({
    flags,
    onMutate,
  }: {
    flags: { key: string; rules?: { mode: string } }[];
    onMutate: (input: unknown) => void;
  }) => (
    <ul>
      {flags.map((flag) => (
        <li key={flag.key} data-flag={flag.key}>
          <span data-mode>{flag.rules?.mode}</span>
          <button
            type="button"
            onClick={() =>
              onMutate({ key: flag.key, operation: "enable-for-current-user" })
            }
          >
            enable
          </button>
          <button
            type="button"
            onClick={() => onMutate({ key: flag.key, operation: "off" })}
          >
            off
          </button>
        </li>
      ))}
    </ul>
  ),
}));

import { i18nCatalog } from "../../i18n";
import { FeatureFlagsFleetPanel } from "./FeatureFlagsFleetPanel";

const RULES = { version: 1 as const, emails: [], orgIds: [], percentage: 0 };
const ON = { ...RULES, mode: "on" as const };
const OFF = { ...RULES, mode: "off" as const };

const app = (id: string, name: string, rules: typeof ON | typeof OFF) => ({
  appId: id,
  appName: name,
  state: "ready",
  flags: [
    { key: "receiver", displayName: "Receiver", defaultValue: false, rules },
  ],
});
const ORG_SCOPE = { kind: "org", orgId: "org-1", orgDomain: "acme.test" };
const GLOBAL_SCOPE = { kind: "global", orgId: null, orgDomain: null };
// The same shape the Analytics server returns for a verified change.
const verified = (
  rules: typeof ON | typeof OFF,
  enabledForCurrentUser: boolean | null,
  scope: typeof ORG_SCOPE | typeof GLOBAL_SCOPE = ORG_SCOPE,
) => ({
  contractVersion: 3,
  status: "verified",
  key: "receiver",
  rules,
  scope,
  enabledForCurrentUser,
});

let client: QueryClient;
let container: HTMLDivElement;
let root: Root;

/** Waits out the query and mutation callbacks a click starts. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function section(name: string) {
  return [...container.querySelectorAll("section")].find(
    (candidate) => candidate.querySelector("h3")?.textContent === name,
  );
}

async function click(appName: string, change: "enable" | "off") {
  const button = [...(section(appName)?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === change,
  );
  if (!button) throw new Error(`No ${change} button for ${appName}`);
  act(() => button.click());
  await flush();
}

async function reload() {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === "Reload flags" ||
      candidate.textContent === "Retry",
  );
  if (!button) throw new Error("No reload button");
  act(() => button.click());
  await flush();
}

/** The verified-change note, or null when the panel shows none. */
function note() {
  return (
    [...container.querySelectorAll('[role="status"]')]
      .map((element) => element.textContent ?? "")
      .find((text) => text.startsWith("Verified at")) ?? null
  );
}

/** Mounts the panel on a directory listing Analytics and Content, both on. */
async function mountPanel() {
  mocks.read.mockResolvedValue({
    directoryStatus: "available",
    apps: [app("analytics", "Analytics", ON), app("content", "Content", ON)],
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          initialLocale="en-US"
          persistPreference={false}
        >
          <FeatureFlagsFleetPanel />
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    ),
  );
  await flush();
}

/** Turns Content's flag on and then off, each change verified. */
async function enableThenTurnOffContent() {
  mocks.write.mockResolvedValueOnce(verified(ON, true));
  await click("Content", "enable");
  expect(note()).toContain(
    "Receiver in Content is set to Everyone for this organization.",
  );
  expect(note()).toContain("You have access");
  mocks.write.mockResolvedValueOnce(verified(OFF, false));
  await click("Content", "off");
  expect(note()).toContain(
    "Receiver in Content is set to Off for this organization.",
  );
  expect(note()).toContain("You don't have access");
}

describe("FeatureFlagsFleetPanel verified change", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Query updates normally land on their own zero-delay timer, which can
    // fire after flush's. In microtasks they always land before it.
    notifyManager.setScheduler(queueMicrotask);
    client = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    notifyManager.setScheduler(defaultScheduler);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stays in view when the next refresh fails", async () => {
    await mountPanel();
    await enableThenTurnOffContent();

    mocks.read.mockRejectedValue(new Error("Directory down"));
    await reload();

    expect(container.textContent).toContain("Feature flags are unavailable");
    expect(container.textContent).toContain("Directory down");
    expect(note()).toContain(
      "Receiver in Content is set to Off for this organization.",
    );
  });

  it("stays in view when the directory answers with no apps", async () => {
    await mountPanel();
    await enableThenTurnOffContent();

    mocks.read.mockResolvedValue({ directoryStatus: "unavailable", apps: [] });
    await reload();

    expect(container.textContent).toContain("Feature flags are unavailable");
    expect(note()).toContain(
      "Receiver in Content is set to Off for this organization.",
    );
  });

  it("names a peer app the refresh leaves out", async () => {
    await mountPanel();
    await enableThenTurnOffContent();

    // With the directory down, Analytics can only list itself.
    mocks.read.mockResolvedValue({
      directoryStatus: "unavailable",
      apps: [app("analytics", "Analytics", ON)],
    });
    await reload();

    expect(section("Analytics")).toBeDefined();
    expect(section("Content")).toBeUndefined();
    expect(container.textContent).toContain(
      "The workspace directory could not be reached.",
    );
    expect(note()).toContain(
      "Receiver in Content is set to Off for this organization.",
    );
  });

  it("agrees with the row when the refresh lists the app", async () => {
    await mountPanel();
    await enableThenTurnOffContent();

    mocks.read.mockResolvedValue({
      directoryStatus: "available",
      apps: [app("analytics", "Analytics", ON), app("content", "Content", OFF)],
    });
    await reload();

    expect(section("Content")?.querySelector("[data-mode]")?.textContent).toBe(
      "off",
    );
    expect(note()).toContain(
      "Receiver in Content is set to Off for this organization.",
    );
  });

  it("says when the server verified a change for every organization", async () => {
    await mountPanel();
    mocks.write.mockResolvedValueOnce(verified(OFF, false, GLOBAL_SCOPE));
    await click("Content", "off");

    expect(note()).toContain(
      "Receiver in Content is set to Off for every organization.",
    );
  });

  it("leaves out the access line when the server could not decide it", async () => {
    await mountPanel();
    mocks.write.mockResolvedValueOnce(verified(OFF, null));
    await click("Content", "off");

    expect(note()).toContain(
      "Receiver in Content is set to Off for this organization.",
    );
    expect(note()).not.toContain("access");
  });

  it("never reports a failed or unverified change as verified", async () => {
    await mountPanel();

    mocks.write.mockRejectedValueOnce(new Error("Write refused"));
    await click("Content", "off");
    expect(note()).toBeNull();

    // An older app answers without the verified contract.
    mocks.write.mockResolvedValueOnce({ ok: true });
    await click("Content", "off");
    expect(note()).toBeNull();
  });

  it("drops the last change as soon as a new one starts", async () => {
    await mountPanel();
    await enableThenTurnOffContent();

    let fail!: (error: Error) => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await click("Analytics", "off");
    expect(note()).toBeNull();

    fail(new Error("Write refused"));
    await flush();
    expect(note()).toBeNull();
  });
});
