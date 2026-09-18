import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconBrowserCheck, IconPlugConnected } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Button } from "../../components/ui/button.js";
import {
  browserChatExtensionIdSchema,
  browserChatNonceSchema,
} from "../../lib/browser-chat-protocol.js";

interface BrowserChatSessionResult {
  startPath: string;
  expiresAt: number;
  parentOrigin: string;
  remoteDevice: {
    id: string;
    token: string;
  };
  relayBaseUrl: string;
}

interface ChromeRuntimeApi {
  lastError?: { message?: string };
  sendMessage(
    extensionId: string,
    message: Record<string, unknown>,
    callback: (response?: { ok?: boolean; error?: string }) => void,
  ): void;
}

function sendBrowserChatSession(
  extensionId: string,
  message: Record<string, unknown>,
): Promise<void> {
  const runtime = (
    globalThis as typeof globalThis & {
      chrome?: { runtime?: ChromeRuntimeApi };
    }
  ).chrome?.runtime;
  if (!runtime) {
    return Promise.reject(new Error("extension-unavailable"));
  }

  return new Promise((resolve, reject) => {
    runtime.sendMessage(extensionId, message, (response) => {
      const runtimeError = runtime.lastError?.message;
      if (runtimeError) {
        reject(new Error(runtimeError));
      } else if (response?.ok !== true) {
        reject(new Error("extension-rejected"));
      } else {
        resolve();
      }
    });
  });
}

export function meta() {
  return [{ title: "Dispatch" }];
}

export default function BrowserConnectRoute() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const extensionId = searchParams.get("extensionId") ?? "";
  const parsedExtensionId = browserChatExtensionIdSchema.safeParse(extensionId);
  const nonce = browserChatNonceSchema.safeParse(searchParams.get("nonce"));
  const requestIsValid = parsedExtensionId.success && nonce.success;
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createSession = useActionMutation<
    BrowserChatSessionResult,
    { extensionId: string; nonce: string }
  >("create-browser-chat-session", {});

  const connect = async () => {
    if (!requestIsValid) return;
    setError(null);
    try {
      const session = await createSession.mutateAsync({
        extensionId,
        nonce: nonce.data,
      });
      await sendBrowserChatSession(extensionId, {
        type: "browser-chat.session.v1",
        nonce: nonce.data,
        startPath: session.startPath,
        dispatchOrigin: window.location.origin,
        expiresAt: new Date(session.expiresAt).toISOString(),
        remoteDevice: session.remoteDevice,
        relayBaseUrl: session.relayBaseUrl,
      });
      setConnected(true);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "extension-unavailable"
          ? t("dispatch.pages.browserConnectOpenFromExtension")
          : t("dispatch.pages.browserConnectFailed"),
      );
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm">
        <IconBrowserCheck size={36} className="mx-auto text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold text-foreground">
          {t("dispatch.pages.browserConnectTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("dispatch.pages.browserConnectDescription")}
        </p>
        {!requestIsValid ? (
          <p className="mt-4 text-sm text-destructive">
            {t("dispatch.pages.browserConnectInvalid")}
          </p>
        ) : connected ? (
          <p className="mt-4 text-sm font-medium text-foreground">
            {t("dispatch.pages.browserConnectConnected")}
          </p>
        ) : (
          <Button
            className="mt-5 w-full gap-2"
            onClick={() => void connect()}
            disabled={createSession.isPending}
          >
            <IconPlugConnected size={16} />
            {createSession.isPending
              ? t("dispatch.pages.browserConnectConnecting")
              : t("dispatch.pages.browserConnectButton")}
          </Button>
        )}
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
