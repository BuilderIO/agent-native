export type FirstPartyAnalyticsValidationCode =
  | "invalid_query"
  | "invalid_shape"
  | "disallowed_source"
  | "unsupported_function"
  | "cross_backend_join";

export class FirstPartyAnalyticsValidationError extends Error {
  constructor(
    readonly code: FirstPartyAnalyticsValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "FirstPartyAnalyticsValidationError";
  }
}
