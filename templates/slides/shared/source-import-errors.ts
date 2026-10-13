export const SOURCE_IMPORT_NO_WRITE_ERROR_CODE = "source_import_no_write";

export class InvalidPptxSourceError extends Error {
  readonly errorCode = SOURCE_IMPORT_NO_WRITE_ERROR_CODE;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("The PowerPoint file could not be read.");
    this.name = "InvalidPptxSourceError";
    this.cause = cause;
  }
}
