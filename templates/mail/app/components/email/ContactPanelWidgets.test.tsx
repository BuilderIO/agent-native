// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copy: {
    "mail.contactPanel.notes": "Notes",
    "mail.contactPanel.attachments": "Attachments",
    "mail.contactPanel.addNote": "Add a note",
    "mail.contactPanel.notesLoadError": "Couldn't load notes.",
    "mail.contactPanel.noteSaveError": "Couldn't save the note.",
    "mail.contactPanel.olderNotesInContent":
      "Older notes are on the page in Content.",
    "mail.contactPanel.attachmentsLoadError": "Couldn't load files.",
    "mail.contactPanel.noAttachments": "No files yet",
    "mail.contactPanel.openInContent": "Open in Content",
    "mail.contactPanel.meetings": "Meetings",
    "mail.contactPanel.meetingsUpcoming": "Upcoming",
    "mail.contactPanel.meetingsPast": "Past",
    "mail.contactPanel.noMeetings": "No meetings",
    "mail.contactPanel.meetingsLoadError": "Couldn't load meetings.",
    "mail.contactPanel.meetingsCalendarUnreachable": "Couldn't reach Calendar.",
    "mail.contactPanel.meetingsPartial": "Some calendars couldn't be read.",
    "mail.contactPanel.noCalendar": "No calendar connected",
    "mail.contactPanel.setUpCalendar": "Set up Calendar",
    "mail.contactPanel.openInCalendar": "Open in Calendar",
    "mail.contactPanel.untitledMeeting": "(No title)",
    "mail.error.tryAgain": "Try again",
    "mail.error.retrying": "Retrying...",
  } as Record<string, string>,
  navigate: vi.fn(),
  attachments: {} as Record<string, unknown>,
  meetings: {} as Record<string, unknown>,
  note: {} as Record<string, unknown>,
  addNote: { mutate: vi.fn() },
  reportWriteFailure: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    key === "mail.contactPanel.moreAttachments"
      ? `${params?.count} more`
      : (mocks.copy[key] ?? key),
  useFormatters: () => ({
    formatDate: (value: string | Date) =>
      new Date(value).toISOString().slice(0, 10),
  }),
}));

vi.mock("@agent-native/core/client/write-failure", () => ({
  reportWriteFailure: mocks.reportWriteFailure,
}));

vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
  useParams: () => ({ view: "inbox" }),
}));

vi.mock("sonner", () => ({ toast: vi.fn() }));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-contact-panel", () => ({
  useContactAttachments: () => mocks.attachments,
  useContactMeetings: () => mocks.meetings,
  useContactNote: () => mocks.note,
  useAddContactNote: () => mocks.addNote,
}));

import {
  AttachmentsWidget,
  MeetingsWidget,
  NotesWidget,
} from "./ContactPanelWidgets";

function file(index: number) {
  return {
    id: `att-${index}`,
    filename: `file-${index}.pdf`,
    mimeType: "application/pdf",
    size: 1000,
    emailId: `email-${index}`,
    threadId: `thread-${index}`,
    subject: `Subject ${index}`,
    date: `2026-11-${String(25 - index).padStart(2, "0")}T10:00:00Z`,
    accountEmail: "inbox@example.com",
  };
}

beforeEach(() => {
  mocks.attachments = {
    data: { attachments: [1, 2, 3, 4, 5].map(file) },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  mocks.note = {
    data: { note: null },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttachmentsWidget", () => {
  it("shows the newest files first and opens the email a file came in", () => {
    render(<AttachmentsWidget email="priya@northwind.example" />);

    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names.slice(0, 4)).toEqual([
      "file-1.pdf2026-11-24",
      "file-2.pdf2026-11-23",
      "file-3.pdf2026-11-22",
      "file-4.pdf2026-11-21",
    ]);
    expect(screen.queryByText("file-5.pdf")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /file-2\.pdf/ }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/inbox/thread-2?accountEmail=inbox%40example.com",
    );

    fireEvent.click(screen.getByRole("button", { name: "1 more" }));
    expect(screen.getByText("file-5.pdf")).not.toBeNull();
  });

  it("says files couldn't load instead of showing none", () => {
    const refetch = vi.fn();
    mocks.attachments = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    };

    render(<AttachmentsWidget email="priya@northwind.example" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load files.",
    );
    expect(screen.queryByText("No files yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe("NotesWidget", () => {
  it("shows each dated line with its email link and no raw markdown", () => {
    mocks.note = {
      ...mocks.note,
      data: {
        note: {
          markdown:
            "- **Nov 24** Prefers Tuesday calls [Pilot plan](/inbox/thread-9)\n- **Nov 25** Wants SSO before the pilot",
          truncated: false,
          url: "https://content.example/page/note-1",
        },
      },
    };

    render(<NotesWidget email="priya@northwind.example" name="Priya" />);

    expect(
      screen.queryByText("Older notes are on the page in Content."),
    ).toBeNull();
    expect(screen.getByText("Prefers Tuesday calls")).not.toBeNull();
    expect(screen.getByText("Nov 24")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Pilot plan" }).getAttribute("href"),
    ).toBe("/inbox/thread-9");
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open in Content" }),
    ).not.toBeNull();
  });

  it("says when only the newest lines of a long page are shown", () => {
    mocks.note = {
      ...mocks.note,
      data: {
        note: {
          markdown: "- **Nov 25** Wants SSO before the pilot",
          truncated: true,
          url: "https://content.example/page/note-1",
        },
      },
    };

    render(<NotesWidget email="priya@northwind.example" name="Priya" />);

    expect(
      screen.getByText("Older notes are on the page in Content."),
    ).not.toBeNull();
    expect(screen.getByText("Wants SSO before the pilot")).not.toBeNull();
  });

  it("saves a note on Enter with the open email and clears the field", () => {
    render(
      <NotesWidget
        email="priya@northwind.example"
        name="Priya"
        threadId="thread-1"
        subject="Pilot plan"
      />,
    );
    const input = screen.getByRole("textbox", { name: "Add a note" });

    fireEvent.change(input, { target: { value: "  Wants SSO first  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.addNote.mutate).toHaveBeenCalledWith(
      {
        text: "Wants SSO first",
        name: "Priya",
        threadId: "thread-1",
        subject: "Pilot plan",
      },
      expect.any(Object),
    );
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Wants SSO first")).not.toBeNull();
  });

  it("puts the text back and reports the failure when a save fails", () => {
    mocks.addNote.mutate.mockImplementationOnce(
      (
        _args,
        options: { onError: (error: Error) => void; onSettled: () => void },
      ) => {
        options.onError(new Error("Content is unreachable"));
        options.onSettled();
      },
    );
    render(<NotesWidget email="priya@northwind.example" name="Priya" />);
    const input = screen.getByRole("textbox", { name: "Add a note" });

    fireEvent.change(input, { target: { value: "Wants SSO first" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect((input as HTMLInputElement).value).toBe("Wants SSO first");
    expect(mocks.reportWriteFailure).toHaveBeenCalledWith(expect.any(Error), {
      label: "Couldn't save the note.",
    });
  });

  it("says notes couldn't load instead of offering an empty note", () => {
    mocks.note = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(<NotesWidget email="priya@northwind.example" name="Priya" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load notes.",
    );
    expect(screen.queryByRole("textbox", { name: "Add a note" })).toBeNull();
  });
});

const CALENDAR = "https://calendar.agent-native.com";

function meetingsQuery(data: Record<string, unknown>) {
  return {
    data: {
      source: "calendar",
      calendar: "connected",
      calendarUrl: CALENDAR,
      upcoming: [],
      recent: [],
      failedAccounts: [],
      ...data,
    },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

describe("MeetingsWidget", () => {
  it("lists upcoming and past meetings that open in Calendar", () => {
    mocks.meetings = meetingsQuery({
      upcoming: [
        {
          id: "next",
          title: "Pricing review",
          start: "2026-11-27T15:00:00Z",
          end: "2026-11-27T15:30:00Z",
          allDay: false,
          url: `${CALENDAR}/_agent-native/open?app=calendar&eventId=next`,
        },
      ],
      recent: [
        {
          id: "past",
          title: "",
          start: "2026-11-20",
          end: "2026-11-21",
          allDay: true,
          url: `${CALENDAR}/_agent-native/open?app=calendar&eventId=past`,
        },
      ],
    });

    render(<MeetingsWidget email="priya@northwind.example" />);

    expect(screen.getByText("Upcoming")).not.toBeNull();
    expect(screen.getByText("Past")).not.toBeNull();
    const next = screen.getByRole("link", { name: /Pricing review/ });
    expect(next.getAttribute("href")).toContain("eventId=next");
    expect(next.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: /\(No title\)/ })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Open in Calendar" }),
    ).not.toBeNull();
    expect(screen.queryByText("Set up Calendar")).toBeNull();
  });

  it("suggests Calendar when Mail read the meetings itself", () => {
    mocks.meetings = meetingsQuery({
      source: "mail",
      calendar: "not_connected",
      upcoming: [
        {
          id: "next",
          title: "Pricing review",
          start: "2026-11-27T15:00:00Z",
          end: "2026-11-27T15:30:00Z",
          allDay: false,
          url: "https://www.google.com/calendar/event?eid=next",
        },
      ],
    });

    render(<MeetingsWidget email="priya@northwind.example" />);

    expect(
      screen
        .getByRole("link", { name: "Set up Calendar" })
        .getAttribute("href"),
    ).toBe(CALENDAR);
    expect(
      screen.queryByRole("button", { name: "Open in Calendar" }),
    ).toBeNull();
  });

  it("doesn't suggest Calendar when it was only unreachable", () => {
    mocks.meetings = meetingsQuery({ source: "mail", calendar: "unavailable" });

    render(<MeetingsWidget email="priya@northwind.example" />);

    expect(screen.getByText("No meetings")).not.toBeNull();
    expect(screen.queryByText("Set up Calendar")).toBeNull();
  });

  it("tells no calendar, an unreachable one and unread accounts apart from no meetings", () => {
    mocks.meetings = meetingsQuery({
      source: "none",
      calendar: "not_connected",
    });
    render(<MeetingsWidget email="priya@northwind.example" />);
    expect(screen.getByText("No calendar connected")).not.toBeNull();
    expect(screen.queryByText("No meetings")).toBeNull();
    cleanup();

    const query = meetingsQuery({ source: "none", calendar: "unavailable" });
    mocks.meetings = query;
    render(<MeetingsWidget email="priya@northwind.example" />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't reach Calendar.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(query.refetch).toHaveBeenCalledOnce();
    cleanup();

    mocks.meetings = meetingsQuery({
      failedAccounts: [{ accountEmail: "work@example.com", message: "denied" }],
    });
    render(<MeetingsWidget email="priya@northwind.example" />);
    expect(screen.getByText("Some calendars couldn't be read.")).not.toBeNull();
    expect(screen.queryByText("No meetings")).toBeNull();
  });

  it("says meetings couldn't load instead of showing none", () => {
    mocks.meetings = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(<MeetingsWidget email="priya@northwind.example" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load meetings.",
    );
    expect(screen.queryByText("No meetings")).toBeNull();
  });
});
