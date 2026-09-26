import { Tabs } from "@agent-native/toolkit/design-system";
import { useId, type ReactNode } from "react";

export interface PromptHomeProps {
  title: ReactNode;
  composer: ReactNode;
  mobileToolbar?: ReactNode;
  connection?: ReactNode;
  quickActions?: ReactNode;
  children?: ReactNode;
}

export function PromptHome({
  title,
  composer,
  mobileToolbar,
  connection,
  quickActions,
  children,
}: PromptHomeProps) {
  const titleId = useId();
  return (
    <div className="agent-prompt-home mx-auto w-full min-w-0 px-4 pb-14 sm:px-6 lg:px-8">
      {mobileToolbar ? (
        <div className="agent-prompt-home-composer mx-auto flex items-center gap-2 pt-3 md:hidden">
          {mobileToolbar}
        </div>
      ) : null}
      <section className="agent-prompt-home-hero" aria-labelledby={titleId}>
        <h2
          id={titleId}
          className="text-2xl font-semibold tracking-tight text-foreground"
        >
          {title}
        </h2>
        <div className="agent-prompt-home-composer mt-4 text-start">
          <div
            className="agent-prompt-home-connection"
            data-visible={connection ? "true" : undefined}
            aria-hidden={!connection || undefined}
          >
            {connection}
          </div>
          {composer}
        </div>
        {quickActions ? (
          <div className="agent-prompt-home-composer mt-4 flex flex-wrap justify-center gap-2">
            {quickActions}
          </div>
        ) : null}
      </section>
      {children}
    </div>
  );
}

export type PromptHomeLibraryTab = "templates" | "recent";

export interface PromptHomeLibraryProps {
  value: PromptHomeLibraryTab;
  onValueChange: (value: PromptHomeLibraryTab) => void;
  labels: { templates: string; recent: string };
  browseAll?: ReactNode;
  recentActions?: ReactNode;
  templates: ReactNode;
  recent?: ReactNode;
}

export function PromptHomeLibrary({
  value,
  onValueChange,
  labels,
  browseAll,
  recentActions,
  templates,
  recent,
}: PromptHomeLibraryProps) {
  return (
    <section
      className="agent-prompt-home-library"
      aria-label={labels.templates}
    >
      <Tabs<PromptHomeLibraryTab>
        className="agent-prompt-home-tabs"
        value={value}
        onChange={onValueChange}
        headerActions={value === "templates" ? browseAll : recentActions}
        items={[
          { value: "templates", label: labels.templates, content: templates },
          {
            value: "recent",
            label: labels.recent,
            content: recent,
          },
        ]}
      />
    </section>
  );
}
