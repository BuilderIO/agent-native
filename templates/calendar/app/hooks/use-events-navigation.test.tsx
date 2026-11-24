// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => () =>
    "Google Calendar is rate limited. Showing saved events where available; retrying automatically.",
}));
vi.mock("@/components/calendar/GoogleConnectBanner", () => ({
  GoogleConnectBanner: () => <button>Reconnect Google Calendar</button>,
}));

import { CalendarEventsStatus } from "@/components/calendar/CalendarEventsStatus";

import { useEvents } from "./use-events";
import { useGoogleCalendars } from "./use-google-calendars";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});

const start = Date.parse("2026-11-22T00:00:00.000Z");
const week = 7 * 24 * 60 * 60 * 1000;
const fixture = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, -13].map((index) => ({
  id: `event-${index}`,
  title: `Event ${index}`,
  start: new Date(start + index * week + 3600000).toISOString(),
  end: new Date(start + index * week + 7200000).toISOString(),
  description: "",
  location: "",
  allDay: false,
  source: "local",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
}));

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
let client: QueryClient | undefined;

afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  container?.remove();
  vi.unstubAllGlobals();
});

it("prefetches both neighboring windows for navigation beyond the initial coverage", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      calls++;
      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");
      return new Response(
        JSON.stringify(
          fixture.filter(
            (event) =>
              Date.parse(event.start) >= from && Date.parse(event.start) < to,
          ),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  client = new QueryClient();
  const activeClient = client;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const activeRoot = root;
  function Week({ index }: { index: number }) {
    const from = new Date(start + index * week).toISOString();
    const to = new Date(start + (index + 1) * week).toISOString();
    const events = useEvents(from, to);
    return (
      <div>
        {events.data
          ?.filter((event) => event.start >= from && event.start < to)
          .map((event) => event.title)}
      </div>
    );
  }
  const render = (index: number) =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Week index={index} />
      </QueryClientProvider>,
    );
  await act(async () => render(0));
  await vi.waitFor(() => expect(container?.textContent).toBe("Event 0"));
  await vi.waitFor(() => expect(calls).toBe(3));
  await vi.waitFor(() => expect(client?.isFetching()).toBe(0));
  await act(async () => render(13));
  expect(container.textContent).toBe("Event 13");
  await act(async () => render(-13));
  expect(container.textContent).toBe("Event -13");
});

it("shows ten successive weeks from the loaded event window without further reads", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      calls++;
      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");
      return new Response(
        JSON.stringify(
          fixture.filter(
            (event) =>
              Date.parse(event.start) >= from && Date.parse(event.start) < to,
          ),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const activeClient = client;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const activeRoot = root;
  function Week({ index }: { index: number }) {
    const from = new Date(start + index * week).toISOString();
    const to = new Date(start + (index + 1) * week).toISOString();
    const events = useEvents(from, to);
    return (
      <div>
        {events.data
          ?.filter((event) => event.start >= from && event.start < to)
          .map((event) => event.title)}
      </div>
    );
  }
  const render = (index: number) =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Week index={index} />
      </QueryClientProvider>,
    );
  await act(async () => render(0));
  await vi.waitFor(() => expect(container?.textContent).toBe("Event 0"));
  const initialCalls = calls;
  for (let index = 1; index <= 10; index++) {
    await act(async () => render(index));
    expect(container.textContent).toBe(`Event ${index}`);
  }
  expect(calls - initialCalls).toBeLessThanOrEqual(2);
});

it("keeps saved events and the rate-limit notice through repeated refusals", async () => {
  let throttled = false;
  let refusals = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (throttled) {
        refusals++;
        return new Response(
          JSON.stringify({
            error: "Rate limited",
            errorCode: "calendar_rate_limited",
            details: {
              partialEvents: [{ ...fixture[1], title: "Fresh healthy event" }],
            },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const activeClient = client;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const activeRoot = root;
  function Week() {
    const events = useEvents(
      new Date(start).toISOString(),
      new Date(start + week).toISOString(),
    );
    const error = (events.error ?? events.failureReason) as
      | (Error & { code?: string })
      | null;
    return (
      <>
        <CalendarEventsStatus error={error} />
        <div>{events.data?.map((event) => event.title).join(", ")}</div>
      </>
    );
  }
  await act(async () =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Week />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container?.textContent).toContain("Event 0"));
  await vi.waitFor(() => expect(client?.isFetching()).toBe(0));
  throttled = true;
  act(() => {
    void activeClient.invalidateQueries({
      queryKey: ["action", "list-events"],
    });
  });
  await vi.waitFor(() => expect(refusals).toBeGreaterThanOrEqual(2), {
    timeout: 4000,
  });
  expect(container.textContent).toContain("Event 0");
  expect(container.textContent).toContain("Fresh healthy event");
  expect(container.textContent).toContain("rate limited");
  expect(container.textContent).not.toContain("Reconnect Google Calendar");
});

it("keeps the cached event window when calendar discovery is throttled", async () => {
  let throttled = false;
  let eventReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/list-google-calendars")) {
        if (throttled)
          return new Response(
            JSON.stringify({
              error: "Rate limited",
              errorCode: "calendar_rate_limited",
            }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        return new Response(JSON.stringify({ calendars: [], errors: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      eventReads++;
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const activeClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client = activeClient;
  container = document.createElement("div");
  document.body.append(container);
  const activeRoot = createRoot(container);
  root = activeRoot;
  function Calendar() {
    const sources = useGoogleCalendars();
    const sourceError = sources.error ?? sources.failureReason;
    const events = useEvents(
      new Date(start).toISOString(),
      new Date(start + week).toISOString(),
      undefined,
      [],
      Boolean(sources.data) && !sourceError,
    );
    return (
      <>
        <CalendarEventsStatus
          error={sourceError as (Error & { code?: string }) | null}
        />
        <div>{events.data?.[0]?.title}</div>
      </>
    );
  }
  await act(async () =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Calendar />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container?.textContent).toContain("Event 0"));
  await vi.waitFor(() => expect(activeClient.isFetching()).toBe(0));
  const readsBeforeThrottle = eventReads;
  throttled = true;
  act(() => {
    void activeClient.invalidateQueries({
      queryKey: ["action", "list-google-calendars"],
    });
  });
  await vi.waitFor(() =>
    expect(container?.textContent).toContain("rate limited"),
  );
  expect(container.textContent).toContain("Event 0");
  expect(container.textContent).not.toContain("Reconnect Google Calendar");
  expect(eventReads).toBe(readsBeforeThrottle);
});

it("shows healthy partial events alongside a typed throttling error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "Rate limited",
            errorCode: "calendar_rate_limited",
            details: { partialEvents: [fixture[0]] },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const activeClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client = activeClient;
  container = document.createElement("div");
  document.body.append(container);
  const activeRoot = createRoot(container);
  root = activeRoot;
  function Calendar() {
    const events = useEvents(
      new Date(start).toISOString(),
      new Date(start + week).toISOString(),
    );
    const error = events.error ?? events.failureReason;
    return (
      <>
        <CalendarEventsStatus
          error={error as (Error & { code?: string }) | null}
        />
        <div>{events.data?.[0]?.title}</div>
      </>
    );
  }
  await act(async () =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Calendar />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container?.textContent).toContain("Event 0"));
  expect(container.textContent).toContain("rate limited");
  expect(container.textContent).not.toContain("Reconnect Google Calendar");
});

it("reads successfully discovered sources while another account is throttled", async () => {
  const calendar = {
    sourceKey: "healthy",
    canonicalKey: "healthy",
    calendarId: "healthy@example.test",
    name: "Healthy",
    accountEmail: "healthy@example.test",
    primary: true,
    selected: true,
    accessRole: "owner",
    readOnly: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const details = url.pathname.endsWith("/list-google-calendars")
        ? { calendars: [calendar] }
        : { partialEvents: [fixture[0]] };
      return new Response(
        JSON.stringify({
          error: "Rate limited",
          errorCode: "calendar_rate_limited",
          details,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  const activeClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client = activeClient;
  container = document.createElement("div");
  document.body.append(container);
  const activeRoot = createRoot(container);
  root = activeRoot;
  function Calendar() {
    const sources = useGoogleCalendars();
    const error = sources.error ?? sources.failureReason;
    const events = useEvents(
      new Date(start).toISOString(),
      new Date(start + week).toISOString(),
      undefined,
      sources.data?.map((source) => source.sourceKey),
      Boolean(sources.data),
    );
    return (
      <>
        <CalendarEventsStatus
          error={error as (Error & { code?: string }) | null}
        />
        <div>{events.data?.[0]?.title}</div>
      </>
    );
  }
  await act(async () =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Calendar />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container?.textContent).toContain("Event 0"));
  expect(container.textContent).toContain("rate limited");
});

it("shows a reconnect action and the rate notice for a mixed authorization and quota failure", async () => {
  container = document.createElement("div");
  document.body.append(container);
  const activeRoot = createRoot(container);
  root = activeRoot;
  const error = Object.assign(new Error("Rate limited"), {
    code: "calendar_rate_limited",
    details: { authRequired: true },
  });
  await act(async () =>
    activeRoot.render(<CalendarEventsStatus error={error} />),
  );
  expect(container.textContent).toContain("rate limited");
  expect(container.textContent).toContain("Reconnect Google Calendar");
});

it("loads independent sources when Google calendar discovery fails completely", async () => {
  const requestedSources: string[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      requestedSources.push(url.searchParams.getAll("sources[]"));
      return new Response(JSON.stringify([fixture[0]]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const activeClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client = activeClient;
  container = document.createElement("div");
  document.body.append(container);
  const activeRoot = createRoot(container);
  root = activeRoot;
  function Calendar() {
    const events = useEvents(
      new Date(start).toISOString(),
      new Date(start + week).toISOString(),
      undefined,
      undefined,
      true,
      true,
    );
    return <div>{events.data?.[0]?.title}</div>;
  }
  await act(async () =>
    activeRoot.render(
      <QueryClientProvider client={activeClient}>
        <Calendar />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container?.textContent).toContain("Event 0"));
  expect(requestedSources[0]).toEqual(["bookings", "ics", "overlays"]);
});
