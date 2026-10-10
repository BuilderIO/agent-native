// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DictionaryEntry,
  SourceIndexStatus,
} from "../components/semantic-layer/types";

const SOURCE_INDEX_WARNING =
  "Generated source entries may be missing; saved entries are still available.";

const mocks = vi.hoisted(() => {
  const state = {
    entries: [] as DictionaryEntry[],
    sourceIndexStatus: "available" as SourceIndexStatus,
    canManageOrg: true,
    mutateAsync: vi.fn(async (_input: Record<string, unknown>) => ({
      success: true,
    })),
    page: () => ({
      results: state.entries,
      nextPage: null,
      sourceIndexStatus: state.sourceIndexStatus,
    }),
  };
  return state;
});

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: async (name: string) => {
    if (name !== "list-data-dictionary") {
      throw new Error(`Unexpected action: ${name}`);
    }
    return mocks.page();
  },
  useActionQuery: (name: string) => {
    if (name === "list-data-dictionary") {
      return { data: mocks.page(), isLoading: false, isError: false };
    }
    if (name === "get-brain-overview") {
      return {
        data: {
          index: {
            state: "current",
            entryCount: mocks.entries.length,
            generatedAt: null,
          },
        },
        isLoading: false,
      };
    }
    throw new Error(`Unexpected query: ${name}`);
  },
  useActionMutation: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "dataDictionary.generatedEntriesMayBeMissing"
      ? SOURCE_INDEX_WARNING
      : key,
  useFormatters: () => ({ formatDate: () => "" }),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({
    org: { orgId: "org-1" },
    canManageOrg: mocks.canManageOrg,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  useSendToAgentChat: () => ({ send: vi.fn() }),
}));

// Radix tooltips need a TooltipProvider that this page does not mount.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: any) => <span>{children}</span>,
}));

// Radix portals the sheet into document.body; rendering it inline keeps every query inside the container.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  ),
  SheetHeader: ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  ),
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));

const { default: SemanticLayer } = await import("./SemanticLayer");

function setField(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  if (!field) throw new Error(`No field matches ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("No native value setter");
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SemanticLayer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.sourceIndexStatus = "available";
    mocks.canManageOrg = true;
    mocks.entries = [
      {
        id: "index-model-deprecated",
        metric: "Legacy model",
        definition: "A retired model.",
        status: "deprecated",
        sourceIndex: true,
        aiGenerated: true,
      },
      {
        id: "index-model-active",
        metric: "Current model",
        definition: "A current model.",
        status: "active",
        sourceIndex: true,
        aiGenerated: true,
      },
    ];
    mocks.mutateAsync.mockClear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  });

  // Rows arrive through React Query, which notifies on a timer, so poll inside separate act scopes.
  // The source-index row is also an article, so wait for the definitions skeleton to clear instead.
  async function renderPage() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SemanticLayer />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!container.querySelector('[role="status"]')) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    throw new Error("Definitions did not finish loading");
  }

  function row(metric: string) {
    const heading = [...container.querySelectorAll("h3")].find(
      (element) => element.textContent === metric,
    );
    const article = heading?.closest("article");
    if (!article) throw new Error(`No row for ${metric}`);
    return article;
  }

  function buttonWithText(text: string) {
    const button = [...container.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === text,
    );
    if (!button) throw new Error(`No button labelled ${text}`);
    return button;
  }

  it("labels deprecated entries with the deprecated status", async () => {
    await renderPage();

    expect(row("Legacy model").textContent).toContain(
      "dataDictionary.deprecated",
    );
    expect(row("Current model").textContent).not.toContain(
      "dataDictionary.deprecated",
    );
  });

  it.each(["unavailable", "invalid"] as const)(
    "warns when the generated source index is %s",
    async (sourceIndexStatus) => {
      mocks.sourceIndexStatus = sourceIndexStatus;

      await renderPage();

      expect(container.textContent).toContain(SOURCE_INDEX_WARNING);
    },
  );

  it.each(["available", "not-configured"] as const)(
    "does not show an index warning when the source index is %s",
    async (sourceIndexStatus) => {
      mocks.sourceIndexStatus = sourceIndexStatus;

      await renderPage();

      expect(container.textContent).not.toContain(SOURCE_INDEX_WARNING);
    },
  );

  it("passes the deprecated lifecycle through the edit save", async () => {
    await renderPage();

    const editButton = row("Legacy model").querySelector("button");
    expect(editButton).not.toBeNull();
    await act(async () => {
      editButton?.click();
    });

    await act(async () => {
      buttonWithText("dataDictionary.saveEntry").click();
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "index-model-deprecated",
        status: "deprecated",
      }),
    );
  });

  it("saves a same-name definition under the stored entry id without trust flags", async () => {
    mocks.entries = [
      {
        id: "model-revenue",
        metric: "Revenue",
        definition: "Recognized revenue.",
        status: "active",
        approved: true,
        aiGenerated: false,
      },
    ];
    await renderPage();

    await act(async () => {
      buttonWithText("semanticLayer.addDefinition").click();
    });
    await act(async () => {
      setField(
        'input[placeholder="dataDictionary.metricPlaceholder"]',
        "revenue",
      );
    });
    await act(async () => {
      setField(
        'textarea[placeholder="dataDictionary.definitionPlaceholder"]',
        "Revenue net of refunds.",
      );
    });
    expect(container.textContent).toContain("dataDictionary.sameNameNote");

    await act(async () => {
      buttonWithText("dataDictionary.saveEntry").click();
    });

    const payload = mocks.mutateAsync.mock.lastCall?.[0];
    expect(payload).toMatchObject({
      id: "model-revenue",
      metric: "revenue",
    });
    expect(payload).not.toHaveProperty("approved");
    expect(payload).not.toHaveProperty("aiGenerated");
  });
});
