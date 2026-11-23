// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { notebookHistoryReadSchema } from "../../../shared/notebook-history";
import { ProjectHistoryPanel } from "./ProjectHistoryPanel";
import { ProjectVersionCompareDialog } from "./ProjectVersionCompareDialog";

const { request, project } = vi.hoisted(() => ({
  request: vi.fn(),
  project: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", async (load) => ({
  ...(await load<typeof import("@agent-native/core/client/hooks")>()),
  callAction: request,
  useActionQuery: project,
}));

it("shows committed cell effects and keeps only checkpoints in Versions only", async () => {
  const version = {
    id: "version:version-1",
    kind: "version",
    version: {
      id: "version-1",
      name: "Quarterly review",
      number: "1",
      kind: "named",
      createdAt: "2026-11-18T10:05:00.000Z",
      createdBy: "editor@example.test",
      isWorking: false,
      isPublished: false,
    },
  };
  const edit = {
    kind: "edits",
    id: "edits:1",
    actor: "editor@example.test",
    startedAt: "2026-11-18T10:00:00.000Z",
    endedAt: "2026-11-18T10:02:00.000Z",
    changeCount: 2,
    lowerBound: false,
    groups: [
      {
        kind: "cell",
        id: "orders",
        label: "Orders",
        cellKind: "sql",
        effects: [
          { type: "move", field: "order", count: 1, value: null },
          { type: "edit", field: "source", count: 3, value: null },
        ],
      },
    ],
  };
  request.mockImplementation(async (_action, { filter }) =>
    notebookHistoryReadSchema.parse({
      items: filter === "versions" ? [version] : [version, edit],
      nextCursor: null,
      editsTruncated: false,
      canManageVersions: true,
    }),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  const onPreview = vi.fn(async () => {});
  const onCheckpoint = vi.fn();
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <ProjectHistoryPanel
              projectId="prj_qa"
              onClose={onClose}
              onPreview={onPreview}
              onCheckpoint={onCheckpoint}
            />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector("summary")?.textContent).toContain(
        "made 2 changes",
      );
    });
    const details = host.querySelector("details");
    assert(details);
    details.open = true;
    expect(details.textContent).toContain("Orders");
    expect(details.textContent).toContain("Moved location");
    expect(details.textContent).toContain("Changed SQL code");

    const versions = [
      ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === "Versions only");
    assert(versions);
    await act(async () =>
      versions.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.textContent).toContain("Quarterly review");
      expect(host.querySelector("summary")).toBeNull();
    });
    const preview = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Quarterly review",
    );
    assert(preview);
    expect(preview.className).toContain("[overflow-wrap:anywhere]");
    await act(async () => preview.click());
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(version.version);
    const checkpoint = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Version",
    );
    assert(checkpoint);
    await act(async () => checkpoint.click());
    expect(onCheckpoint).toHaveBeenCalledOnce();
    const close = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Close History & versions"]',
    );
    assert(close);
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    request.mockReset();
    vi.unstubAllGlobals();
  }
});

it("compares saved and draft cells by ID and skips identical cells", async () => {
  project.mockImplementation((_name, { version }) => ({
    isError: false,
    data: {
      project: {
        cells: [
          ...(version
            ? [
                {
                  id: "removed",
                  contents: {
                    kind: "markdown",
                    order: "a0",
                    label: "Old notes",
                    markdown: "Removed text",
                  },
                },
              ]
            : []),
          {
            id: "changed",
            contents: {
              kind: "sql",
              order: "a1",
              label: version ? "Original sales" : "Current sales",
              source: version ? "SELECT 42" : "SELECT 84",
            },
          },
          {
            id: "same",
            contents: {
              kind: "markdown",
              order: "a2",
              label: "Notes",
              markdown: "Published scope",
            },
          },
        ],
      },
      outputs: {},
    },
  }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ProjectVersionCompareDialog
            projectId="prj_qa"
            version={{
              id: "ver_1",
              name: "Monthly close",
              number: "1",
              kind: "named",
              createdAt: "2026-11-18T10:00:00.000Z",
              createdBy: "owner@example.test",
              isWorking: false,
              isPublished: false,
            }}
            onClose={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const dialog = document.querySelector('[role="dialog"]');
    assert(dialog);
    const notes = [...dialog.querySelectorAll("li")].find(
      (row) => row.querySelector("h3")?.textContent === "Notes",
    );
    expect(
      [...dialog.querySelectorAll("pre")].map((cell) => cell.textContent),
    ).toEqual(["SELECT 42", "SELECT 84", "Removed text"]);
    expect(notes?.textContent).toBe("NotesSkipped");
    const config = [...dialog.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === "Config",
    );
    assert(config);
    await act(async () =>
      config.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(
      [...dialog.querySelectorAll("pre")].map((cell) => cell.textContent),
    ).toEqual([
      expect.stringContaining('"label": "Original sales"'),
      expect.stringContaining('"label": "Current sales"'),
      expect.stringContaining('"label": "Old notes"'),
    ]);
    expect(notes?.textContent).toBe("NotesSkipped");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    project.mockReset();
    vi.unstubAllGlobals();
  }
});

it("words edit-group counts in the singular and marks truncated counts", async () => {
  const group = (id: string, changeCount: number, lowerBound: boolean) => ({
    kind: "edits",
    id,
    actor: "editor@example.test",
    startedAt: "2026-11-18T10:00:00.000Z",
    endedAt: "2026-11-18T10:02:00.000Z",
    changeCount,
    lowerBound,
    groups: [],
  });
  request.mockImplementation(async () =>
    notebookHistoryReadSchema.parse({
      items: [group("edits:1", 1, false), group("edits:2", 50, true)],
      nextCursor: null,
      editsTruncated: false,
      canManageVersions: true,
    }),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <ProjectHistoryPanel projectId="prj_qa" onClose={vi.fn()} />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      const summaries = [...host.querySelectorAll("summary")].map(
        (summary) => summary.textContent,
      );
      expect(summaries[0]).toContain("made 1 change ");
      expect(summaries[1]).toContain("made 50+ changes");
    });
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    request.mockReset();
    vi.unstubAllGlobals();
  }
});
