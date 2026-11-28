export async function postUiAction(
  baseUrl: string,
  name: string,
  input: unknown,
): Promise<unknown> {
  const origin = new URL(baseUrl).origin;
  const minted = await fetch(`${baseUrl}/_agent-native/ui-capability`, {
    headers: { Origin: origin, Connection: "close" },
  });
  if (!minted.ok) {
    throw new Error(
      `ui-capability failed: ${minted.status} ${await minted.text()}`,
    );
  }
  const cookie = minted.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  const response = await fetch(`${baseUrl}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-CSRF": "1",
      "X-Agent-Native-Frontend": "1",
      Origin: origin,
      Cookie: cookie,
      Connection: "close",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `${name} failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

type RequestContext = {
  get(
    url: string,
    options: { headers: Record<string, string> },
  ): Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>;
};

export async function presentUiCapability(
  request: RequestContext,
  baseUrl: string,
): Promise<void> {
  const response = await request.get(`${baseUrl}/_agent-native/ui-capability`, {
    headers: { Origin: new URL(baseUrl).origin },
  });
  if (!response.ok()) {
    throw new Error(
      `ui-capability failed: ${response.status()} ${await response.text()}`,
    );
  }
}
