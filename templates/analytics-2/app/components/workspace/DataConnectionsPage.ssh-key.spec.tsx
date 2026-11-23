// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataConnections } from "@/components/data/WorkspaceDataConnections.fixtures";
import { i18nCatalog } from "@/i18n";
import {
  click,
  mount,
  settle,
  type,
  type Mounted,
} from "@/skins/reference/testing/mount";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock(
  "@/components/data/useDataConnectionActions",
  async () =>
    (await import("@/components/data/WorkspaceDataConnections.fixtures"))
      .dataConnectionActionsMock,
);

const { DataConnectionsPage } = await import("./DataConnectionsPage");
const { SettingsShell } = await import("./SettingsShell");

const MOCK_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockWorkspaceKeyForTestingOnly";

function mountPage() {
  return mount(
    <MemoryRouter initialEntries={["/settings/data-sources"]}>
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <DataConnectionsPage />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("Data connections: Workspace SSH key", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => {
    dataConnections.reset();
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  it("renders Workspace SSH key masked by default and toggles reveal/hide", () => {
    mounted = mountPage();
    const heading = mounted.container.querySelector(
      "#settings-data-sources-ssh-key",
    );
    expect(heading?.textContent).toBe("Workspace SSH key");

    const code = mounted.container.querySelector("code");
    expect(code?.textContent).toBe("****************");
    expect(mounted.container.textContent).not.toContain(MOCK_PUBLIC_KEY);

    const toggle = mounted.container.querySelector(
      'button[aria-label="Show SSH key"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    click(toggle!);
    expect(code?.textContent).toBe(MOCK_PUBLIC_KEY);

    const hide = mounted.container.querySelector(
      'button[aria-label="Hide SSH key"]',
    ) as HTMLButtonElement | null;
    expect(hide).not.toBeNull();
    expect(hide?.getAttribute("aria-pressed")).toBe("true");

    click(hide!);
    expect(code?.textContent).toBe("****************");
  });

  it("copies the real SSH public key while masked and reports success toast", async () => {
    mounted = mountPage();
    const copyButton = mounted.container.querySelector(
      'button[aria-label="Copy SSH key"]',
    ) as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();

    click(copyButton!);
    await settle();

    expect(dataConnections.writeText).toHaveBeenCalledWith(MOCK_PUBLIC_KEY);
    expect(toastMocks.success).toHaveBeenCalledWith("Key copied to clipboard.");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("shows an error toast when copying fails", async () => {
    dataConnections.writeText.mockRejectedValueOnce(new Error("denied"));
    mounted = mountPage();
    const copyButton = mounted.container.querySelector(
      'button[aria-label="Copy SSH key"]',
    ) as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();

    click(copyButton!);
    await settle();

    expect(toastMocks.error).toHaveBeenCalledWith(
      "An error occurred copying the public ssh key. Please try again.",
    );
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it("renders loading and error states with retry", () => {
    dataConnections.sshKeyPending = true;
    dataConnections.sshKey = undefined;
    mounted = mountPage();
    expect(
      mounted.container.querySelector('[role="status"]')?.textContent,
    ).toContain("Loading workspace SSH key");
    mounted.unmount();

    dataConnections.reset();
    dataConnections.sshKeyError = true;
    dataConnections.sshKey = undefined;
    mounted = mountPage();
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain("Could not load workspace SSH key");
    const retry = [...mounted.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    click(retry!);
    expect(dataConnections.sshKeyRefetch).toHaveBeenCalledTimes(1);
  });

  it("hides Workspace SSH key for non-administrators", () => {
    dataConnections.isAdministrator = false;
    mounted = mountPage();
    expect(
      mounted.container.querySelector("#settings-data-sources-ssh-key"),
    ).toBeNull();
  });

  it("indexes Workspace SSH key in Settings search under Data sources", async () => {
    mounted = mount(
      <MemoryRouter initialEntries={["/settings/data-sources"]}>
        <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
          <SettingsShell activeTab="data-sources" canManageWorkspace>
            <DataConnectionsPage />
          </SettingsShell>
        </AgentNativeI18nProvider>
      </MemoryRouter>,
    );

    const openSearch = mounted.container.querySelector(
      'button[aria-label="Search settings"]',
    ) as HTMLButtonElement | null;
    expect(openSearch).not.toBeNull();
    click(openSearch!);
    await settle();

    const searchInput = document.querySelector(
      'input[placeholder="Search..."]',
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    type(searchInput!, "SSH key");
    await settle();

    expect(document.body.textContent).toContain(
      "Data sources > Workspace SSH key",
    );
  });
});
