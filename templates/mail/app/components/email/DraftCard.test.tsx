// @vitest-environment happy-dom

import {
  SAVE_CONFLICT_ERROR_CODE,
  saveRevisionOf,
} from "@agent-native/core/save-conflict";
import type { ComposeState, DraftCardData, EmailMessage } from "@shared/types";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());
const mockUpdateModelContext = vi.hoisted(() => vi.fn());
const mockOpenHostLink = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({ error: vi.fn() }));
const composeProps = vi.hoisted(() => ({
  current: null as null | {
    activeDraft: ComposeState | null;
    activeId: string | null;
    onUpdate: (id: string, partial: Partial<ComposeState>) => void;
    onSendInMail: () => void;
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mockCallAction,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  mcpAppLinkUrl: (path: string) => new URL(path, "https://mail.test").href,
  openMcpAppHostLink: mockOpenHostLink,
  updateMcpAppModelContext: mockUpdateModelContext,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));
vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("./ComposeModal", async () => {
  const { useAccountFilter } = await vi.importActual<
    typeof import("@/hooks/use-account-filter")
  >("@/hooks/use-account-filter");
  return {
    ComposeModal: (props: NonNullable<typeof composeProps.current>) => {
      composeProps.current = props;
      const { allAccounts } = useAccountFilter();
      return (
        <div
          data-testid="composer"
          data-accounts={allAccounts.map((account) => account.email).join(",")}
        />
      );
    },
  };
});
vi.mock("./EmailThread", () => ({
  ExpandedMessageCard: forwardRef<
    HTMLDivElement,
    {
      email: EmailMessage;
      onCollapse: () => void;
      attachmentNamesOnly?: boolean;
    }
  >(({ email, onCollapse, attachmentNamesOnly }, ref) => (
    <div
      ref={ref}
      data-message={email.id}
      data-expanded="true"
      data-attachment-names-only={attachmentNamesOnly}
    >
      <button type="button" onClick={onCollapse}>
        collapse {email.id}
      </button>
    </div>
  )),
  CollapsedMessageRow: forwardRef<
    HTMLDivElement,
    { email: EmailMessage; onClick: () => void }
  >(({ email, onClick }, ref) => (
    <div ref={ref} data-message={email.id} data-expanded="false">
      <button type="button" onClick={onClick}>
        expand {email.id}
      </button>
    </div>
  )),
}));

import DraftCardRoute from "@/routes/draft";

import { DraftCard } from "./DraftCard";

const newDraft: ComposeState = {
  id: "new-draft",
  to: "sam@example.com",
  subject: "Lunch",
  body: "Free Friday?",
  mode: "compose",
};
const replyDraft: ComposeState = {
  id: "reply-draft",
  to: "sam@example.com",
  subject: "Re: Launch plan",
  body: "Sounds good.",
  mode: "reply",
  replyToId: "message-6",
  replyToThreadId: "thread-1",
  accountEmail: "agent@example.com",
};

function message(id: string) {
  return {
    id,
    threadId: "thread-1",
    subject: "Launch plan",
  } as unknown as EmailMessage;
}

function cardData(
  draft: ComposeState,
  extra: Partial<Extract<DraftCardData, { accounts: unknown }>> = {},
): DraftCardData {
  return {
    draft,
    revision: saveRevisionOf(draft),
    accounts: [{ email: "agent@example.com" }],
    thread: { messages: [], status: "none" },
    settings: { signature: "Sam" },
    deepLink: "/_agent-native/open?app=mail&composeDraftId=" + draft.id,
    ...extra,
  };
}

// Answers the card's read with `read`, and a save with the draft it would store.
function serveCard(read: () => DraftCardData | Promise<DraftCardData>) {
  mockCallAction.mockImplementation(
    async (name: string, params: Record<string, unknown>) => {
      if (name === "get-draft-card") return read();
      const current = await read();
      const {
        action: _action,
        id: _id,
        expectedRevision: _revision,
        ...edits
      } = params;
      const draft = { ...current.draft, ...edits };
      return { draft, revision: saveRevisionOf(draft) };
    },
  );
}

// Holds a draft and refuses a stale save, as manage-draft does.
function serveStoredDraft(initial: ComposeState) {
  const server = { draft: initial };
  mockCallAction.mockImplementation(
    async (name: string, params: Record<string, unknown>) => {
      if (name === "get-draft-card") return cardData(server.draft);
      const { action: _action, id: _id, expectedRevision, ...edits } = params;
      const currentRevision = saveRevisionOf(server.draft);
      if (expectedRevision !== currentRevision) {
        throw Object.assign(new Error("Changed since it was read."), {
          errorCode: SAVE_CONFLICT_ERROR_CODE,
          details: { current: server.draft, currentRevision },
        });
      }
      server.draft = { ...server.draft, ...edits };
      return { draft: server.draft, revision: saveRevisionOf(server.draft) };
    },
  );
  return server;
}

function saves() {
  return mockCallAction.mock.calls.filter(([name]) => name === "manage-draft");
}

function reads() {
  return mockCallAction.mock.calls.filter(
    ([name]) => name === "get-draft-card",
  );
}

function renderCard(draftId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DraftCard draftId={draftId} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function composer() {
  const props = composeProps.current;
  if (!props) throw new Error("The composer hasn't rendered.");
  return props;
}

function shownMessages(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-message]")).map(
    (node) =>
      `${node.getAttribute("data-message")}:${node.getAttribute("data-expanded")}`,
  );
}

describe("DraftCard", () => {
  beforeEach(() => {
    mockCallAction.mockReset();
    mockToast.error.mockReset();
    mockUpdateModelContext.mockReset();
    mockOpenHostLink.mockReset();
    mockOpenHostLink.mockReturnValue(Promise.resolve(true));
    composeProps.current = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("says when the draft is gone", async () => {
    serveCard(() => ({ draft: null }));
    const { findByText, queryByTestId } = renderCard("gone");

    // oracle-change: sending, scheduling and deleting moved from the card to Mail, and their checks went with them
    expect(await findByText("mail.draftCard.notFoundTitle")).toBeTruthy();
    expect(queryByTestId("composer")).toBeNull();
  });

  it("says a card opened without a draft ID has no draft, without asking", () => {
    const { getByText } = renderCard("");

    expect(getByText("mail.draftCard.notFoundTitle")).toBeTruthy();
    expect(mockCallAction).not.toHaveBeenCalled();
  });

  it("offers a retry when the draft fails to load", async () => {
    let fail = true;
    mockCallAction.mockImplementation(async () => {
      if (fail) throw new Error("offline");
      return cardData(newDraft);
    });
    const { findByRole, findByTestId } = renderCard(newDraft.id);

    const retry = await findByRole("button", { name: "mail.error.tryAgain" });
    fail = false;
    fireEvent.click(retry);

    expect(await findByTestId("composer")).toBeTruthy();
  });

  it("asks only for its own draft, and only once", async () => {
    serveCard(() => cardData(newDraft));
    const { findByTestId } = renderCard(newDraft.id);

    await findByTestId("composer");
    expect(mockCallAction.mock.calls).toEqual([
      ["get-draft-card", { id: newDraft.id }, { method: "GET" }],
    ]);
  });

  it("keeps the routes its session can't reach from being asked for", async () => {
    serveCard(() => cardData(newDraft));
    const { findByTestId, queryClient } = renderCard(newDraft.id);

    await findByTestId("composer");
    for (const key of [["settings"], ["aliases"], ["contacts"], ["snippets"]]) {
      expect(queryClient.getQueryDefaults(key).enabled).toBe(false);
    }
    expect(queryClient.getQueryData(["settings"])).toEqual({
      signature: "Sam",
    });
  });

  it("starts over when the route moves to another draft", async () => {
    const drafts = new Map([newDraft, replyDraft].map((d) => [d.id, d]));
    mockCallAction.mockImplementation(
      async (name: string, params: Record<string, unknown>) => {
        const { action: _action, id, expectedRevision: _r, ...edits } = params;
        const draft = drafts.get(id as string);
        if (!draft) throw new Error(`No draft ${String(id)}`);
        if (name === "get-draft-card") return cardData(draft);
        return { draft: { ...draft, ...edits }, revision: "saved" };
      },
    );
    const router = createMemoryRouter(
      [{ path: "/draft", Component: DraftCardRoute }],
      { initialEntries: [`/draft?id=${newDraft.id}`] },
    );
    const { findByTestId } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await findByTestId("composer");
    act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));

    await act(() => router.navigate(`/draft?id=${replyDraft.id}`));

    await waitFor(() => expect(composer().activeId).toBe(replyDraft.id));
    // The unsaved edit saves to its own draft and doesn't follow the reader.
    expect(saves()).toEqual([
      [
        "manage-draft",
        {
          action: "update",
          id: newDraft.id,
          expectedRevision: saveRevisionOf(newDraft),
          body: "Free Friday",
        },
      ],
    ]);
    expect(composer().activeDraft?.body).toBe(replyDraft.body);
  });

  it("shows only the draft for a new email", async () => {
    serveCard(() => cardData(newDraft));
    const { container, findByTestId, queryByText } = renderCard(newDraft.id);

    await findByTestId("composer");
    expect(shownMessages(container)).toEqual([]);
    expect(queryByText("mail.draftCard.threadUnavailable")).toBeNull();
    expect(composer().activeDraft).toEqual(newDraft);
  });

  it("offers the composer only the draft's own account", async () => {
    serveCard(() => cardData(newDraft));
    const { findByTestId } = renderCard(newDraft.id);

    expect((await findByTestId("composer")).getAttribute("data-accounts")).toBe(
      "agent@example.com",
    );
  });

  it("folds a long thread and opens only the latest message", async () => {
    const messages = [1, 2, 3, 4, 5, 6].map((n) => message(`message-${n}`));
    serveCard(() =>
      cardData(replyDraft, { thread: { messages, status: "ready" } }),
    );
    const { container, findByText, getByText } = renderCard(replyDraft.id);

    const earlier = await findByText("mail.draftCard.earlierMessages:3");
    expect(shownMessages(container)).toEqual([
      "message-4:false",
      "message-5:false",
      "message-6:true",
    ]);

    fireEvent.click(earlier);
    expect(shownMessages(container)).toHaveLength(6);

    fireEvent.click(getByText("expand message-4"));
    expect(shownMessages(container)).toContain("message-4:true");
  });

  it("lists a message's attachments by name, since it can't fetch them", async () => {
    serveCard(() =>
      cardData(replyDraft, {
        thread: { messages: [message("message-1")], status: "ready" },
      }),
    );
    const { findByTestId, container } = renderCard(replyDraft.id);

    await findByTestId("composer");
    expect(
      container
        .querySelector("[data-message='message-1']")
        ?.getAttribute("data-attachment-names-only"),
    ).toBe("true");
  });

  it("says so when it can't read the conversation, and keeps the draft", async () => {
    serveCard(() =>
      cardData(replyDraft, { thread: { messages: [], status: "unavailable" } }),
    );
    const { findByText, getByTestId } = renderCard(replyDraft.id);

    expect(await findByText("mail.draftCard.threadUnavailable")).toBeTruthy();
    expect(getByTestId("composer")).toBeTruthy();
  });

  describe("editing", () => {
    async function openCard(draft = newDraft) {
      serveCard(() => cardData(draft));
      const view = renderCard(draft.id);
      await view.findByTestId("composer");
      vi.useFakeTimers();
      return view;
    }

    it("shows an edit at once and saves it after a pause in typing", async () => {
      await openCard();

      act(() => composer().onUpdate(newDraft.id, { body: "Free" }));
      expect(composer().activeDraft?.body).toBe("Free");
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(saves()).toEqual([]);

      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(saves()).toEqual([
        [
          "manage-draft",
          {
            action: "update",
            id: newDraft.id,
            expectedRevision: saveRevisionOf(newDraft),
            body: "Free Friday",
          },
        ],
      ]);
      expect(composer().activeDraft?.body).toBe("Free Friday");
    });

    it("sends only the editable fields the reader changed", async () => {
      await openCard();

      act(() =>
        composer().onUpdate(newDraft.id, {
          subject: "Dinner",
          accountEmail: "other@example.com",
          attachments: [],
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(2_000));

      expect(saves()).toEqual([
        [
          "manage-draft",
          {
            action: "update",
            id: newDraft.id,
            expectedRevision: saveRevisionOf(newDraft),
            subject: "Dinner",
          },
        ],
      ]);
    });

    it("doesn't save when nothing editable changed", async () => {
      await openCard();

      act(() =>
        composer().onUpdate(newDraft.id, { accountEmail: "other@example.com" }),
      );
      await act(() => vi.advanceTimersByTimeAsync(2_000));

      expect(saves()).toEqual([]);
    });

    it("keeps what's typed while a save runs", async () => {
      await openCard();
      let finishSave!: (value: {
        draft: ComposeState;
        revision: string;
      }) => void;
      mockCallAction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSave = resolve;
          }),
      );

      act(() => composer().onUpdate(newDraft.id, { body: "First" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      act(() => composer().onUpdate(newDraft.id, { body: "Second" }));
      await act(async () => {
        finishSave({
          draft: { ...newDraft, body: "First" },
          revision: "after-first",
        });
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(composer().activeDraft?.body).toBe("Second");
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      expect(saves().map(([, params]) => params.body)).toEqual([
        "First",
        "Second",
      ]);
      expect(saves()[1]?.[1].expectedRevision).toBe("after-first");
    });

    it("tells the model the draft's new text once it's saved", async () => {
      await openCard();

      act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));
      expect(mockUpdateModelContext).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1_500));

      expect(mockUpdateModelContext).toHaveBeenCalledTimes(1);
      const report = mockUpdateModelContext.mock.lastCall?.[0];
      expect(report.structuredContent).toEqual({
        draftId: newDraft.id,
        status: "edited",
      });
      expect(report.content[0].text).toContain("Free Friday");
      expect(report.content[0].text).toContain(
        saveRevisionOf({ ...newDraft, body: "Free Friday" }),
      );
    });

    it("warns when an edit doesn't save, and keeps it on screen", async () => {
      await openCard();
      mockCallAction.mockRejectedValueOnce(new Error("offline"));

      act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));

      expect(mockToast.error).toHaveBeenCalledWith(
        "mail.toasts.failedToSaveDraft",
      );
      expect(composer().activeDraft?.body).toBe("Free Friday");
      expect(mockUpdateModelContext).not.toHaveBeenCalled();
    });

    it("saves an unsaved edit when the card is hidden", async () => {
      await openCard();

      act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(saves()).toHaveLength(1);
    });
  });

  describe("when someone else saved first", () => {
    const agentSubject = "Agent's subject";

    async function openStoredCard() {
      const server = serveStoredDraft(newDraft);
      const view = renderCard(newDraft.id);
      await view.findByTestId("composer");
      vi.useFakeTimers();
      return { ...view, server };
    }

    function revisions() {
      return saves().map(([, params]) => params.expectedRevision);
    }

    it("saves on the revision it read, then the one each save returns", async () => {
      const { server } = await openStoredCard();

      act(() => composer().onUpdate(newDraft.id, { body: "One" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      const afterFirst = saveRevisionOf(server.draft);
      act(() => composer().onUpdate(newDraft.id, { body: "Two" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));

      expect(revisions()).toEqual([saveRevisionOf(newDraft), afterFirst]);
      expect(server.draft.body).toBe("Two");
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it("merges a change to another field without asking", async () => {
      const { server, queryByText } = await openStoredCard();
      server.draft = { ...server.draft, body: "Agent's body" };
      const agentRevision = saveRevisionOf(server.draft);

      act(() => composer().onUpdate(newDraft.id, { subject: "Mine" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));

      expect(queryByText("saveConflict.title")).toBeNull();
      expect(revisions()).toEqual([saveRevisionOf(newDraft), agentRevision]);
      expect(saves()[1]?.[1]).not.toHaveProperty("body");
      expect(server.draft).toMatchObject({
        subject: "Mine",
        body: "Agent's body",
      });
      expect(composer().activeDraft).toMatchObject({
        subject: "Mine",
        body: "Agent's body",
      });
    });

    it("asks about the same field, even after a read brought in their change", async () => {
      const { server, getByText, queryClient } = await openStoredCard();

      act(() => composer().onUpdate(newDraft.id, { subject: "Mine" }));
      server.draft = { ...server.draft, subject: agentSubject };
      await act(() =>
        queryClient.invalidateQueries({ queryKey: ["draft-card", newDraft.id] }),
      );
      expect(
        queryClient.getQueryData<{ draft: ComposeState }>([
          "draft-card",
          newDraft.id,
        ])?.draft.subject,
      ).toBe(agentSubject);
      expect(composer().activeDraft?.subject).toBe("Mine");
      await act(() => vi.advanceTimersByTimeAsync(1_500));

      expect(server.draft.subject).toBe(agentSubject);
      expect(getByText("saveConflict.title")).toBeTruthy();

      await act(async () => {
        fireEvent.click(getByText("saveConflict.keepMine"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(server.draft.subject).toBe("Mine");
      expect(composer().activeDraft?.subject).toBe("Mine");
    });

    it("writes nothing more when the reader takes the other version", async () => {
      const { server, getByText } = await openStoredCard();
      server.draft = { ...server.draft, subject: agentSubject };

      act(() => composer().onUpdate(newDraft.id, { subject: "Mine" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      await act(async () => {
        fireEvent.click(getByText("saveConflict.useTheirs"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(saves()).toHaveLength(1);
      expect(composer().activeDraft?.subject).toBe(agentSubject);
      act(() => composer().onUpdate(newDraft.id, { body: "Later" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      expect(server.draft).toMatchObject({
        subject: agentSubject,
        body: "Later",
      });
    });

    it("can bring back the version the reader gave up", async () => {
      const { server, getByText } = await openStoredCard();
      server.draft = { ...server.draft, subject: agentSubject };

      act(() => composer().onUpdate(newDraft.id, { subject: "Mine" }));
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      await act(async () => {
        fireEvent.click(getByText("saveConflict.keepMine"));
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        fireEvent.click(getByText("saveConflict.getOtherBack"));
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(server.draft.subject).toBe(agentSubject);
      expect(composer().activeDraft?.subject).toBe(agentSubject);
    });

    it("doesn't open Mail until the reader has chosen", async () => {
      const { server, getByText } = await openStoredCard();
      server.draft = { ...server.draft, subject: agentSubject };

      act(() => composer().onUpdate(newDraft.id, { subject: "Mine" }));
      await act(async () => {
        composer().onSendInMail();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockOpenHostLink).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(getByText("saveConflict.keepMine"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(server.draft.subject).toBe("Mine");
      expect(mockOpenHostLink).toHaveBeenCalledTimes(1);
    });

    it("doesn't store a draft that was sent or deleted during the save", async () => {
      const { getByText } = await openStoredCard();
      let gone = false;
      mockCallAction.mockImplementation(async (name: string) => {
        if (name === "get-draft-card") {
          return gone ? { draft: null } : cardData(newDraft);
        }
        gone = true;
        throw Object.assign(new Error("Changed since it was read."), {
          errorCode: SAVE_CONFLICT_ERROR_CODE,
          details: { current: null, currentRevision: null },
        });
      });

      act(() => composer().onUpdate(newDraft.id, { subject: "Mine" }));
      await act(() => vi.advanceTimersByTimeAsync(2_000));

      expect(getByText("mail.draftCard.goneTitle")).toBeTruthy();
      expect(saves()).toHaveLength(1);
      expect(mockToast.error).toHaveBeenCalledWith(
        "mail.toasts.failedToSaveDraft",
      );
    });
  });

  describe("Send in Mail", () => {
    const deepLink = (draft: ComposeState) =>
      `https://mail.test/_agent-native/open?app=mail&composeDraftId=${draft.id}`;

    it("saves the draft first, then opens it through the host", async () => {
      serveCard(() => cardData(newDraft));
      const { findByTestId } = renderCard(newDraft.id);
      await findByTestId("composer");

      act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));
      act(() => composer().onSendInMail());

      await waitFor(() =>
        expect(mockOpenHostLink).toHaveBeenCalledWith(deepLink(newDraft)),
      );
      expect(saves()).toHaveLength(1);
      expect(mockCallAction.mock.invocationCallOrder[1]).toBeLessThan(
        mockOpenHostLink.mock.invocationCallOrder[0] ?? -1,
      );
    });

    it("waits for text typed while its save ran", async () => {
      serveCard(() => cardData(newDraft));
      const { findByTestId } = renderCard(newDraft.id);
      await findByTestId("composer");
      let finishSave = () => {};
      mockCallAction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSave = () =>
              resolve({
                draft: { ...newDraft, body: "First" },
                revision: "after-first",
              });
          }),
      );

      act(() => composer().onUpdate(newDraft.id, { body: "First" }));
      act(() => composer().onSendInMail());
      await waitFor(() => expect(saves()).toHaveLength(1));
      act(() => composer().onUpdate(newDraft.id, { body: "Second" }));
      await act(async () => finishSave());

      await waitFor(() => expect(mockOpenHostLink).toHaveBeenCalled());
      expect(saves()).toHaveLength(2);
      expect(saves()[1]?.[1]).toMatchObject({ body: "Second" });
    });

    it("stays on the card when the save fails", async () => {
      serveCard(() => cardData(newDraft));
      const { findByTestId } = renderCard(newDraft.id);
      await findByTestId("composer");
      mockCallAction.mockRejectedValueOnce(new Error("offline"));

      act(() => composer().onUpdate(newDraft.id, { body: "Free Friday" }));
      act(() => composer().onSendInMail());

      await waitFor(() =>
        expect(mockToast.error).toHaveBeenCalledWith(
          "mail.toasts.failedToSaveDraft",
        ),
      );
      expect(mockOpenHostLink).not.toHaveBeenCalled();
    });

    it.each([
      ["there's no host", false],
      ["the host refuses", Promise.resolve(false)],
    ])("opens a new tab when %s", async (_name, answer) => {
      mockOpenHostLink.mockReturnValue(answer);
      const tab = { opener: window } as unknown as Window;
      const open = vi.spyOn(window, "open").mockReturnValue(tab);
      serveCard(() => cardData(newDraft));
      const { findByTestId } = renderCard(newDraft.id);
      await findByTestId("composer");

      act(() => composer().onSendInMail());

      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(deepLink(newDraft), "_blank"),
      );
      expect(tab.opener).toBeNull();
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it("offers a click of its own when the browser blocks the tab", async () => {
      mockOpenHostLink.mockReturnValue(false);
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      serveCard(() => cardData(newDraft));
      const { findByTestId } = renderCard(newDraft.id);
      await findByTestId("composer");

      act(() => composer().onSendInMail());

      await waitFor(() =>
        expect(mockToast.error).toHaveBeenCalledWith(
          "mail.draftCard.openBlocked",
          expect.anything(),
        ),
      );
      const options = mockToast.error.mock.lastCall?.[1] as {
        action: { onClick: () => void };
      };
      options.action.onClick();
      expect(open).toHaveBeenLastCalledWith(
        deepLink(newDraft),
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("puts Mail's own queries back when the card goes away", async () => {
    serveCard(() => cardData(newDraft));
    const { findByTestId, queryClient, unmount } = renderCard(newDraft.id);
    await findByTestId("composer");
    expect(queryClient.getQueryDefaults(["settings"]).enabled).toBe(false);
    expect(queryClient.getQueryData(["settings"])).toEqual({
      signature: "Sam",
    });

    unmount();

    expect(queryClient.getQueryDefaults(["settings"]).enabled).toBeUndefined();
    expect(queryClient.getQueryData(["settings"])).toBeUndefined();
  });

  it("says a draft it showed was sent or deleted, and tells the model once", async () => {
    let current: DraftCardData = cardData(newDraft);
    serveCard(() => current);
    const { findByTestId, findByText, queryClient } = renderCard(newDraft.id);
    await findByTestId("composer");
    expect(mockUpdateModelContext).not.toHaveBeenCalled();

    current = { draft: null };
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["draft-card", newDraft.id] }),
    );

    expect(await findByText("mail.draftCard.goneTitle")).toBeTruthy();
    expect(mockUpdateModelContext).toHaveBeenCalledTimes(1);
    expect(mockUpdateModelContext.mock.lastCall?.[0].structuredContent).toEqual(
      {
        draftId: newDraft.id,
        status: "gone",
      },
    );
    expect(reads()).toHaveLength(2);
  });

  it("reads the draft again when the reader comes back after a while", async () => {
    serveCard(() => cardData(newDraft));
    renderCard("new-draft");
    await waitFor(() => expect(composeProps.current).not.toBeNull());
    expect(reads()).toHaveLength(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(reads()).toHaveLength(1);

    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(reads()).toHaveLength(2));
    focusManager.setFocused(undefined);
  });

  it("logs a report the chat couldn't take", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockUpdateModelContext.mockReturnValue(Promise.resolve(false));
    let current: DraftCardData = cardData(newDraft);
    serveCard(() => current);
    const { findByTestId, queryClient } = renderCard(newDraft.id);
    await findByTestId("composer");

    current = { draft: null };
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["draft-card", newDraft.id] }),
    );

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        `The chat didn't take the update for draft ${newDraft.id}.`,
      ),
    );
  });
});
