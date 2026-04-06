import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: Infinity,
    },
  },
});

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Get auth token from Supabase session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  // Parse response body once
  let responseData: any;
  try {
    responseData = await res.json();
  } catch {
    responseData = null;
  }

  if (!res.ok) {
    const errorMessage = responseData?.error || `HTTP ${res.status}: ${res.statusText}`;
    const error = new Error(errorMessage) as Error & { details?: any; fullResponse?: any };

    // Include full response body as details if available
    if (responseData) {
      error.details = responseData.details || JSON.stringify(responseData, null, 2);
      error.fullResponse = responseData;
    } else {
      error.details = `HTTP ${res.status}: ${res.statusText} (No response body)`;
    }

    throw error;
  }

  return responseData;
}
