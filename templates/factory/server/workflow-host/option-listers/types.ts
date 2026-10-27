export type OptionProvider = "slack" | "sentry" | "github";

/** Every lister asks the provider for this many options at a time. */
export const OPTION_PAGE_SIZE = 100;

/** What a person may want to know about an option beyond its name; the picker words each one in the user's language. */
export type ProviderOptionTag = "private" | "bot_not_member" | "archived";

export interface ProviderOption {
  /** What the field stores. */
  value: string;
  label: string;
  /** Language-neutral detail, such as an id or the stored value when the label differs from it. */
  hint?: string;
  tags?: ProviderOptionTag[];
}

export interface OptionPage {
  options: ProviderOption[];
  /** Opaque to the caller; absent on the last page. */
  nextCursor?: string;
}

export interface OptionListRequest {
  /** What the resource is listed inside, such as a Sentry organization. */
  parent?: string;
  cursor?: string;
}

export const OPTION_FAILURE_CODES = [
  "credential_missing",
  "rate_limited",
  "provider_unreadable",
] as const;

export type OptionFailureCode = (typeof OPTION_FAILURE_CODES)[number];

/** Why a credential did not get a list: nothing is connected, the provider refused it, or it lacks a permission. */
export type CredentialReason = "not_connected" | "refused" | "missing_scope";

interface OptionListErrorDetails {
  reason?: CredentialReason;
  /** The permission a `missing_scope` failure names. */
  scope?: string;
  retryAfterSeconds?: number;
  status?: number;
  retryable?: boolean;
}

/** Never carries a response body, only what the picker needs to say why a list did not load. */
export class OptionListError extends Error {
  readonly code: OptionFailureCode;
  readonly provider: OptionProvider;
  readonly reason?: CredentialReason | undefined;
  readonly scope?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  readonly status?: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: OptionFailureCode,
    provider: OptionProvider,
    message: string,
    details: OptionListErrorDetails = {},
  ) {
    super(message);
    this.name = "OptionListError";
    this.code = code;
    this.provider = provider;
    this.reason = details.reason;
    this.scope = details.scope;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.status = details.status;
    this.retryable = details.retryable ?? code === "rate_limited";
  }
}

/** A cursor the caller made up or carried over from another list; a caller mistake, never a provider failure. */
export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export interface ProviderHttpResponse {
  status: number;
  ok: boolean;
  truncated: boolean;
  json: unknown;
  /** Lower-case names. */
  headers: Readonly<Record<string, string>>;
  retryAfterSeconds?: number;
}

/** One authenticated GET against the provider's API; credentials never reach a lister. */
export type ProviderHttp = (request: {
  path: string;
  query?: Readonly<Record<string, string>>;
}) => Promise<ProviderHttpResponse>;

export interface OptionLister {
  provider: OptionProvider;
  resource: string;
  /** The resource that holds this one, listed first; a request without a `parent` is refused. */
  parentResource?: string;
  list(http: ProviderHttp, request: OptionListRequest): Promise<OptionPage>;
  /**
   * The one option a search that spells a resource's id exactly points at, for
   * a provider whose pages may never reach it. `undefined` means the provider
   * has no such resource for this credential; a failure to ask is thrown.
   */
  find?(
    http: ProviderHttp,
    search: string,
  ): Promise<ProviderOption | undefined>;
}
