import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "booking-link",
  resourceTable: schema.bookingLinks,
  sharesTable: schema.bookingLinkShares,
  displayName: "Booking link",
  titleColumn: "title",
  getDb,
});
