// @vitest-environment happy-dom
import { AgentNativeI18nProvider, useT } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectVersion } from "@/lib/model/project-version-contracts";

import { notebookHistoryReadSchema } from "../../../shared/notebook-history";
import { ProjectHistoryPanel, versionPreviewCopy } from "./ProjectHistoryPanel";
import { ProjectVersionCompareDialog } from "./ProjectVersionCompareDialog";
import { SaveProjectVersionDialog } from "./SaveProjectVersionDialog";
import { versionAge } from "./version-age";

const { request, project } = vi.hoisted(() => ({
  request: vi.fn(),
  project: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", async (load) => ({
  ...(await load<typeof import("@agent-native/core/client/hooks")>()),
  callAction: request,
  useActionQuery: project,
}));

const version = (name: string | null): ProjectVersion => ({
  id: "ver_1",
  name,
  number: "3",
  kind: "named",
  createdAt: "2026-11-18T10:00:00.000Z",
  createdBy: "owner@example.test",
  isWorking: false,
  isPublished: false,
});

function Probe({
  value,
  onCopy,
}: {
  value: ProjectVersion;
  onCopy: (copy: ReturnType<typeof versionPreviewCopy>) => void;
}) {
  onCopy(versionPreviewCopy(value, useT()));
  return null;
}

async function mount(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          {node}
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  };
}

it("names the version in the preview banner and restore confirmation", async () => {
  let copy: ReturnType<typeof versionPreviewCopy> | undefined;
  const cleanup = await mount(
    <Probe value={version("Quarterly 😀 review")} onCopy={(c) => (copy = c)} />,
  );
  try {
    expect(copy).toEqual({
      viewing: 'Viewing version #3: "Quarterly 😀 review"',
      confirm:
        'Are you sure you want to restore version #3: "Quarterly 😀 review"?',
    });
  } finally {
    await cleanup();
  }
});

it("falls back to the number alone for unnamed versions", async () => {
  let copy: ReturnType<typeof versionPreviewCopy> | undefined;
  const cleanup = await mount(
    <Probe value={version("   ")} onCopy={(c) => (copy = c)} />,
  );
  try {
    expect(copy).toEqual({
      viewing: "Viewing version #3",
      confirm: "Are you sure you want to restore version #3?",
    });
  } finally {
    await cleanup();
  }
});

it("titles the save dialog and labels the required name field visibly", async () => {
  const cleanup = await mount(
    <SaveProjectVersionDialog
      projectId="prj_qa"
      captureHead={async () => {
        throw new Error("unused");
      }}
      onClose={() => {}}
    />,
  );
  try {
    const dialog = document.querySelector('[role="dialog"]');
    assert(dialog);
    expect(dialog.querySelector("h2")?.textContent).toBe("Save a version");
    const input = dialog.querySelector("input");
    assert(input);
    const label = dialog.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Name of version (required)",
    );
    expect(input.getAttribute("aria-label")).toBeNull();
  } finally {
    await cleanup();
  }
});

it("buckets timestamps into relative ages and gives up after a month", () => {
  const now = Date.parse("2026-11-18T12:00:00.000Z");
  const at = (secondsAgo: number) =>
    new Date(now - secondsAgo * 1000).toISOString();
  expect(versionAge(at(0), now)).toEqual({ unit: "seconds", count: 1 });
  expect(versionAge(at(5), now)).toEqual({ unit: "seconds", count: 5 });
  expect(versionAge(at(60), now)).toEqual({ unit: "minutes", count: 1 });
  expect(versionAge(at(3 * 3600), now)).toEqual({ unit: "hours", count: 3 });
  expect(versionAge(at(2 * 86400), now)).toEqual({ unit: "days", count: 2 });
  expect(versionAge(at(40 * 86400), now)).toBeNull();
  expect(versionAge("not a date", now)).toBeNull();
});

const edit = {
  kind: "edits",
  id: "edits:1",
  actor: "editor@example.test",
  startedAt: "2026-11-18T11:59:00.000Z",
  endedAt: "2026-11-18T11:59:30.000Z",
  changeCount: 1,
  lowerBound: false,
  groups: [
    {
      kind: "cell",
      id: "orders",
      label: "Orders",
      cellKind: "sql",
      effects: [{ type: "edit", field: "source", count: 1, value: null }],
    },
  ],
};

it("lists named versions as '<actor> saved a version (<name>)' with relative ages and open edit groups", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
  const named = {
    kind: "version",
    id: "version:v1",
    version: {
      id: "v1",
      name: "Quarterly review",
      number: "1",
      kind: "named",
      createdAt: "2026-11-18T11:59:55.000Z",
      createdBy: "editor@example.test",
      isWorking: false,
      isPublished: false,
    },
  };
  request.mockResolvedValue(
    notebookHistoryReadSchema.parse({
      items: [named, edit],
      nextCursor: null,
      editsTruncated: false,
      canManageVersions: true,
    }),
  );
  const cleanup = await mount(
    <ProjectHistoryPanel
      projectId="prj_qa"
      onClose={() => {}}
      onPreview={async () => {}}
      onCheckpoint={() => {}}
    />,
  );
  try {
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector("details")).not.toBeNull();
    });
    const item = document.querySelector(".nb-history-item");
    expect(item?.textContent).toContain(
      "editor@example.test saved a version (Quarterly review)",
    );
    expect(item?.textContent).toContain("5 secs ago");
    expect(item?.textContent).not.toContain("Named");
    expect(
      document.querySelector("summary .nb-history-meta")?.textContent,
    ).toContain("30 secs ago");
    expect(document.querySelector("details")?.open).toBe(true);
  } finally {
    await cleanup();
    request.mockReset();
    vi.useRealTimers();
  }
});

it("announces Save version with its shortcut on the Version button", async () => {
  request.mockResolvedValue(
    notebookHistoryReadSchema.parse({
      items: [],
      nextCursor: null,
      editsTruncated: false,
      canManageVersions: true,
    }),
  );
  const cleanup = await mount(
    <ProjectHistoryPanel
      projectId="prj_qa"
      onClose={() => {}}
      onCheckpoint={() => {}}
    />,
  );
  try {
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent === "Version",
        ),
      ).toBe(true);
    });
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Version",
    );
    assert(button);
    await act(async () => button.focus());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.body.textContent).toMatch(/Save version\s*(⌘S|Ctrl\+S)/);
    });
  } finally {
    await cleanup();
    request.mockReset();
  }
});

it("titles the compare dialog 'Compare version' and ages the compared version", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
  project.mockImplementation(() => ({
    isError: false,
    data: { project: { cells: [] }, outputs: {} },
  }));
  const cleanup = await mount(
    <ProjectVersionCompareDialog
      projectId="prj_qa"
      version={{ ...version("  "), createdAt: "2026-11-18T11:58:00.000Z" }}
      onClose={() => {}}
    />,
  );
  try {
    const dialog = document.querySelector('[role="dialog"]');
    assert(dialog);
    expect(dialog.querySelector("h2")?.textContent).toBe("Compare version");
    expect(dialog.textContent).toContain("2 mins ago Version 3");
  } finally {
    await cleanup();
    project.mockReset();
    vi.useRealTimers();
  }
});
