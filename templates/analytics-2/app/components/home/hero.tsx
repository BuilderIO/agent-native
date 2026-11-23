import { useT } from "@agent-native/core/client/i18n";
import { Tooltip } from "@agent-native/toolkit/design-system";
import { useIsMobile } from "@agent-native/toolkit/hooks";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconLayoutDashboard,
  IconMessagePlus,
  IconNotebook,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { HomeContextBanner } from "./context-banner";
import type { HomeCallbacks, HomeContextProgress, HomeUser } from "./types";

export type HomePromptIntent = "notebook" | "app";

export function homePromptTitleForIntent(
  intent: HomePromptIntent | null,
): string {
  if (intent === "app") return "What do you want to build?";
  if (intent === "notebook") return "What do you want to analyze?";
  return "What do you want to know?";
}

function PromptActionTooltipContent({
  header,
  body,
}: {
  header: string;
  body: string;
}) {
  return (
    <span className="ws-home-prompt-tooltip-content">
      <span className="ws-home-prompt-tooltip-title">{header}</span>
      <span className="ws-home-prompt-tooltip-body">{body}</span>
    </span>
  );
}

function focusHomeComposer() {
  const editable = document.querySelector<HTMLElement>(
    ".ws-home-composer [contenteditable='true'], .ws-home-composer textarea, .ws-home-composer input",
  );
  editable?.focus();
}

export function HomePromptSection({
  user,
  title,
  activeIntent = null,
  agentComposer,
  contextProgress,
  contextProgressPending,
  callbacks,
}: {
  user: HomeUser;
  title: string;
  activeIntent?: HomePromptIntent | null | undefined;
  agentComposer: ReactNode;
  contextProgress: HomeContextProgress | null;
  contextProgressPending: boolean;
  callbacks: HomeCallbacks;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const curateProgress =
    contextProgress?.enabled && contextProgress.progressPercent < 100
      ? contextProgress
      : null;
  const firstName = user.name.trim().split(/\s+/)[0];

  return (
    <section className="ws-home-prompt" aria-label="Home">
      <div className="ws-home-prompt-bg" aria-hidden="true" />
      <div className="ws-home-prompt-grid" aria-hidden="true" />
      <div className="ws-home-prompt-inner">
        {agentComposer != null ? (
          <>
            <h1 className="ws-home-title">{title}</h1>
            <div className="ws-home-composer">{agentComposer}</div>
            {isMobile ? null : (
              <div className="ws-home-prompt-actions">
                <Tooltip
                  placement="bottom"
                  align="start"
                  delayMs={200}
                  className="ws-home-prompt-tooltip"
                  content={
                    <PromptActionTooltipContent
                      header="Explore ad hoc questions"
                      body="Quickly explore, analyze, and visualize data in a conversational thread."
                    />
                  }
                  trigger={
                    <button
                      type="button"
                      className={`ws-home-prompt-action${activeIntent == null ? " is-active" : ""}`}
                      aria-pressed={activeIntent == null}
                      onClick={() => {
                        callbacks.onSelectIntent?.(null);
                        focusHomeComposer();
                      }}
                    >
                      <IconMessagePlus
                        size={14}
                        stroke={1.75}
                        aria-hidden="true"
                      />
                      Ask
                    </button>
                  }
                />
                {callbacks.canAnalyzeInNotebook && callbacks.onSelectIntent ? (
                  <Tooltip
                    placement="bottom"
                    align="start"
                    delayMs={200}
                    className="ws-home-prompt-tooltip"
                    content={
                      <PromptActionTooltipContent
                        header="Deep dive in a data notebook"
                        body="Build complex queries, collaborate, and explore with no-code tools in an agentic notebook interface."
                      />
                    }
                    trigger={
                      <button
                        type="button"
                        className={`ws-home-prompt-action${activeIntent === "notebook" ? " is-active" : ""}`}
                        aria-pressed={activeIntent === "notebook"}
                        onClick={() => {
                          callbacks.onSelectIntent?.("notebook");
                          focusHomeComposer();
                        }}
                      >
                        <IconNotebook
                          size={14}
                          stroke={1.75}
                          aria-hidden="true"
                        />
                        {t("analytics.home.promptActions.analyzeInNotebook")}
                      </button>
                    }
                  />
                ) : null}
                {callbacks.canGenerateApp && callbacks.onSelectIntent ? (
                  <Tooltip
                    placement="bottom"
                    align="start"
                    delayMs={200}
                    className="ws-home-prompt-tooltip"
                    content={
                      <PromptActionTooltipContent
                        header="Generate a custom data app"
                        body="Create and publish fully customizable interactive apps powered by your trusted data."
                      />
                    }
                    trigger={
                      <button
                        type="button"
                        className={`ws-home-prompt-action${activeIntent === "app" ? " is-active" : ""}`}
                        aria-pressed={activeIntent === "app"}
                        onClick={() => {
                          callbacks.onSelectIntent?.("app");
                          focusHomeComposer();
                        }}
                      >
                        <IconLayoutDashboard
                          size={14}
                          stroke={1.75}
                          aria-hidden="true"
                        />
                        {t("analytics.home.promptActions.generateApp")}
                      </button>
                    }
                  />
                ) : null}
              </div>
            )}
            {contextProgressPending || curateProgress ? (
              <div className="ws-home-curate-slot">
                {contextProgressPending ? (
                  <div aria-busy="true">
                    <Skeleton className="h-[42px] w-full rounded-lg" />
                  </div>
                ) : (
                  curateProgress && (
                    <HomeContextBanner
                      progress={curateProgress}
                      {...(callbacks.onSelectContextStep != null
                        ? { onSelectStep: callbacks.onSelectContextStep }
                        : {})}
                      {...(callbacks.onDismissContextBanner != null
                        ? { onDismiss: callbacks.onDismissContextBanner }
                        : {})}
                    />
                  )
                )}
              </div>
            ) : null}
          </>
        ) : (
          <div className="ws-home-welcome">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </div>
        )}
      </div>
    </section>
  );
}
