// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: true,
  loadError: false,
  saveError: false,
  retry: vi.fn(),
  call: vi.fn(),
  settings: {
    packageImports: [] as Array<{
      id: string;
      provider: string;
      repository: string;
      branch: string;
      subdir: string;
      createdAt: string;
    }>,
    projectExports: [] as Array<{
      id: string;
      provider: string;
      repository: string;
      branch: string;
      directory: string;
      exportOnPublish: boolean;
      createdAt: string;
    }>,
    repoSyncs: [] as Array<{
      id: string;
      provider: string;
      repository: string;
      branch: string;
      enabled: boolean;
      createdAt: string;
    }>,
  },
}));

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (name: string, input: unknown) => {
    state.call(name, input);
    if (state.saveError) return Promise.reject(new Error("save failed"));
    if (name === "save-git-integrations") {
      state.settings = structuredClone(input as typeof state.settings);
    }
    return Promise.resolve(state.settings);
  },
  useActionQuery: (name: string) => ({
    data:
      name === "get-workspace-bootstrap"
        ? { features: { isAdmin: state.admin } }
        : name === "get-git-integrations"
          ? state.loadError
            ? undefined
            : state.settings
          : undefined,
    isLoading: false,
    isError: name === "get-git-integrations" && state.loadError,
    refetch: state.retry,
  }),
}));

vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

import { AnalyticsGitIntegrationsPage } from "./AnalyticsGitAndSharingPages";

function setInputValue(
  input: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("row 462: AnalyticsGitIntegrationsPage", () => {
  beforeEach(() => {
    state.admin = true;
    state.loadError = false;
    state.saveError = false;
    state.retry.mockReset();
    state.call.mockReset();
    state.settings = {
      packageImports: [],
      projectExports: [],
      repoSyncs: [],
    };
  });

  const mount = () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/settings/git-integrations"]}>
            <AnalyticsGitIntegrationsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    return {
      host,
      close: () => {
        act(() => root.unmount());
        host.remove();
      },
    };
  };

  it("renders all three Git integration sections with stable section IDs", () => {
    const { host, close } = mount();
    try {
      expect(
        host.querySelector("#settings-integrations-git-package-import"),
      ).not.toBeNull();
      expect(
        host.querySelector("#settings-integrations-git-project-export"),
      ).not.toBeNull();
      expect(
        host.querySelector("#settings-integrations-git-repo-syncing"),
      ).not.toBeNull();
    } finally {
      close();
    }
  });

  it("adds and persists a Git package import repository", async () => {
    const { host, close } = mount();
    try {
      const section = host.querySelector(
        "#settings-integrations-git-package-import",
      );
      expect(section).not.toBeNull();
      const addButton = section?.querySelector<HTMLButtonElement>(
        'button[data-testid="add-package-import-btn"]',
      );
      expect(addButton).not.toBeNull();
      await act(async () => addButton?.click());
      const repoInput = section?.querySelector<HTMLInputElement>(
        'input[name="repository"]',
      );
      const branchInput = section?.querySelector<HTMLInputElement>(
        'input[name="branch"]',
      );
      const subdirInput = section?.querySelector<HTMLInputElement>(
        'input[name="subdir"]',
      );
      expect(repoInput).not.toBeNull();
      await act(async () => {
        if (repoInput) setInputValue(repoInput, "acme/analytics-packages");
        if (branchInput) setInputValue(branchInput, "release");
        if (subdirInput) setInputValue(subdirInput, "packages/sql");
      });
      const form = section?.querySelector("form");
      await act(async () => {
        form?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      expect(state.call).toHaveBeenCalledWith(
        "save-git-integrations",
        expect.objectContaining({
          packageImports: [
            expect.objectContaining({
              provider: "github",
              repository: "acme/analytics-packages",
              branch: "release",
              subdir: "packages/sql",
            }),
          ],
        }),
      );
    } finally {
      close();
    }
  });

  it("adds a Git project export target and toggles export on publish", async () => {
    state.settings.projectExports = [
      {
        id: "exp-1",
        provider: "gitlab",
        repository: "acme/projects",
        branch: "main",
        directory: "exports",
        exportOnPublish: false,
        createdAt: "2026-11-22T00:00:00.000Z",
      },
    ];
    const { host, close } = mount();
    try {
      const section = host.querySelector(
        "#settings-integrations-git-project-export",
      );
      expect(section?.textContent).toContain("acme/projects");
      const toggle = section?.querySelector<HTMLButtonElement>(
        'button[role="switch"]',
      );
      expect(toggle).not.toBeNull();
      await act(async () => toggle?.click());
      expect(state.call).toHaveBeenCalledWith(
        "save-git-integrations",
        expect.objectContaining({
          projectExports: [
            expect.objectContaining({
              id: "exp-1",
              exportOnPublish: true,
            }),
          ],
        }),
      );
    } finally {
      close();
    }
  });

  it("adds and removes a Git repo sync connection", async () => {
    state.settings.repoSyncs = [
      {
        id: "sync-1",
        provider: "bitbucket",
        repository: "acme/analytics-sync",
        branch: "main",
        enabled: true,
        createdAt: "2026-11-22T00:00:00.000Z",
      },
    ];
    const { host, close } = mount();
    try {
      const section = host.querySelector(
        "#settings-integrations-git-repo-syncing",
      );
      expect(section?.textContent).toContain("acme/analytics-sync");
      const removeButton = section?.querySelector<HTMLButtonElement>(
        'button[data-testid="remove-repo-sync-sync-1"]',
      );
      expect(removeButton).not.toBeNull();
      await act(async () => removeButton?.click());
      expect(state.call).toHaveBeenCalledWith(
        "save-git-integrations",
        expect.objectContaining({
          repoSyncs: [],
        }),
      );
    } finally {
      close();
    }
  });

  it("rejects invalid repository slugs without saving", async () => {
    const { host, close } = mount();
    try {
      const section = host.querySelector(
        "#settings-integrations-git-package-import",
      );
      expect(section).not.toBeNull();
      await act(async () =>
        section
          ?.querySelector<HTMLButtonElement>(
            'button[data-testid="add-package-import-btn"]',
          )
          ?.click(),
      );
      const repoInput = section?.querySelector<HTMLInputElement>(
        'input[name="repository"]',
      );
      expect(repoInput).not.toBeNull();
      await act(async () => {
        if (repoInput) setInputValue(repoInput, "not-a-valid-repo");
      });
      await act(async () => {
        section
          ?.querySelector("form")
          ?.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(state.call).not.toHaveBeenCalled();
      expect(section?.querySelector('[role="alert"]')).not.toBeNull();
    } finally {
      close();
    }
  });

  it("disables mutating controls for non-admin users", () => {
    state.admin = false;
    const { host, close } = mount();
    try {
      const addButtons = host.querySelectorAll<HTMLButtonElement>(
        'button[data-testid^="add-"]',
      );
      expect(addButtons.length).toBe(3);
      for (const button of addButtons) {
        expect(button.disabled).toBe(true);
      }
    } finally {
      close();
    }
  });

  it("shows a retryable alert when loading fails", async () => {
    state.loadError = true;
    const { host, close } = mount();
    try {
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      const retryButton = host.querySelector<HTMLButtonElement>(
        'button[data-testid="git-integrations-retry"]',
      );
      expect(retryButton).not.toBeNull();
      await act(async () => retryButton?.click());
      expect(state.retry).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });
});
