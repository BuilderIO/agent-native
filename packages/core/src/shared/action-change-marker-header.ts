/**
 * Set to `failed` on a write response whose durable change marker did not
 * land, so polling clients were not told about that write. The value is a
 * fixed token: error text never goes in a header.
 */
export const ACTION_CHANGE_MARKER_HEADER = "X-Agent-Native-Change-Marker";
export const ACTION_CHANGE_MARKER_FAILED = "failed";
