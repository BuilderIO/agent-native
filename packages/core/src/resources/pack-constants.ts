export const RESOURCE_PACK_MAX_FILES = 200;
export const RESOURCE_PACK_MAX_BYTES = 1_000_000;
export const RESOURCE_PACK_MAX_REDACTIONS = RESOURCE_PACK_MAX_FILES * 2;
// Content is capped at RESOURCE_PACK_MAX_BYTES. The HTTP body also carries
// JSON framing, checksums, and escaping, so the route limit sits above that.
export const RESOURCE_PACK_MAX_BODY_BYTES =
  RESOURCE_PACK_MAX_BYTES * 6 + 65_536;
// Never materialize a single source resource larger than an entire pack body.
export const RESOURCE_PACK_MAX_SOURCE_FILE_BYTES = RESOURCE_PACK_MAX_BODY_BYTES;
