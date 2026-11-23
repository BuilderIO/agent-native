import { request } from "@playwright/test";

import { FixtureControlError, localAppUrl } from "./control-server.js";

export async function openProviderActionClient(
  baseUrl: string,
  storageState: string,
) {
  const base = localAppUrl(baseUrl);
  const api = await request.newContext({
    storageState,
    extraHTTPHeaders: {
      origin: base.origin,
      "sec-fetch-site": "same-origin",
      "x-agent-native-frontend": "1",
      "x-agent-native-csrf": "1",
    },
  });
  const appUrl = (path: string) =>
    `${base.href.replace(/\/+$/, "")}/_agent-native/${path}`;
  let compatibility: string | undefined;
  async function action(name: string, input: object, uiOnly?: boolean) {
    if (uiOnly) {
      const capability = await api.get(appUrl("ui-capability"), {
        maxRedirects: 0,
      });
      try {
        if (!capability.ok())
          throw new FixtureControlError(
            `Fixture UI capability HTTP ${capability.status()}`,
          );
      } finally {
        await capability.dispose();
      }
    }
    const send = () =>
      api.post(appUrl(`actions/${name}`), {
        data: input,
        ...(compatibility && {
          headers: { "x-agent-native-client-compatibility": compatibility },
        }),
        maxRedirects: 0,
        timeout: 45_000,
      });
    let reply = await send();
    const headers = reply.headers();
    const required = headers["x-agent-native-client-compatibility"];
    if (
      reply.status() === 409 &&
      headers["x-agent-native-client-mismatch"] === "1" &&
      required &&
      /^[a-z0-9._-]{1,100}$/i.test(required) &&
      required !== compatibility
    ) {
      await reply.dispose();
      compatibility = required;
      reply = await send();
    }
    try {
      if (!reply.ok())
        throw new FixtureControlError(
          `Fixture action ${name} HTTP ${reply.status()}`,
        );
      return (await reply.json()) as unknown;
    } finally {
      await reply.dispose();
    }
  }
  return { action, dispose: () => api.dispose() };
}
