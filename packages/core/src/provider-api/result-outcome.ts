import { fail } from "../action.js";

export function rejectFailedProviderResult<T>(provider: string, result: T): T {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  const response =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : record;
  if (response.ok !== false) return result;
  const status = response.status;
  fail(
    `${provider}: HTTP ${status} ${response.statusText ?? ""}\n\n${JSON.stringify(response.json ?? response.text ?? response).slice(0, 2000)}`,
    {
      statusCode:
        typeof status === "number" && status >= 400 && status <= 599
          ? status
          : 400,
      errorCode:
        typeof status === "number" && status >= 400
          ? `http_${status}`
          : "provider_api_rejected",
    },
  );
}
