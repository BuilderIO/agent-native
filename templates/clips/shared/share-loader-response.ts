import { data } from "react-router";

export const PRIVATE_SHARE_RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  "Referrer-Policy": "no-referrer",
};

export function privateShareLoaderData<T>(payload: T, status = 200) {
  return data(payload, {
    status,
    headers: PRIVATE_SHARE_RESPONSE_HEADERS,
  });
}
