import type { BenchmarkCase } from "./tool-search-benchmark.harness.js";

/**
 * Plain user requests, as typed, with the tools that serve them. Cases marked
 * `heldOut` were written with the rest, before ranking was tuned, and are
 * never used to tune it: when one fails, fix the ranking or the action's own
 * description in a way that would help unseen requests too, and never add the
 * held-out wording to `searchHints`.
 */
export const TOOL_SEARCH_BENCHMARK_CASES: readonly BenchmarkCase[] = [
  // Mail
  {
    template: "mail",
    prompt: "can you view and edit my auto archive rules?",
    expected: [["manage-email-rules", "manage-gmail-filters"]],
  },
  {
    template: "mail",
    prompt: "send this later, tomorrow at 9am",
    expected: [["create-scheduled-send"]],
  },
  {
    template: "mail",
    prompt: "snooze this thread until monday",
    expected: [["create-scheduled-job"]],
  },
  {
    template: "mail",
    prompt: "what emails did I get from Sarah last week",
    expected: [["search-emails", "list-emails"]],
  },
  {
    template: "mail",
    prompt: "put this in my receipts folder",
    expected: [["move-email"]],
  },
  {
    template: "mail",
    prompt: "change my email signature",
    expected: [["update-mail-settings", "import-gmail-signature"]],
    heldOut: true,
  },
  {
    template: "mail",
    prompt: "did they open the email I sent?",
    expected: [["get-tracking"]],
    heldOut: true,
  },
  {
    template: "mail",
    prompt: "save a canned reply I can reuse for intro requests",
    expected: [["manage-snippets"]],
  },
  {
    template: "mail",
    prompt: "restore the messages I deleted by accident",
    expected: [["untrash-email"]],
    heldOut: true,
  },
  {
    template: "mail",
    prompt: "mark everything as read",
    expected: [["mark-read"]],
  },
  {
    template: "mail",
    prompt: "write a reply to this email",
    expected: [["manage-draft"]],
  },
  {
    template: "mail",
    prompt: "cancel the email I scheduled for friday",
    expected: [["list-scheduled-jobs"], ["cancel-scheduled-email"]],
  },
  {
    template: "mail",
    prompt: "look up the deal for this sender in hubspot",
    expected: [["get-hubspot-contact"]],
  },
  {
    template: "mail",
    prompt: "accept the meeting invite in this email",
    expected: [["respond-calendar-invite"]],
    heldOut: true,
  },
  {
    template: "mail",
    prompt: "stop hiding emails from my boss, keep them in the inbox",
    expected: [["apply-ai-filter"]],
  },

  // Calendar
  {
    template: "calendar",
    prompt: "move my 3pm meeting to thursday",
    expected: [["update-event"]],
  },
  {
    template: "calendar",
    prompt: "when am I free next week to meet with alex",
    expected: [["find-a-time", "check-availability"]],
  },
  {
    template: "calendar",
    prompt: "clear my calendar on saturday",
    expected: [["delete-events"]],
    heldOut: true,
  },
  {
    template: "calendar",
    prompt:
      "set up a booking page people can use to schedule 30 min calls with me",
    expected: [["create-booking-link"]],
  },
  {
    template: "calendar",
    prompt: "change my working hours to 10 to 6",
    expected: [["update-availability"]],
  },
  {
    template: "calendar",
    prompt: "decline the offsite invite",
    expected: [["rsvp-event", "respond-to-event"]],
  },
  {
    template: "calendar",
    prompt: "subscribe to the holidays ics feed",
    expected: [["add-external-calendar"]],
  },
  {
    template: "calendar",
    prompt: "show me Maria's calendar next to mine",
    expected: [["add-overlay-person"]],
    heldOut: true,
  },
  {
    template: "calendar",
    prompt: "what's on my schedule tomorrow",
    expected: [["list-events"]],
  },
  {
    template: "calendar",
    prompt: "cancel the booking someone made for friday",
    expected: [["list-bookings"], ["cancel-booking"]],
  },
  {
    template: "calendar",
    prompt: "what timezone is my guest in",
    expected: [["get-attendee-timezones", "set-attendee-timezone"]],
    heldOut: true,
  },
  {
    template: "calendar",
    prompt: "push all my afternoon meetings back by an hour",
    expected: [["update-events"]],
    heldOut: true,
  },
  {
    template: "calendar",
    prompt: "draft an invite for lunch with the team",
    expected: [["manage-event-draft", "create-event"]],
  },

  // Content
  {
    template: "content",
    prompt: "make a new page for meeting notes",
    expected: [["create-document"]],
  },
  {
    template: "content",
    prompt: "fix the typo in the second paragraph",
    expected: [["edit-document"]],
  },
  {
    template: "content",
    prompt: "find my doc about onboarding",
    expected: [["search-documents"]],
  },
  {
    template: "content",
    prompt: "bring back the page I deleted yesterday",
    expected: [["restore-document", "list-trashed-documents"]],
    heldOut: true,
  },
  {
    template: "content",
    prompt: "add a status column to this table",
    expected: [["configure-document-property"]],
  },
  {
    template: "content",
    prompt: "add a row to the roadmap database",
    expected: [["add-database-item"]],
  },
  {
    template: "content",
    prompt: "leave a comment on this paragraph",
    expected: [["add-comment"]],
  },
  {
    template: "content",
    prompt: "revert this page to how it looked last week",
    expected: [
      [
        "restore-document-version",
        "list-document-versions",
        "list-document-history",
      ],
    ],
  },
  {
    template: "content",
    prompt: "sync this page with notion",
    expected: [["push-notion-page", "link-notion-page", "pull-notion-page"]],
  },
  {
    template: "content",
    prompt: "download this page as markdown",
    expected: [["export-document"]],
    heldOut: true,
  },
  {
    template: "content",
    prompt: "suggest edits to this doc without changing it directly",
    expected: [["suggest-document-edit"]],
  },
  {
    template: "content",
    prompt: "transcribe the video in this page",
    expected: [["transcribe-media"]],
  },
  {
    template: "content",
    prompt: "nest this page under the engineering page",
    expected: [["move-document"]],
    heldOut: true,
  },

  // Slides
  {
    template: "slides",
    prompt: "add a slide about pricing",
    expected: [["add-slide"]],
  },
  {
    template: "slides",
    prompt: "make a new deck for the quarterly review",
    expected: [["create-deck", "create-deck-from-template"]],
  },
  {
    template: "slides",
    prompt: "export this to powerpoint",
    expected: [["export-pptx"]],
  },
  {
    template: "slides",
    prompt: "change the title on slide 3",
    expected: [["update-slide"]],
  },
  {
    template: "slides",
    prompt: "make a copy of this presentation",
    expected: [["duplicate-deck"]],
    heldOut: true,
  },
  {
    template: "slides",
    prompt: "use our brand colors and fonts",
    expected: [["apply-design-system", "create-design-system"]],
  },
  {
    template: "slides",
    prompt: "find a logo for acme",
    expected: [["search-logos"]],
  },
  {
    template: "slides",
    prompt: "go back to the earlier version of the deck",
    expected: [["restore-deck-version", "list-deck-versions"]],
  },
  {
    template: "slides",
    prompt: "turn this powerpoint into a deck",
    expected: [["import-pptx", "import-file"]],
  },
  {
    template: "slides",
    prompt: "check that the text is readable on the background",
    expected: [["audit-contrast"]],
  },
  {
    template: "slides",
    prompt: "make it widescreen 16:9",
    expected: [["update-deck-aspect-ratio"]],
    heldOut: true,
  },
  {
    template: "slides",
    prompt: "stop the share link from working",
    expected: [["revoke-deck-share-link"]],
    heldOut: true,
  },
  {
    template: "slides",
    prompt: "make me an image of a mountain for the title slide",
    expected: [["generate-image-api"]],
  },

  // Analytics
  {
    template: "analytics",
    prompt: "email me this dashboard every morning",
    expected: [["save-dashboard-report-subscription"]],
  },
  {
    template: "analytics",
    prompt: "alert me if the website goes down",
    expected: [["save-monitor"]],
    heldOut: true,
  },
  {
    template: "analytics",
    prompt: "what errors are users hitting in production",
    expected: [["list-error-issues", "sentry"]],
  },
  {
    template: "analytics",
    prompt: "mark the launch date on the charts",
    expected: [["save-key-date"]],
  },
  {
    template: "analytics",
    prompt: "add a chart to this dashboard",
    expected: [["mutate-dashboard", "update-dashboard"]],
  },
  {
    template: "analytics",
    prompt: "undo the last change to this dashboard",
    expected: [["restore-dashboard-revision", "list-dashboard-revisions"]],
  },
  {
    template: "analytics",
    prompt: "how much did we refund customers this month",
    expected: [["stripe"]],
    heldOut: true,
  },
  {
    template: "analytics",
    prompt: "watch a recording of a user session",
    expected: [
      [
        "list-session-recordings",
        "get-session-replay-summary",
        "get-session-replay-timeline",
      ],
    ],
  },
  {
    template: "analytics",
    prompt: "what's our win rate this quarter",
    expected: [["hubspot-metrics"]],
  },
  {
    template: "analytics",
    prompt: "how much will this query cost to run",
    expected: [["estimate-query-cost"]],
  },
  {
    template: "analytics",
    prompt: "put this dashboard in the marketing folder",
    expected: [["set-dashboard-folder"]],
    heldOut: true,
  },
  {
    template: "analytics",
    prompt: "make a public status page for our services",
    expected: [["save-status-page"]],
  },

  // Inflected verbs from review: each needs its form to meet the base verb.
  {
    template: "slides",
    prompt: "this deck needs to be copied",
    expected: [["duplicate-deck"]],
  },
  {
    template: "content",
    prompt: "show me when this page was last modified",
    expected: [
      [
        "get-document-activity",
        "list-document-history",
        "list-document-versions",
      ],
    ],
  },
  {
    template: "mail",
    prompt: "the email I scheduled should be cancelled",
    expected: [["cancel-scheduled-email"]],
  },
  {
    template: "analytics",
    prompt: "which dashboards is the team using",
    expected: [["list-dashboard-usage-stats"]],
  },
];
