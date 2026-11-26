// @vitest-environment happy-dom
import type { ExternalCalendar } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  useActionQuery: vi.fn(),
  useActionMutation: vi.fn(),
}));

import { useUpdateCalendarDescription } from "./use-calendar-descriptions";
import { useUpdateExternalCalendarColor } from "./use-external-calendars";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FEEDS_KEY = ["action", "list-external-calendars", undefined];
const FEEDS: ExternalCalendar[] = [
  { id: "talks", name: "Talks", url: "https://a.test/t.ics", color: "blue" },
  {
    id: "holidays",
    name: "Holidays",
    url: "https://a.test/h.ics",
    color: "green",
  },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let describeCalendar: ReturnType<typeof useUpdateCalendarDescription> | null =
  null;
let recolor: ReturnType<typeof useUpdateExternalCalendarColor> | null = null;

function hooks() {
  if (!describeCalendar || !recolor) throw new Error("Harness isn't rendered");
  return { describeCalendar, recolor };
}

function Harness() {
  const describeHook = useUpdateCalendarDescription();
  const recolorHook = useUpdateExternalCalendarColor();
  useEffect(() => {
    describeCalendar = describeHook;
    recolor = recolorHook;
  }, [describeHook, recolorHook]);
  return null;
}

async function renderHarness(queryClient: QueryClient) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  await act(async () => {
    created.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });
}

describe("useUpdateCalendarDescription", () => {
  beforeEach(() => {
    describeCalendar = null;
    recolor = null;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    callAction.mockReset();
  });

  it("leaves descriptions out of a color change, so it can't overwrite a saved one", async () => {
    let finishDescription: () => void = () => {};
    callAction.mockImplementation((name: string) => {
      if (name === "update-calendar-description") {
        return new Promise<void>((resolve) => {
          finishDescription = resolve;
        });
      }
      if (name === "update-external-calendars") return Promise.resolve();
      if (name === "list-external-calendars") return Promise.resolve(FEEDS);
      throw new Error(`Unexpected action ${name}`);
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(FEEDS_KEY, FEEDS);
    await renderHarness(queryClient);

    await act(async () => {
      hooks().describeCalendar.mutate({
        feedId: "talks",
        description: " Conference talks\n I might attend ",
      });
    });
    await act(async () => {
      hooks().recolor.mutate({ id: "talks", color: "red" });
    });

    await vi.waitFor(() =>
      expect(callAction).toHaveBeenCalledWith(
        "update-external-calendars",
        {
          calendars: [{ ...FEEDS[0], color: "red" }, FEEDS[1]],
        },
        { method: "PUT" },
      ),
    );
    const colorWrite = callAction.mock.calls.find(
      ([name]) => name === "update-external-calendars",
    );
    expect(
      colorWrite?.[1].calendars.some(
        (feed: ExternalCalendar) => "description" in feed,
      ),
    ).toBe(false);
    await act(async () => finishDescription());
  });

  it("clears a feed's cached description when the text is emptied", async () => {
    callAction.mockImplementation(async (name: string) => {
      if (name === "update-calendar-description") return undefined;
      if (name === "list-external-calendars") {
        return [FEEDS[0], FEEDS[1]];
      }
      throw new Error(`Unexpected action ${name}`);
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(FEEDS_KEY, [
      { ...FEEDS[0], description: "Talks" },
      FEEDS[1],
    ]);
    await renderHarness(queryClient);

    await act(async () => {
      hooks().describeCalendar.mutate({ feedId: "talks", description: "  " });
    });

    expect(callAction).toHaveBeenCalledWith(
      "update-calendar-description",
      { feedId: "talks", description: "  " },
      { method: "PUT" },
    );
    expect(
      queryClient.getQueryData<ExternalCalendar[]>(FEEDS_KEY)?.[0]?.description,
    ).toBeUndefined();
  });
});
