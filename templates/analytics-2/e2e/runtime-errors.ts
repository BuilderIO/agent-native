export interface ExpectedRuntimeFailure {
  response: (entry: { url: string; method: string; status: number }) => boolean;
  console: (entry: { url: string; text: string }) => boolean;
}

export function expectedMissingProjectFailure(
  base: string,
  projectId: string,
): ExpectedRuntimeFailure {
  const expectedUrl = new URL(
    `${base.replace(/\/$/, "")}/_agent-native/actions/get-project`,
  );
  expectedUrl.searchParams.set("projectId", projectId);
  const matchesUrl = (url: string) => {
    try {
      const actual = new URL(url);
      return (
        actual.origin === expectedUrl.origin &&
        actual.pathname === expectedUrl.pathname &&
        actual.searchParams.size === 1 &&
        actual.searchParams.get("projectId") === projectId
      );
    } catch {
      return false;
    }
  };
  return {
    response: ({ url, method, status }) =>
      method === "GET" && status === 404 && matchesUrl(url),
    console: ({ url, text }) =>
      matchesUrl(url) &&
      /^Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)$/.test(
        text,
      ),
  };
}

export function expectedAppIntentTransportFailure(
  base: string,
): ExpectedRuntimeFailure {
  const expectedUrl = new URL(
    `${base.replace(/\/$/, "")}/_agent-native/actions/start-analytics-thread`,
  );
  const matchesUrl = (url: string) => {
    try {
      const actual = new URL(url);
      return (
        actual.origin === expectedUrl.origin &&
        actual.pathname === expectedUrl.pathname &&
        actual.searchParams.size === 0
      );
    } catch {
      return false;
    }
  };
  return {
    response: ({ url, method, status }) =>
      method === "POST" && status === 503 && matchesUrl(url),
    console: ({ url, text }) =>
      matchesUrl(url) &&
      /^Failed to load resource: the server responded with a status of 503 \((?:Service Unavailable)?\)$/.test(
        text,
      ),
  };
}
