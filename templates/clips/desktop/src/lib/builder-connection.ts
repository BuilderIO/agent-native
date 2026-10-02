type BuilderConnectionStatus = {
  agentNativeProvisioningEnabled?: boolean;
  agentNativeProvisioningToken?: string;
  connectUrl?: string;
};

export async function useBuilderForVoiceCleanup(
  base: string,
  dependencies: {
    fetchImpl?: typeof fetch;
    openExternal: (url: string) => Promise<unknown>;
  },
): Promise<"activated" | "browser"> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const statusResponse = await fetchImpl(
    `${base}/_agent-native/connection-status/builder`,
    { credentials: "include" },
  );
  const status =
    (await statusResponse.json()) as BuilderConnectionStatus | null;
  if (!statusResponse.ok || !status) {
    throw new Error(
      `Couldn't check Builder.io setup (${statusResponse.status}). Try again.`,
    );
  }

  const connectUrl = status.connectUrl
    ? new URL(status.connectUrl, base)
    : null;
  if (connectUrl && connectUrl.origin !== new URL(base).origin) {
    throw new Error("Builder.io returned a sign-in link for another server.");
  }
  if (!status.agentNativeProvisioningEnabled) {
    throw new Error(
      "One-click Builder.io setup isn't available on this server. Try again later.",
    );
  }
  const connectToken = connectUrl?.searchParams.get("_an_connect") ?? null;
  if (!status.agentNativeProvisioningToken || !connectToken) {
    throw new Error("Couldn't prepare one-click Builder.io setup. Try again.");
  }

  const provisionResponse = await fetchImpl(
    `${base}/_agent-native/builder/provision?source=clips-desktop&flow=voice-transcription`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provisioningToken: status.agentNativeProvisioningToken,
        connectToken,
      }),
      credentials: "include",
    },
  );
  const provision = (await provisionResponse.json()) as {
    ok?: boolean;
    code?: string;
    message?: string;
  } | null;
  if (provision?.code === "account_exists" && connectUrl) {
    await dependencies.openExternal(connectUrl.href);
    return "browser";
  }
  if (!provisionResponse.ok || !provision?.ok) {
    throw new Error(
      provision?.message ||
        `Couldn't set up Builder.io (${provisionResponse.status}). Try again.`,
    );
  }
  return "activated";
}
