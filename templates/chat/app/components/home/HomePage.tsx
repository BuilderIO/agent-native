import {
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
} from "@agent-native/core/client/agent-chat";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { useT } from "@agent-native/core/client/i18n";
import { AgentKitComposer } from "@agent-native/toolkit/app/agentkit/react/components";
import { useAgentKitControl } from "@agent-native/toolkit/app/agentkit/react/context";
import { CoreComposerRuntimeProvider } from "@agent-native/toolkit/app/chat/agentkit-chat/composer";
import { CoreAgentKitRoot } from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import { useRealtimeVoiceModeOptional } from "@agent-native/toolkit/app/chat/composer";
import { WaveBackground } from "@agent-native/toolkit/app/shared";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared/AgentNativeIcon";
import {
  IconBook,
  IconBrandDiscord,
  IconBrandGithub,
  IconUsers,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { getChatHomeThreadId } from "@/lib/chat-home-thread";
import {
  chatHandoffComposerOptions,
  chatThreadPath,
  type ChatInitialComposerOptions,
  type ChatRouteState,
} from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

const DOCS_URL = "https://www.agent-native.com/docs";
const GITHUB_URL = "https://github.com/BuilderIO/agent-native";
const DISCORD_URL = "https://discord.gg/qm82StQ2NC";

/**
 * The same AgentKit composer the chat page uses, so Connect AI and the model
 * picker look the way they will in chat. Submitting hands the prompt to the
 * full chat page instead of running it here, and voice chat continues there.
 */
function HomeAgentComposer() {
  const navigate = useNavigate();
  const realtimeVoice = useRealtimeVoiceModeOptional();
  const [threadId] = useState(getChatHomeThreadId);
  const [transport] = useState(() =>
    createAgentNativeAgentKitTransport({
      browserTabId: TAB_ID,
      surface: "app",
      adapter: { textFormat: "markdown" },
    }),
  );

  function openChat(
    message: string,
    options: ChatInitialComposerOptions,
    onLocalSubmit?: () => void,
  ) {
    const state: ChatRouteState = {
      initialMessage: message,
      initialComposerOptions: options,
    };
    markAgentChatHomeHandoff("chat");
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId), {
      state,
    });
    onLocalSubmit?.();
  }

  function startVoiceChat() {
    // Home shows no transcript, so the session is bound to the thread it
    // opens rather than to whichever thread is on screen when it starts.
    void realtimeVoice?.start({ threadId });
    markAgentChatHomeHandoff("chat");
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId));
  }

  return (
    <div
      className="agentkit-tokens w-full max-w-[calc(var(--agent-kit-conversation-max-width,47rem)-2rem)] text-start"
      data-agentkit-composer-size="large"
    >
      <CoreComposerRuntimeProvider>
        <CoreAgentKitRoot
          transport={transport}
          clientOptions={{ transportOwnership: "owned" }}
          threadId={threadId}
        >
          <HomeAgentComposerInput
            threadId={threadId}
            onSubmit={openChat}
            onVoiceChatStart={startVoiceChat}
          />
        </CoreAgentKitRoot>
      </CoreComposerRuntimeProvider>
    </div>
  );
}

function HomeAgentComposerInput({
  threadId,
  onSubmit,
  onVoiceChatStart,
}: {
  threadId: string;
  onSubmit: (
    text: string,
    options: ChatInitialComposerOptions,
    onLocalSubmit?: () => void,
  ) => void;
  onVoiceChatStart: () => void;
}) {
  const t = useT();
  const control = useAgentKitControl(threadId);

  return (
    <AgentKitComposer
      threadId={threadId}
      requireAgentEngine
      placeholder={t("chat.composerPlaceholder")}
      plusMenuMode="hidden"
      attachmentsEnabled={false}
      voiceEnabled
      onVoiceChatStart={onVoiceChatStart}
      onSubmit={async (text, files, references, options) => {
        const uploadedAttachments = files.length
          ? await control.uploadFiles(
              files.map((file) => ({
                name: file.name,
                mediaType: file.type || "application/octet-stream",
                size: file.size,
                body: file,
              })),
            )
          : [];
        onSubmit(
          text,
          chatHandoffComposerOptions(options, {
            references,
            ...(uploadedAttachments.length ? { uploadedAttachments } : {}),
          }),
          options.onLocalSubmit,
        );
      }}
    />
  );
}

function ResourceLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noreferrer">
        {icon}
        {children}
      </a>
    </Button>
  );
}

function ResourceColumn({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Item asChild className="content-start px-6 py-8 sm:px-10">
      <section>
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent>
          <ItemTitle role="heading" aria-level={2}>
            {title}
          </ItemTitle>
        </ItemContent>
        <ItemFooter className="flex-wrap justify-start">{children}</ItemFooter>
      </section>
    </Item>
  );
}

export default function HomePage() {
  const t = useT();

  return (
    <div className="flex min-h-full flex-col">
      <section className="relative isolate flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden px-4 py-16 text-center">
        <WaveBackground
          matchPageSurface
          className="pointer-events-none absolute inset-0 -z-10"
        />
        <AgentNativeIcon
          aria-hidden="true"
          className="h-8 w-14 text-foreground"
        />
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("home.title")}
        </h1>
        <HomeAgentComposer />
      </section>

      <Separator />
      <div className="grid md:grid-cols-[1fr_auto_1fr]">
        <ResourceColumn icon={<IconBook />} title={t("home.docsTitle")}>
          <ResourceLink href={`${DOCS_URL}/getting-started`}>
            {t("home.docsGettingStarted")}
          </ResourceLink>
          <ResourceLink href={`${DOCS_URL}/getting-started-actions`}>
            {t("home.docsAddAction")}
          </ResourceLink>
          <ResourceLink href={`${DOCS_URL}/getting-started-pages`}>
            {t("home.docsAddPage")}
          </ResourceLink>
          <ResourceLink href={`${DOCS_URL}/key-concepts`}>
            {t("home.docsKeyConcepts")}
          </ResourceLink>
        </ResourceColumn>
        <Separator orientation="vertical" className="hidden md:block" />
        <ResourceColumn icon={<IconUsers />} title={t("home.communityTitle")}>
          <ResourceLink href={GITHUB_URL} icon={<IconBrandGithub />}>
            GitHub
          </ResourceLink>
          <ResourceLink href={DISCORD_URL} icon={<IconBrandDiscord />}>
            Discord
          </ResourceLink>
        </ResourceColumn>
      </div>
    </div>
  );
}
