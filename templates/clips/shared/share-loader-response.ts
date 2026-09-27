import { SSR_QUERY_CACHE_KEY_HEADER } from "@agent-native/core/shared";
import { data } from "react-router";

export const PRIVATE_SHARE_RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  "Referrer-Policy": "no-referrer",
};

export function privateShareLoaderData<T>(
  payload: T,
  status = 200,
  varyByQuery = false,
) {
  return data(payload, {
    status,
    headers: {
      ...PRIVATE_SHARE_RESPONSE_HEADERS,
      ...(varyByQuery ? { [SSR_QUERY_CACHE_KEY_HEADER]: "query" } : {}),
    },
  });
}
