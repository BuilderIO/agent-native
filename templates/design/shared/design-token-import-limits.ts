export const DESIGN_TOKEN_IMPORT_MAX_FILES = 20;
export const DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS = 256;
export const DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES = 500 * 1024;
// JSON may escape each control character as a six-byte `\uXXXX` sequence.
export const DESIGN_TOKEN_IMPORT_MAX_BODY_BYTES =
  DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES * 6 + 64 * 1024;
