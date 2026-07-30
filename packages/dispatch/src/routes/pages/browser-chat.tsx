import { AgentChatSurface } from "@agent-native/core/client/agent-chat";
import { isEmbedAuthActive } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { installBrowserChatBridge } from "../../lib/browser-chat-bridge.js";
import {
  BROWSER_CHAT_NONCE_QUERY_PARAM,
  BROWSER_CHAT_PARENT_ORIGIN_QUERY_PARAM,
  browserChatExtensionOriginSchema,
  browserChatNonceSchema,
  type BrowserChatMessageV1,
} from "../../lib/browser-chat-protocol.js";

export function meta() {
  return [{ title: "Dispatch" }];
}

export default function BrowserChatRoute() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const nonce = browserChatNonceSchema.safeParse(
    searchParams.get(BROWSER_CHAT_NONCE_QUERY_PARAM),
  );
  const parentOrigin = browserChatExtensionOriginSchema.safeParse(
    searchParams.get(BROWSER_CHAT_PARENT_ORIGIN_QUERY_PARAM),
  );
  const embedSessionActive = isEmbedAuthActive();
  const [attachedPage, setAttachedPage] = useState<string | null>(null);

  useEffect(() => {
    if (!nonce.success || !parentOrigin.success || !embedSessionActive) return;
    return installBrowserChatBridge({
      nonce: nonce.data,
      parentOrigin: parentOrigin.data,
      onAccepted: (message: BrowserChatMessageV1) =>
        setAttachedPage(message.context.page.title),
    });
  }, [
    nonce.data,
    nonce.success,
    parentOrigin.data,
    parentOrigin.success,
    embedSessionActive,
  ]);

  if (!nonce.success || !parentOrigin.success || !embedSessionActive) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-base font-medium text-foreground">
            {t("dispatch.pages.browserChatUnavailableTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("dispatch.pages.browserChatUnavailableDescription")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        <AgentChatSurface
          mode="panel"
          className="h-full"
          defaultMode="chat"
          storageKey="dispatch"
          showHeader={false}
          showTabBar={false}
          allowSettingsMode={false}
          dynamicSuggestions={false}
          suggestions={[]}
          emptyStateDisplay="hidden"
          centerComposerWhenEmpty={false}
          composerPlaceholder={
            attachedPage
              ? t("dispatch.pages.browserChatAttachedPlaceholder", {
                  page: attachedPage,
                })
              : t("dispatch.pages.browserChatPlaceholder")
          }
        />
      </div>
    </main>
  );
}
