// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { ProjectsListView } from "./ProjectsListView";

const user = { name: "Sam Reader", email: "reader@example.test" };

describe("projects list archive subtitle", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  const render = (
    view: "archive" | "active" | "trash",
    extra?: {
      archiveSettings?: {
        noEditArchiveCadence: number | null;
        noViewArchiveCadence: number | null;
      };
      canConfigureAutoArchive?: boolean;
      onOpenArchiveSettings?: () => void;
    },
  ) =>
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={[]}
            currentUser={user}
            search=""
            onSearchChange={() => undefined}
            onCreateProject={() => undefined}
            listView={view}
            {...extra}
          />
        </AgentNativeI18nProvider>,
      );
    });

  it("explains Archive without sending users to generic framework docs", () => {
    render("archive");
    expect(host.textContent).toContain(
      "Archive projects and components to declutter a workspace",
    );
    const link = [...host.querySelectorAll("a")].find(
      (anchor) => (anchor.textContent ?? "").trim() === "Learn more",
    );
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe("#archive-help");
    expect(
      host.querySelector('a[href="https://www.agent-native.com/docs"]'),
    ).toBeNull();
    act(() => link?.click());
    const help = document.querySelector(
      '[role="dialog"][aria-label="About Archive"]',
    );
    expect(help).not.toBeNull();
    expect(help?.textContent).toContain("Archiving does not delete");
    expect(help?.textContent).toContain("Unarchive");
  });

  it("keeps the active projects list free of the archive sentence", () => {
    render("active");
    expect(host.textContent).not.toContain(
      "Archive projects and components to declutter a workspace",
    );
  });

  it.each([
    ["active", true],
    ["archive", false],
    ["trash", false],
  ] as const)(
    "shows the New project action in %s only when active",
    (view, enabled) => {
      render(view);
      const actions =
        host.querySelector("header")?.querySelectorAll("button") ?? [];
      expect(
        [...actions].some((action) => action.textContent === "New project"),
      ).toBe(enabled);
    },
  );

  it.each([
    [
      { noEditArchiveCadence: 90, noViewArchiveCadence: null },
      "Your workspace has been configured to automatically archive projects after 90 days with no edits.",
    ],
    [
      { noEditArchiveCadence: null, noViewArchiveCadence: 180 },
      "Your workspace has been configured to automatically archive projects after 180 days with no views.",
    ],
    [
      { noEditArchiveCadence: 90, noViewArchiveCadence: 180 },
      "Your workspace has been configured to automatically archive projects after 90 days with no edits and 180 days with no views.",
    ],
  ])(
    "shows configured auto-archive rules in the Archive header",
    (archiveSettings, expected) => {
      render("archive", { archiveSettings });
      expect(host.textContent).toContain(expected);
    },
  );

  it("omits the auto-archive rules notice when no cadence is configured", () => {
    render("archive", {
      archiveSettings: {
        noEditArchiveCadence: null,
        noViewArchiveCadence: null,
      },
    });
    expect(host.textContent).not.toContain(
      "Your workspace has been configured to automatically archive projects",
    );
  });

  it("links workspace admins from the empty Archive state to organization settings", () => {
    const onOpenArchiveSettings = vi.fn();
    render("archive", {
      canConfigureAutoArchive: true,
      onOpenArchiveSettings,
    });
    expect(host.textContent).toContain(
      "Configure auto-archive rules in workspace settings.",
    );
    const settingsLink = [...host.querySelectorAll("a")].find(
      (anchor) => (anchor.textContent ?? "").trim() === "workspace settings",
    );
    expect(settingsLink).toBeDefined();
    expect(settingsLink?.getAttribute("href")).toContain(
      "/settings/organization",
    );
    act(() => settingsLink?.click());
    expect(onOpenArchiveSettings).toHaveBeenCalledTimes(1);
  });

  it("omits the auto-archive settings link in the empty Archive state for non-admins", () => {
    render("archive", { canConfigureAutoArchive: false });
    expect(host.textContent).not.toContain("Configure auto-archive rules");
  });
});
