// @vitest-environment happy-dom

import type { McpApprovalView } from "@agent-native/core/client/mcp-approval";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();
vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  useSession: () => useSessionMock(),
}));

import {
  McpApprovalReviewGate,
  McpApprovalReviewPage,
} from "./McpApprovalReview.js";

const ID = "0b7f4c1e-2f4a-4d1c-9a43-5f1e8f0d2c6b";
const NOW = Date.parse("2026-10-22T16:00:00Z");
const START = Date.parse("2026-10-22T14:00:00-07:00");

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function pendingView(
  overrides: Partial<McpApprovalView> = {},
): McpApprovalView {
  return {
    id: ID,
    state: "pending",
    actionName: "create-event",
    summary: {
      title: "Create event",
      recipients: ["ana@example.com", "bo@example.com"],
      fields: [
        { label: "Title", value: "Design review" },
        {
          label: "Start",
          value: "2026-10-22T14:00:00-07:00",
          time: { at: START, zone: "America/Los_Angeles" },
        },
        {
          label: "End",
          value: "2026-10-22T14:30:00",
          wallTime: {
            at: Date.parse("2026-10-22T14:30:00Z"),
            zone: "calendar",
          },
        },
      ],
      details: '{\n  "title": "Design review"\n}',
      arguments: "stored",
      cut: false,
    },
    requester: {
      name: "Claude Code",
      connectedAt: Date.parse("2026-10-01T12:00:00Z"),
    },
    createdAt: NOW,
    expiresAt: NOW + 10 * 60_000,
    priorRun: undefined,
    readerTimeZone: "America/New_York",
    locale: "en-US",
    csrfToken: "token-1",
    ...overrides,
  };
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Answers the review's read with `view`, and its decision with `decision`. */
function serve(
  view: () => Response | Promise<Response>,
  decision: () => Response | Promise<Response> = () =>
    respond(200, { state: "approved", expiresAt: NOW + 10 * 60_000 }),
) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST" ? decision() : view(),
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

async function renderPage(onOpenApp = vi.fn()) {
  act(() => {
    root.render(
      <McpApprovalReviewPage
        id={ID}
        appName="Calendar"
        onOpenApp={onOpenApp}
      />,
    );
  });
  await settle();
  return onOpenApp;
}

/** The page's text, with the narrow spaces some ICU versions put before AM/PM. */
function text(): string {
  return (container.textContent ?? "").replace(/ /g, " ");
}

/** Each summary row as its label and value. */
function facts(): [string, string][] {
  return [...container.querySelectorAll("dt")].map((label) => [
    label.textContent ?? "",
    (label.nextElementSibling?.textContent ?? "").replace(/ /g, " "),
  ]);
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
  await settle();
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  useSessionMock.mockReturnValue({
    session: { email: "owner@example.com" },
    status: "authenticated",
  });
  document.title = "Calendar";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("a pending review", () => {
  it("shows everything the call does, in the reader's zone, and focuses the page rather than Approve", async () => {
    serve(() => respond(200, pendingView()));

    await renderPage();

    const page = text();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Claude Code wants to create event",
    );
    expect(page).toContain("ana@example.com");
    expect(page).toContain("bo@example.com");
    expect(facts()).toEqual([
      ["Connected", "Oct 1, 2026"],
      ["Title", "Design review"],
      [
        "Start",
        "Thu, Oct 22, 5:00 PM EDT (Thu, Oct 22, 2:00 PM PDT as requested)",
      ],
      ["End", "Thu, Oct 22, 2:30 PM (in the calendar's time zone)"],
    ]);
    expect(page).toContain("Decide by 12:10 PM EDT.");
    expect(document.title).toBe("Approve Create event?");
    expect(document.activeElement?.tagName).toBe("MAIN");
    expect(fetchMock).toHaveBeenCalledWith(
      `/_agent-native/mcp/approvals/${ID}`,
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("warns when the identical call already ran, and when the server couldn't keep all of it", async () => {
    serve(() =>
      respond(
        200,
        pendingView({
          priorRun: { at: NOW - 5 * 60_000, status: "completed" },
          summary: { ...pendingView().summary, cut: true },
        }),
      ),
    );

    await renderPage();

    const alerts = [...container.querySelectorAll('[role="alert"]')].map(
      (alert) => alert.textContent?.replace(/ /g, " "),
    );
    expect(alerts).toEqual([
      "This exact request already ran at 11:55 AM EDT. Approving runs it again.",
      expect.stringContaining("Part of this request was too large to keep"),
    ]);
  });

  it("says plainly when the arguments weren't kept", async () => {
    serve(() =>
      respond(
        200,
        pendingView({
          summary: {
            ...pendingView().summary,
            fields: [],
            recipients: [],
            details: undefined,
            arguments: "not-stored",
          },
        }),
      ),
    );

    await renderPage();

    expect(text()).toContain(
      "This request's arguments weren't saved, so they can't be shown.",
    );
    expect(text()).not.toContain("Details");
  });

  it("speaks the summary's language", async () => {
    serve(() =>
      respond(
        200,
        pendingView({
          locale: "de-DE",
          summary: { ...pendingView().summary, title: "Termin erstellen" },
        }),
      ),
    );

    await renderPage();

    expect(button("Genehmigen")).toBeTruthy();
    expect(button("Ablehnen")).toBeTruthy();
    expect(document.title).toBe("Termin erstellen genehmigen?");
  });

  it.each([
    [
      "Claude Code",
      "en-US",
      "Create event",
      "Claude Code wants to create event",
    ],
    [null, "en-US", "Create event", "An unnamed app wants to create event"],
    [undefined, "en-US", "RSVP to event", "Your agent wants to RSVP to event"],
    [
      "{action} $& Bot",
      "en-US",
      "Create event",
      "{action} $& Bot wants to create event",
    ],
    [
      "Claude Code",
      "de-DE",
      "Termin erstellen",
      "Claude Code möchte Termin erstellen ausführen",
    ],
  ] as const)(
    "leads with who asks and for what (client %j, %s)",
    async (name, locale, title, heading) => {
      serve(() =>
        respond(
          200,
          pendingView({
            requester:
              name === undefined ? undefined : { name, connectedAt: null },
            locale,
            summary: { ...pendingView().summary, title },
          }),
        ),
      );

      await renderPage();

      expect(container.querySelector("h1")?.textContent).toBe(heading);
    },
  );

  it("keeps each address whole, breaking a line only after its @, and copies it as written", async () => {
    const cc = "Bo <bo-smith@example.com>, cy-jones@example.co.uk";
    serve(() =>
      respond(
        200,
        pendingView({
          summary: {
            ...pendingView().summary,
            recipients: ["ana-maria.long-name@example.com"],
            fields: [{ label: "Cc", value: cc }],
            details: `{\n  "cc": "${cc}"\n}`,
          },
        }),
      ),
    );

    await renderPage();

    const unbroken = (element: Element) =>
      [...element.querySelectorAll(".whitespace-nowrap")].map(
        (part) => part.textContent,
      );
    const recipient = container.querySelector("li")!.lastElementChild!;
    expect(recipient.textContent).toBe("ana-maria.long-name@example.com");
    expect(unbroken(recipient)).toEqual([
      "ana-maria.long-name@",
      "example.com",
    ]);
    expect(recipient.querySelectorAll("wbr")).toHaveLength(1);

    const value = container.querySelector("dd:last-of-type")!;
    expect(value.textContent).toBe(cc);
    expect(unbroken(value)).toEqual([
      "bo-smith@",
      "example.com",
      "cy-jones@",
      "example.co.uk",
    ]);
    await click("Details");
    expect(container.querySelector("pre")?.textContent).toBe(
      `{\n  "cc": "${cc}"\n}`,
    );
  });

  it("draws Approve in the theme's text color, which no theme dims", async () => {
    serve(() => respond(200, pendingView()));

    await renderPage();

    expect(button("Approve").className).toContain(
      "bg-foreground text-background",
    );
  });
});

describe("deciding", () => {
  it("approves with the view's token, then says what happens next", async () => {
    serve(() => respond(200, pendingView()));
    const onOpenApp = await renderPage();

    await click("Approve");

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(init.body)).toEqual({
      decision: "approve",
      csrfToken: "token-1",
    });
    expect(text()).toContain(
      "Approved. Go back to your agent and ask it to try again before 12:10 PM EDT.",
    );
    expect(
      [...container.querySelectorAll("p")].map((line) =>
        line.textContent?.replace(/ /g, " "),
      ),
    ).toContain("Design review · Thu, Oct 22, 5:00 PM EDT");
    expect(() => button("Approve")).toThrow();
    expect(document.activeElement?.tagName).toBe("MAIN");

    await click("Open Calendar");
    expect(onOpenApp).toHaveBeenCalledOnce();
  });

  it("shows a decision made first elsewhere", async () => {
    serve(
      () => respond(200, pendingView()),
      () => respond(409, { error: "Decided", state: "denied", expiresAt: 0 }),
    );
    await renderPage();

    await click("Approve");

    expect(text()).toContain("Denied. Nothing ran.");
  });

  it("lets the reader try again when the decision didn't save", async () => {
    serve(
      () => respond(200, pendingView()),
      () => Promise.reject(new TypeError("offline")),
    );
    await renderPage();

    await click("Approve");

    expect(text()).toContain("Your decision wasn't saved. Try again.");
    expect(button("Approve").disabled).toBe(false);
  });

  it.each([
    [403, {}, "This page is out of date. Reload it and decide again."],
    [401, {}, "Sign in to review this request."],
    [
      401,
      { reason: "sign-in-unavailable" },
      "This app can't confirm your sign-in on this page.",
    ],
  ])(
    "stops offering a decision the server will refuse again: %i %j",
    async (status, body, message) => {
      serve(
        () => respond(200, pendingView()),
        () => respond(status, { error: "Refused", ...body }),
      );
      await renderPage();

      await click("Deny");

      expect(text()).toContain(message);
      expect(button("Approve").disabled).toBe(true);
      expect(button("Deny").disabled).toBe(true);
    },
  );
});

describe("a review that can't be decided", () => {
  it("turns expired at its deadline without a reload", async () => {
    serve(() => respond(200, pendingView()));
    await renderPage();
    expect(button("Approve")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000 + 100);
    });

    expect(text()).toContain("This request expired, and nothing ran.");
    expect(() => button("Approve")).toThrow();
  });

  it("names the signed-in account when the grant is in another organization", async () => {
    serve(() =>
      respond(404, { error: "Not found", reason: "other-organization" }),
    );

    await renderPage();

    expect(text()).toContain(
      "This request belongs to owner@example.com in another organization.",
    );
    expect(button("Open Calendar")).toBeTruthy();
  });

  it("says the app can't confirm the sign-in rather than asking for one", async () => {
    serve(() =>
      respond(401, {
        error: "Custom authentication requires a hook",
        reason: "sign-in-unavailable",
      }),
    );

    await renderPage();

    expect(text()).toContain(
      "This app can't confirm your sign-in on this page.",
    );
    expect(text()).not.toContain("Sign in to review");
    expect(button("Open Calendar")).toBeTruthy();
  });

  it("offers a retry when the review couldn't load", async () => {
    let calls = 0;
    serve(() =>
      ++calls === 1
        ? respond(503, { error: "Unavailable" })
        : respond(200, pendingView()),
    );
    await renderPage();
    expect(text()).toContain("This request couldn't be loaded.");

    await click("Try again");

    expect(button("Approve")).toBeTruthy();
  });
});

describe("the gate", () => {
  function renderGate() {
    act(() => {
      root.render(
        <McpApprovalReviewGate appName="Calendar" wrap={(review) => review}>
          <div data-testid="app">app</div>
        </McpApprovalReviewGate>,
      );
    });
  }

  it("shows the app when the URL names no review", () => {
    window.history.replaceState(null, "", "/home#section");

    renderGate();

    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the review the fragment names, then the app once the reader leaves it", async () => {
    window.history.replaceState(null, "", `/home?view=week#mcpApproval=${ID}`);
    serve(() => respond(404, { error: "Not found" }));

    renderGate();
    await settle();
    expect(container.querySelector('[data-testid="app"]')).toBeNull();

    await click("Open Calendar");

    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/home?view=week",
    );
    expect(window.location.hash).toBe("");
  });

  it("never shows a review inside a frame", () => {
    window.history.replaceState(null, "", `/home#mcpApproval=${ID}`);
    vi.stubGlobal("top", {});

    renderGate();

    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
