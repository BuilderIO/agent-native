import { callAction } from "@agent-native/core/client/hooks";

export interface GoogleDocsStatus {
  configured?: boolean;
  connected?: boolean;
  pickerConfigured?: boolean;
  accounts?: Array<{ email: string; scope?: string }>;
  pickerApiKey?: string | null;
  pickerAppId?: string | null;
  googleSlidesUrlImportReady?: boolean;
  googleSlidesUrlImportError?: string;
  googleSlidesExport?: {
    available?: boolean;
    reason?: "not-configured" | "oauth-rejected";
  };
  error?: string;
  message?: string;
}

export interface GooglePickerToken {
  accessToken: string;
  accountEmail: string;
  apiKey: string;
  appId: string;
  error?: string;
  message?: string;
}

export interface GoogleDocsRouteResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  unreadable: boolean;
}

interface ActionError extends Error {
  actionMessage?: string;
  errorCode?: string;
  status?: number;
}

async function getActionJson<T>(
  actionName: "get-google-docs-status" | "get-google-picker-token",
  params: Record<string, unknown> = {},
): Promise<GoogleDocsRouteResponse<T>> {
  try {
    const data = await callAction<T>(actionName, params, {
      method: "GET",
      uiOnly: true,
    });
    return {
      ok: true,
      status: 200,
      data,
      unreadable: false,
    };
  } catch (caught) {
    if (!(caught instanceof Error)) throw caught;
    const error = caught as ActionError;
    const status = error.status;
    if (typeof status !== "number" || !Number.isInteger(status) || status < 400)
      throw caught;
    if (
      /returned \d+ but the body could not be read:|returned a non-JSON \d+ response:/.test(
        error.message,
      )
    ) {
      return {
        ok: false,
        status,
        data: null,
        unreadable: true,
      };
    }
    const message = error.actionMessage || error.message;
    return {
      ok: false,
      status,
      data: {
        error: error.errorCode || message,
        message,
      } as T,
      unreadable: false,
    };
  }
}

export function getGoogleDocsStatus() {
  return getActionJson<GoogleDocsStatus>("get-google-docs-status", {
    origin: window.location.origin,
  });
}

export function getGooglePickerToken() {
  return getActionJson<GooglePickerToken>("get-google-picker-token");
}

export function googleDocsRouteErrorMessage<
  T extends { error?: string; message?: string },
>(
  response: GoogleDocsRouteResponse<T>,
  fallback: string,
  unreadableFallback = fallback,
): string {
  return (
    response.data?.message ||
    response.data?.error ||
    (response.unreadable ? unreadableFallback : fallback)
  );
}
