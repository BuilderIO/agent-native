import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lab, mockMeeting, mockPastMeetings, mockSearchParams } = vi.hoisted(
  () => ({
    lab: {
      isLoading: false,
      isError: false,
      isSuccess: true,
      enabled: false,
      refetch: vi.fn(),
    },
    mockMeeting: {
      id: "mtg_past_1",
      title: "Q3 Launch Retro",
      scheduledStart: "2026-11-17T20:00:00Z",
      scheduledEnd: "2026-11-17T20:30:00Z",
      actualStart: "2026-11-17T20:00:00Z",
      actualEnd: "2026-11-17T20:30:00Z",
      platform: "adhoc",
      recordingId: null,
      transcriptStatus: "idle" as const,
      summaryMd: "",
      bulletsJson: "[]",
      actionItemsJson: "[]",
      userNotesMd: "Reviewed onboarding and pricing.",
      shareTranscript: true,
    },
    mockPastMeetings: [
      {
        id: "mtg_past_1",
        title: "Q3 Launch Retro",
        scheduledStart: "2026-11-17T20:00:00Z",
        scheduledEnd: "2026-11-17T20:30:00Z",
        actualStart: "2026-11-17T20:00:00Z",
        actualEnd: "2026-11-17T20:30:00Z",
        platform: "adhoc",
        recordingId: null,
        transcriptStatus: "idle" as const,
      },
    ],
    mockSearchParams: new URLSearchParams("tab=past"),
  }),
);

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (p: string) => p,
  agentNativePath: (p: string) => p,
}));
vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => lab,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/write-failure", () => ({
  reportWriteFailure: vi.fn(),
}));
vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (err: unknown) => String(err),
  callAction: vi.fn(),
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: (name: string) => {
    if (name === "get-meeting") {
      return {
        data: {
          meeting: mockMeeting,
          participants: [],
          actionItems: [],
          transcript: null,
          recording: null,
          role: "owner",
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    }
    if (name === "list-calendar-accounts") {
      return { data: { accounts: [] }, isLoading: false, isError: false };
    }
    if (name === "list-meetings") {
      return {
        data: { meetings: [], calendarErrors: [] },
        isLoading: false,
        isError: false,
      };
    }
    return { data: undefined, isLoading: false, isError: false };
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useInfiniteQuery: () => ({
    data: { pages: [{ meetings: mockPastMeetings, hasMore: false }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect:{to}</div>,
  NavLink: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ meetingId: mockMeeting.id }),
  useSearchParams: () => [mockSearchParams, vi.fn()],
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/clips-avatar", () => ({
  ClipsAvatar: () => <div />,
}));
vi.mock("@/components/library/empty-state", () => ({
  AppEmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/library/page-header", () => ({
  PageBreadcrumb: ({ items }: { items: Array<{ label: string }> }) => (
    <div>{items.map((i) => i.label).join("/")}</div>
  ),
  PageHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}));
vi.mock("@/components/meetings/agenda-card", () => ({
  AgendaCard: () => <div>agenda-card</div>,
  AgendaCardSkeleton: () => <div>agenda-skeleton</div>,
}));
vi.mock("@/components/meetings/attendee-stack", () => ({
  AttendeeStack: () => <div />,
  attendeeInitials: () => "QA",
}));
vi.mock("@/components/meetings/bullet-link", () => ({
  BulletLink: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("@/components/meetings/canvas-editor", () => ({
  CanvasEditor: ({ userNotesMd }: { userNotesMd?: string }) => (
    <div data-testid="canvas-editor">{userNotesMd}</div>
  ),
}));
vi.mock("@/components/meetings/day-grouped-card", () => ({
  DayGroupedCard: ({
    groups,
    renderRow,
  }: {
    groups: Array<{ key: string; items: Array<{ id: string }> }>;
    renderRow: (item: { id: string }) => React.ReactNode;
  }) => (
    <section>
      {groups.map((g) => (
        <div key={g.key}>{g.items.map((item) => renderRow(item))}</div>
      ))}
    </section>
  ),
  groupByCalendarDay: (items: Array<{ id: string }>) => [
    { key: "day-1", items },
  ],
}));
vi.mock("@/components/meetings/earlier-audio-notice", () => ({
  EarlierAudioNotice: () => null,
  useDeferredNotesWait: () => ({
    generatingNotes: false,
    waitForRunningNotes: vi.fn(),
  }),
  withEarlierAudioRemoved: (x: unknown) => x,
}));
vi.mock("@/components/meetings/meeting-history-row", () => ({
  MeetingHistoryRow: ({
    meeting,
  }: {
    meeting: { id: string; title: string };
  }) => <div data-meeting-id={meeting.id}>{meeting.title}</div>,
  MeetingHistoryRowSkeleton: () => <div>history-skeleton</div>,
}));
vi.mock("@/components/meetings/quick-ask-sidebar", () => ({
  QuickAskSidebar: () => null,
}));
vi.mock("@/components/meetings/share-meeting-dialog", () => ({
  ShareMeetingPopover: () => null,
}));
vi.mock("@/components/meetings/transcript-bubbles", () => ({
  TranscriptBubbles: () => <div>transcript</div>,
}));
vi.mock("@/components/player/clips-share-trigger", () => ({
  ClipsShareTrigger: () => null,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@/components/ui/kbd", () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div />,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import MeetingDetailRoute from "./_app.meetings.$meetingId";
import MeetingsIndexRoute from "./_app.meetings._index";

describe("Clips meetings routes", () => {
  beforeEach(() => {
    lab.isLoading = false;
    lab.isError = false;
    lab.isSuccess = true;
    lab.enabled = false;
  });

  it("renders a meeting detail page instead of redirecting to /library when clips.meetings lab is off", () => {
    const html = renderToStaticMarkup(<MeetingDetailRoute />);
    expect(html).not.toContain("redirect:/library");
    expect(html).toContain("Q3 Launch Retro");
    expect(html).toContain("Reviewed onboarding and pricing.");
  });

  it("renders the past meetings list instead of redirecting to /library when clips.meetings lab is off", () => {
    const html = renderToStaticMarkup(<MeetingsIndexRoute />);
    expect(html).not.toContain("redirect:/library");
    expect(html).toContain("Q3 Launch Retro");
  });
});
