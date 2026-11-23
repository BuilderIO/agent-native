// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

import { ProjectEditor } from "./ProjectEditor";
import type { NotebookConnection } from "./types";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  useActionMutation: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: undefined, isPending: false, error: null }),
}));

vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

const emptyProject: ProjectDocument = {
  id: "prj_empty_conn",
  title: "Untitled notebook",
  description: "",
  language: "python",
  ownerEmail: "user@example.com",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  collectionIds: [],
  cells: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
};

const sampleConnections: NotebookConnection[] = [
  {
    id: "conn_demo",
    name: "[Demo] Public Data",
    isDefault: true,
  },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it("enables source chip button by default and opens data browser on click", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <ProjectEditor
                project={emptyProject}
                connections={sampleConnections}
                canEdit
                onRename={async () => {}}
                onSaveCell={async () => {}}
                onAddCell={async () => "cel_1"}
                onDeleteCell={async () => {}}
                onRunCell={async () => {}}
                onSelectConnection={async () => {}}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const sourceChip = container.querySelector<HTMLButtonElement>(
      "button.nb-empty-connection",
    );
    assert(sourceChip);
    expect(sourceChip.disabled).toBe(false);
    expect(sourceChip.textContent).toContain("[Demo] Public Data");

    expect(
      container.querySelector('aside[aria-label="Data browser"]'),
    ).toBeNull();

    await act(async () => {
      sourceChip.click();
    });

    expect(
      container.querySelector('aside[aria-label="Data browser"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("preserves caller-provided onSelectConnection when passed in emptyState", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const customSelectConnection = vi.fn();

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <ProjectEditor
                project={emptyProject}
                connections={sampleConnections}
                canEdit
                emptyState={{
                  onSelectConnection: customSelectConnection,
                }}
                onRename={async () => {}}
                onSaveCell={async () => {}}
                onAddCell={async () => "cel_1"}
                onDeleteCell={async () => {}}
                onRunCell={async () => {}}
                onSelectConnection={async () => {}}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const sourceChip = container.querySelector<HTMLButtonElement>(
      "button.nb-empty-connection",
    );
    assert(sourceChip);
    expect(sourceChip.disabled).toBe(false);

    await act(async () => {
      sourceChip.click();
    });

    expect(customSelectConnection).toHaveBeenCalledOnce();
    expect(
      container.querySelector('aside[aria-label="Data browser"]'),
    ).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("disables source chip button when data browsing capability is not allowed and no handler is provided", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <ProjectEditor
                project={emptyProject}
                connections={sampleConnections}
                canEdit
                capabilities={[]}
                onRename={async () => {}}
                onSaveCell={async () => {}}
                onAddCell={async () => "cel_1"}
                onDeleteCell={async () => {}}
                onRunCell={async () => {}}
                onSelectConnection={async () => {}}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const sourceChip = container.querySelector<HTMLButtonElement>(
      "button.nb-empty-connection",
    );
    assert(sourceChip);
    expect(sourceChip.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
