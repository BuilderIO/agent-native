/**
 * Machine-readable manifest of what this package ships.
 *
 * Consumed by `agent-native add scheduling` (or the template scaffolder) to:
 *   - generate stub action files in the consumer's `actions/` folder
 *   - symlink/copy skill files into the consumer's `.agents/skills/`
 *   - append required secret declarations
 *   - print the list in `agent-native info @agent-native/scheduling`
 */

export interface SchedulingManifest {
  name: string;
  version: string;
  actions: string[];
  schemaEntryPoint: string;
  docs: {
    llms: string;
    llmsFull: string;
    skills: string[];
  };
  requiredSecrets: { key: string; label: string; optional?: boolean }[];
  peerProviders: string[];
}

export const MANIFEST: SchedulingManifest = {
  name: "@agent-native/scheduling",
  version: "0.1.0",
  actions: [
    // Event types
    "list-event-types",
    "get-event-type",
    "create-event-type",
    "update-event-type",
    "duplicate-event-type",
    "delete-event-type",
    "toggle-event-type-hidden",
    "reorder-event-types",
    "set-event-type-location",
    "add-private-link",
    "revoke-private-link",
    // Availability / schedules
    "list-schedules",
    "create-schedule",
    "update-schedule",
    "delete-schedule",
    "set-default-schedule",
    "add-date-override",
    "remove-date-override",
    "get-availability",
    "check-availability",
    "find-available-slot",
    // Bookings
    "list-bookings",
    "get-booking",
    "create-booking",
    "reschedule-booking",
    "cancel-booking",
    "confirm-booking",
    "mark-no-show",
    "add-booking-attendee",
    "remove-booking-attendee",
    "send-reschedule-link",
    "add-booking-note",
    "export-bookings-csv",
    // Integrations
    "list-calendar-integrations",
    "connect-calendar",
    "disconnect-calendar",
    "list-selected-calendars",
    "toggle-selected-calendar",
    "set-destination-calendar",
    "refresh-busy-times",
    "install-conferencing-app",
    // Team
    "create-team",
    "invite-team-member",
    "accept-team-invite",
    "remove-team-member",
    "update-member-role",
    "set-team-branding",
    // Round-robin / hosts
    "assign-round-robin-host",
    "set-event-type-hosts",
    "set-host-availability-override",
    "create-host-group",
    // Settings / profile
    "update-profile",
    "set-appearance",
    "set-default-conferencing-app",
    // Workflows
    "list-workflows",
    "create-workflow",
    "update-workflow",
    "delete-workflow",
    "toggle-workflow",
    // Routing forms
    "list-routing-forms",
    "create-routing-form",
    "update-routing-form",
    "delete-routing-form",
    "list-routing-form-responses",
  ],
  schemaEntryPoint: "@agent-native/scheduling/schema",
  docs: {
    llms: "docs/llms.txt",
    llmsFull: "docs/llms-full.txt",
    skills: [
      "scheduling-basics",
      "event-types",
      "availability",
      "bookings",
      "booker",
      "slot-engine",
      "team-scheduling",
      "integrations",
      "embeds",
      "workflows",
      "routing-forms",
    ],
  },
  requiredSecrets: [
    {
      key: "GOOGLE_CLIENT_ID",
      label: "Google OAuth Client ID",
      optional: true,
    },
    {
      key: "GOOGLE_CLIENT_SECRET",
      label: "Google OAuth Client Secret",
      optional: true,
    },
    {
      key: "MICROSOFT_CLIENT_ID",
      label: "Microsoft OAuth Client ID",
      optional: true,
    },
    {
      key: "MICROSOFT_CLIENT_SECRET",
      label: "Microsoft OAuth Client Secret",
      optional: true,
    },
    { key: "ZOOM_CLIENT_ID", label: "Zoom OAuth Client ID", optional: true },
    {
      key: "ZOOM_CLIENT_SECRET",
      label: "Zoom OAuth Client Secret",
      optional: true,
    },
    {
      key: "DAILY_API_KEY",
      label: "Daily.co API Key (Cal Video)",
      optional: true,
    },
    {
      key: "TWILIO_ACCOUNT_SID",
      label: "Twilio Account SID (SMS workflows)",
      optional: true,
    },
    { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token", optional: true },
    {
      key: "TWILIO_FROM_NUMBER",
      label: "Twilio sender number",
      optional: true,
    },
  ],
  peerProviders: [
    "google-calendar",
    "office365",
    "zoom",
    "google-meet",
    "cal-video",
  ],
};
