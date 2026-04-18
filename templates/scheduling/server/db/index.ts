import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "event-type",
  resourceTable: schema.eventTypes,
  sharesTable: schema.eventTypeShares,
  displayName: "Event type",
  titleColumn: "title",
  getDb,
});

registerShareableResource({
  type: "schedule",
  resourceTable: schema.schedules,
  sharesTable: schema.scheduleShares,
  displayName: "Schedule",
  titleColumn: "name",
  getDb,
});

registerShareableResource({
  type: "team",
  resourceTable: schema.teams,
  sharesTable: schema.teamShares,
  displayName: "Team",
  titleColumn: "name",
  getDb,
});

registerShareableResource({
  type: "workflow",
  resourceTable: schema.workflows,
  sharesTable: schema.workflowShares,
  displayName: "Workflow",
  titleColumn: "name",
  getDb,
});

registerShareableResource({
  type: "routing-form",
  resourceTable: schema.routingForms,
  sharesTable: schema.routingFormShares,
  displayName: "Routing form",
  titleColumn: "name",
  getDb,
});

registerShareableResource({
  type: "booking",
  resourceTable: schema.bookings,
  sharesTable: schema.bookingShares,
  displayName: "Booking",
  titleColumn: "title",
  getDb,
});
