// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  org: { orgId: "org-1", role: "owner" } as {
    orgId: string | null;
    role: string;
  },
  setup: {} as Record<string, unknown>,
  prefs: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: mocks.org }),
}));

vi.mock("@agent-native/core/client/settings", () => ({
  BuilderConnectPopover: ({ children }: { children: ReactNode }) => (
    <div data-testid="builder-connect">{children}</div>
  ),
  ReadOnlySettingValue: ({
    value,
    reason,
  }: {
    value: string;
    reason: string;
  }) => (
    <span data-testid="read-only" data-reason={reason}>
      {value}
    </span>
  ),
  SettingsGroup: ({ id, children }: { id?: string; children: ReactNode }) => (
    <section id={id}>{children}</section>
  ),
  SettingsRow: ({
    id,
    label,
    description,
    control,
    children,
  }: {
    id?: string;
    label: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <div id={id} data-testid="row">
      <span>{label}</span>
      <p>{description}</p>
      <div data-testid={`control-${id}`}>{control}</div>
      {children}
    </div>
  ),
  useSettingsShell: () => ({ navigate: mocks.navigate }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

vi.mock("@/hooks/use-assets-prefs", () => ({
  useAssetsPrefs: () => mocks.prefs,
}));

vi.mock("./generation-setup", () => ({
  useGenerationSetup: () => mocks.setup,
  builderDescription: () => "builder-description",
  generationSummary: () => "generation-summary",
  ManualMethodFields: ({ step }: { step: { id: string } }) => (
    <div data-testid="manual-fields">{step.id}</div>
  ),
}));

import { AssetsGeneralGroups } from "./AssetsGeneralGroups";
import { AssetsNotificationSettings } from "./AssetsNotificationSettings";

function setupState(overrides: Record<string, unknown> = {}) {
  return {
    configData: {},
    configLoading: false,
    configFailed: false,
    flow: { connecting: false },
    generationStep: { id: "image-generation", methods: [] },
    storageStep: { id: "image-storage", methods: [] },
    builderEnabled: true,
    builderConnected: false,
    generationReady: false,
    storageReady: false,
    setupIssue: null,
    orgName: null,
    refreshSetup: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("Assets settings pages", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (node: ReactNode) => {
    act(() => root.render(node));
  };
  const control = (id: string) =>
    container.querySelector(`[data-testid="control-${id}"]`);

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.navigate.mockReset();
    mocks.org = { orgId: "org-1", role: "owner" };
    mocks.setup = setupState();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lets owners add keys and set up storage in a dialog", () => {
    render(<AssetsGeneralGroups />);
    expect(container.querySelector("#asset-generation-setup")).not.toBeNull();
    expect(container.querySelector("#asset-storage")).not.toBeNull();
    expect(container.querySelector('[data-testid="read-only"]')).toBeNull();
    const addKeys = control("generation-keys")?.querySelector("button");
    expect(addKeys?.textContent).toBe("settings.addKeys");
    expect(control("object-storage")?.textContent).toBe("settings.setUp");

    act(() => addKeys?.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("settings.manualGenerationKeys");
    expect(dialog?.textContent).toContain("image-generation");
  });

  it("shows members read-only key and storage rows", () => {
    mocks.org = { orgId: "org-1", role: "member" };
    mocks.setup = setupState({ storageReady: true });
    render(<AssetsGeneralGroups />);
    const readOnly = Array.from(
      container.querySelectorAll('[data-testid="read-only"]'),
    );
    expect(readOnly.map((node) => node.textContent)).toEqual([
      "settings.generationNeedsSetup",
      "settings.generationReady",
    ]);
    expect(readOnly[0]?.getAttribute("data-reason")).toBe(
      "agentChat.settingsShell.appGroup.adminOnly",
    );
    expect(control("generation-keys")?.querySelector("button")).toBeNull();
    // Members still connect their own Builder.io; the server picks the scope.
    expect(
      container.querySelector('[data-testid="builder-connect"]'),
    ).not.toBeNull();
  });

  it("lets a solo workspace manage keys", () => {
    mocks.org = { orgId: null, role: "member" };
    render(<AssetsGeneralGroups />);
    expect(container.querySelector('[data-testid="read-only"]')).toBeNull();
  });

  it("opens the Builder.io page once connected", () => {
    mocks.setup = setupState({
      builderConnected: true,
      configData: { geminiConfigured: true, objectStorageConfigured: true },
    });
    render(<AssetsGeneralGroups />);
    const manage = control("builder")?.querySelector("button");
    expect(manage?.textContent).toBe("settings.manage");
    act(() => manage?.click());
    expect(mocks.navigate).toHaveBeenCalledWith("integrations", "builder");
    expect(control("generation-keys")?.textContent).toBe("settings.manage");
    expect(control("object-storage")?.textContent).toBe("settings.manage");
  });

  it("holds skeletons and no controls while setup loads", () => {
    mocks.setup = setupState({ configLoading: true });
    render(<AssetsGeneralGroups />);
    expect(container.querySelectorAll(".skeleton-shimmer").length).toBe(3);
    expect(container.querySelector("button")).toBeNull();
  });

  it("says when setup status can't be read", () => {
    mocks.setup = setupState({ configFailed: true });
    render(<AssetsGeneralGroups />);
    expect(container.textContent).toContain("settings.setupLoadFailed");
    expect(container.textContent).not.toContain("generation-summary");
  });

  it("saves the email switch and shows a failed read", () => {
    const save = vi.fn(async () => {});
    mocks.prefs = {
      prefs: { emailNotifications: true },
      loading: false,
      loadFailed: false,
      save,
    };
    render(<AssetsNotificationSettings />);
    const toggle = container.querySelector('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    act(() => (toggle as HTMLButtonElement).click());
    expect(save).toHaveBeenCalledWith({ emailNotifications: false });

    mocks.prefs = { prefs: {}, loading: false, loadFailed: true, save };
    render(<AssetsNotificationSettings />);
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).toContain("settings.notificationsLoadFailed");
  });
});
