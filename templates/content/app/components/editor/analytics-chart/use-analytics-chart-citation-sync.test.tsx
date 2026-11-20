// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCUMENT_UPDATE_MUTATION_KEY } from "@/hooks/use-documents";

import {
  analyticsChartSignature,
  CITATION_SYNC_DELAY_MS,
  LIVE_COPY_CITATION_SYNC_DELAY_MS,
  useAnalyticsChartCitationSync,
} from "./use-analytics-chart-citation-sync";

const hooks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: hooks.callAction,
}));

function chartTag(id: string, capturedAt = "2026-11-07T16:40:00.000Z") {
  return `<AnalyticsChart id="${id}" dashboard={{"id":"growth"}} panel={{"id":"wau"}} capturedAt="${capturedAt}" />`;
}

const WITH_CHART = `# Report\n\n${chartTag("analytics-chart-1")}\n\nNotes.`;
const WITHOUT_CHART = "# Report\n\nNotes.";

type Options = Parameters<typeof useAnalyticsChartCitationSync>[0];

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;

async function mount(options: Options) {
  function Harness(props: Options) {
    useAnalyticsChartCitationSync(props);
    return null;
  }
  const render = (next: Options) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness {...next} />
        </QueryClientProvider>,
      ),
    );
  await render(options);
  return { rerender: render };
}

async function save(variables: Record<string, unknown>) {
  await act(async () => {
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationKey: DOCUMENT_UPDATE_MUTATION_KEY,
        mutationFn: async () => ({}),
      })
      .execute(variables);
  });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function syncedPages() {
  return hooks.callAction.mock.calls.map(([action, input]) => [action, input]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hooks.callAction.mockReset();
  hooks.callAction.mockResolvedValue({ dashboardIds: [], unreadable: 0 });
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("analyticsChartSignature", () => {
  it("changes when a chart is added, refreshed or removed, not when text around it is edited", () => {
    const before = analyticsChartSignature(WITH_CHART);
    expect(analyticsChartSignature(WITHOUT_CHART)).toBe("");
    expect(analyticsChartSignature(`${WITH_CHART}\n\nMore notes.`)).toBe(
      before,
    );
    expect(
      analyticsChartSignature(
        `# Report\n\n${chartTag("analytics-chart-1", "2026-11-08T09:00:00.000Z")}`,
      ),
    ).not.toBe(before);
    expect(
      analyticsChartSignature(
        `${WITH_CHART}\n\n${chartTag("analytics-chart-2")}`,
      ),
    ).not.toBe(before);
  });
});

describe("useAnalyticsChartCitationSync", () => {
  it("syncs a page that opens with charts once", async () => {
    await mount({
      documentId: "doc_1",
      enabled: true,
      openedContent: WITH_CHART,
      liveCopyContent: null,
    });
    expect(hooks.callAction).not.toHaveBeenCalled();

    await wait(CITATION_SYNC_DELAY_MS);
    await save({ id: "doc_1", content: `${WITH_CHART}\n\nMore notes.` });
    await wait(CITATION_SYNC_DELAY_MS * 2);

    expect(syncedPages()).toEqual([
      ["sync-analytics-chart-citations", { documentId: "doc_1" }],
    ]);
  });

  it("syncs once after saves that add or remove a chart", async () => {
    await mount({
      documentId: "doc_1",
      enabled: true,
      openedContent: WITHOUT_CHART,
      liveCopyContent: null,
    });
    await wait(CITATION_SYNC_DELAY_MS);
    expect(hooks.callAction).not.toHaveBeenCalled();

    await save({ id: "doc_1", content: WITH_CHART });
    await save({ id: "doc_1", content: `${WITH_CHART}\n\nTyping.` });
    await save({ id: "doc_2", content: WITHOUT_CHART });
    await save({ id: "doc_1", title: "Renamed" });
    await wait(CITATION_SYNC_DELAY_MS);
    expect(syncedPages()).toEqual([
      ["sync-analytics-chart-citations", { documentId: "doc_1" }],
    ]);

    await save({ id: "doc_1", content: WITHOUT_CHART });
    await wait(CITATION_SYNC_DELAY_MS);
    expect(hooks.callAction).toHaveBeenCalledTimes(2);
  });

  it("tries again on the next save after a sync fails, with only a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hooks.callAction.mockRejectedValueOnce(new Error("offline"));
    await mount({
      documentId: "doc_1",
      enabled: true,
      openedContent: WITHOUT_CHART,
      liveCopyContent: null,
    });

    await save({ id: "doc_1", content: WITH_CHART });
    await wait(CITATION_SYNC_DELAY_MS);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Cited in"),
      expect.objectContaining({ documentId: "doc_1" }),
    );

    await save({ id: "doc_1", content: WITH_CHART });
    await wait(CITATION_SYNC_DELAY_MS);
    expect(hooks.callAction).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("follows the editor's body on a live-copy page", async () => {
    const { rerender } = await mount({
      documentId: "doc_1",
      enabled: true,
      openedContent: WITHOUT_CHART,
      liveCopyContent: WITHOUT_CHART,
    });
    await rerender({
      documentId: "doc_1",
      enabled: true,
      openedContent: WITHOUT_CHART,
      liveCopyContent: WITH_CHART,
    });
    await wait(LIVE_COPY_CITATION_SYNC_DELAY_MS - 1);
    expect(hooks.callAction).not.toHaveBeenCalled();

    await wait(1);
    expect(syncedPages()).toEqual([
      ["sync-analytics-chart-citations", { documentId: "doc_1" }],
    ]);
  });

  it("sends a waiting sync when the editor closes", async () => {
    await mount({
      documentId: "doc_1",
      enabled: true,
      openedContent: WITHOUT_CHART,
      liveCopyContent: null,
    });
    await save({ id: "doc_1", content: WITH_CHART });
    expect(hooks.callAction).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    root = createRoot(container);

    expect(syncedPages()).toEqual([
      ["sync-analytics-chart-citations", { documentId: "doc_1" }],
    ]);
  });

  it("does nothing for someone who can't edit the page", async () => {
    await mount({
      documentId: "doc_1",
      enabled: false,
      openedContent: WITH_CHART,
      liveCopyContent: null,
    });
    await save({ id: "doc_1", content: WITHOUT_CHART });
    await wait(LIVE_COPY_CITATION_SYNC_DELAY_MS);
    expect(hooks.callAction).not.toHaveBeenCalled();
  });
});
