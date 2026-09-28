export const RESOURCE_PACK_MAX_FILES = 200;
export const RESOURCE_PACK_MAX_BYTES = 1_000_000;
// Content is capped at RESOURCE_PACK_MAX_BYTES. The HTTP body also carries
// JSON framing, checksums, and escaping, so the route limit sits above that.
export const RESOURCE_PACK_MAX_BODY_BYTES =
  RESOURCE_PACK_MAX_BYTES * 6 + 65_536;
