/**
 * Wrapper around fetch. Auth headers have been removed;
 * this is now a plain pass-through kept for API compatibility.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}
