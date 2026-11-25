export const CHATGPT_DIRECTORY_TOOL_NAMES = [
  "list-events",
  "search-events",
  "get-event",
  "check-availability",
  "find-a-time",
  "search-people",
  "create-event",
  "update-event",
  "list-booking-links",
  "list-bookings",
];

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  widgets: false,
  widgetDomain: "https://calendar.agent-native.com",
  widgetTargets: {},
  keyToolNames: ["list-events", "find-a-time", "create-event", "update-event"],
  instructions:
    "Agent-Native Calendar reads and plans the user's connected Google calendars and booking links. Inviting guests to an event asks the user to approve it in Calendar first. Deleting events, cancelling bookings, changing availability and creating or editing booking links are outside this plugin's capabilities.",
  toolDescriptions: {
    "search-events":
      "Searches the user's calendar events by title, attendees, organizer, location, or description inside an explicit date range.",
  },
  toolParameterDescriptions: {
    "get-event": {
      calendarSourceKey:
        "The calendarSourceKey list-events returned with an event on a shared calendar.",
    },
  },
  hiddenToolParameters: {
    "list-events": ["calendarSourceKeys"],
  },
};
