export const OAUTH_ACCOUNT_ALREADY_LINKED_ERROR = "account_already_linked";

export interface ConnectionOAuthCallbackError {
  error: typeof OAUTH_ACCOUNT_ALREADY_LINKED_ERROR;
  account: string | null;
}

export function readConnectionOAuthCallbackError(
  search: string | URLSearchParams,
): ConnectionOAuthCallbackError | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  if (params.get("oauth_error") !== OAUTH_ACCOUNT_ALREADY_LINKED_ERROR) {
    return null;
  }
  return {
    error: OAUTH_ACCOUNT_ALREADY_LINKED_ERROR,
    account: params.get("oauth_account") || null,
  };
}
