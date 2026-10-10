import { navigateWithAgentChatViewTransition } from "@agent-native/core/client/agent-chat";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { useT } from "@agent-native/core/client/i18n";
import { AgentKitComposer } from "@agent-native/toolkit/app/agentkit/react/components";
import { CoreComposerRuntimeProvider } from "@agent-native/toolkit/app/chat/agentkit-chat/composer";
import { CoreAgentKitRoot } from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import { WaveBackground } from "@agent-native/toolkit/app/shared";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared/AgentNativeIcon";
import {
  IconBook,
  IconBrandDiscord,
  IconBrandGithub,
  IconUsers,
} from "@tabler/icons-react";
import { Fragment, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { getChatHomeThreadId } from "@/lib/chat-home-thread";
import { chatThreadPath, type ChatRouteState } from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

const DOCS_URL = "https://www.agent-native.com/docs";
const GITHUB_URL = "https://github.com/BuilderIO/agent-native";
const DISCORD_URL = "https://discord.gg/qm82StQ2NC";

const INLINE_COMPOSER_STYLE = {
  display: "block",
  blockSize: "auto",
  overflow: "visible",
  background: "transparent",
} as const;

const EDIT_HINT_CODE = { file: "actions/hello.ts" };
const DEV_ONLY_HINT_CODE = {
  flag: "SHOW_HOME_PAGE",
  value: "false",
  file: "app/lib/chat-paths.ts",
};

/** Placeholder values that `WithCode` swaps back out for code chips. */
function codeSlots(code: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(code).map((name) => [name, `\u0000${name}\u0000`]),
  );
}

function WithCode({
  text,
  code,
}: {
  text: string;
  code: Record<string, string>;
}) {
  return (
    <>
      {text
        .split(/\u0000(\w+)\u0000/)
        .map((part, index) =>
          index % 2 === 1 ? (
            <CodeChip key={index}>{code[part]}</CodeChip>
          ) : (
            <Fragment key={index}>{part}</Fragment>
          ),
        )}
    </>
  );
}

function CodeChip({ children }: { children: ReactNode }) {
  return (
    <code className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
      {children}
    </code>
  );
}

/**
 * The same AgentKit composer the chat page uses, so Connect AI and the model
 * picker look the way they will in chat. Submitting hands the prompt to the
 * full chat page instead of running it here.
 */
function HomeAgentComposer() {
  const t = useT();
  const navigate = useNavigate();
  const [threadId] = useState(getChatHomeThreadId);
  const [transport] = useState(() =>
    createAgentNativeAgentKitTransport({
      browserTabId: TAB_ID,
      surface: "app",
      adapter: { textFormat: "markdown" },
    }),
  );

  function openChat(message: string) {
    const state: ChatRouteState = { initialMessage: message };
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId), {
      state,
    });
  }

  return (
    // `agentkit-chat` carries the page composer's sizing tokens. Its stylesheet
    // is unlayered, so Tailwind utilities can't undo the transcript canvas
    // (background, full-height grid); only inline styles win here.
    <div
      className="agentkit-chat w-full max-w-2xl text-start"
      style={INLINE_COMPOSER_STYLE}
    >
      <div className="agentkit-composer-stack">
        <CoreComposerRuntimeProvider>
          <CoreAgentKitRoot
            transport={transport}
            clientOptions={{ transportOwnership: "owned" }}
            threadId={threadId}
          >
            <AgentKitComposer
              threadId={threadId}
              requireAgentEngine
              placeholder={t("home.composerPlaceholder")}
              plusMenuMode="hidden"
              attachmentsEnabled={false}
              voiceEnabled
              onSubmit={(text) => openChat(text)}
            />
          </CoreAgentKitRoot>
        </CoreComposerRuntimeProvider>
      </div>
    </div>
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
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Item asChild className="px-6 py-8 sm:px-10">
      <section>
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent>
          <ItemTitle role="heading" aria-level={2}>
            {title}
          </ItemTitle>
          {description ? (
            <ItemDescription>{description}</ItemDescription>
          ) : null}
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
        <WaveBackground className="pointer-events-none absolute inset-0 -z-10" />
        <AgentNativeIcon
          aria-hidden="true"
          className="h-8 w-14 text-foreground"
        />
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("home.title")}
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            <span className="block">{t("home.lead")}</span>
            <span className="block">{t("home.leadTry")}</span>
          </p>
        </div>
        <HomeAgentComposer />
        <p className="max-w-lg text-sm text-muted-foreground">
          <WithCode
            text={t("home.editHint", codeSlots(EDIT_HINT_CODE))}
            code={EDIT_HINT_CODE}
          />
        </p>
      </section>

      <Separator />
      <div className="grid md:grid-cols-[1fr_auto_1fr]">
        <ResourceColumn
          icon={<IconBook />}
          title={t("home.docsTitle")}
          description={t("home.docsDescription")}
        >
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
        <ResourceColumn
          icon={<IconUsers />}
          title={t("home.communityTitle")}
          description={t("home.communityDescription")}
        >
          <ResourceLink href={GITHUB_URL} icon={<IconBrandGithub />}>
            GitHub
          </ResourceLink>
          <ResourceLink href={DISCORD_URL} icon={<IconBrandDiscord />}>
            Discord
          </ResourceLink>
        </ResourceColumn>
      </div>

      <Separator />
      <p className="px-6 py-4 text-center text-xs text-muted-foreground">
        <WithCode
          text={t("home.devOnlyHint", codeSlots(DEV_ONLY_HINT_CODE))}
          code={DEV_ONLY_HINT_CODE}
        />
      </p>
    </div>
  );
}
