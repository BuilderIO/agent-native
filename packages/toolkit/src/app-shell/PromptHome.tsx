import { Tabs } from "@agent-native/toolkit/design-system";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { useFirstRunOnboardingGateOwnsSurface } from "../app/onboarding/first-run-startup-gate.js";

export interface PromptHomeProps {
  title: ReactNode;
  composer: ReactNode;
  mobileToolbar?: ReactNode;
  connection?: ReactNode;
  connectionAttached?: boolean;
  reserveConnectionSpace?: boolean;
  quickActions?: ReactNode;
  focusComposer?: () => void;
  children?: ReactNode;
}

export function PromptHome({
  title,
  composer,
  mobileToolbar,
  connection,
  connectionAttached,
  reserveConnectionSpace = false,
  quickActions,
  focusComposer,
  children,
}: PromptHomeProps) {
  const titleId = useId();
  const firstRunOwnsSurface = useFirstRunOnboardingGateOwnsSurface();
  const firstRunOwnsSurfaceRef = useRef(firstRunOwnsSurface);
  const pendingFocusRef = useRef(false);
  const focusComposerRef = useRef(focusComposer);
  firstRunOwnsSurfaceRef.current = firstRunOwnsSurface;
  focusComposerRef.current = focusComposer;

  useEffect(() => {
    if (!focusComposer) return;
    const focusWhenAvailable = () => {
      pendingFocusRef.current = true;
      if (firstRunOwnsSurfaceRef.current) return;
      requestAnimationFrame(() => {
        if (!firstRunOwnsSurfaceRef.current && pendingFocusRef.current) {
          pendingFocusRef.current = false;
          focusComposerRef.current?.();
        }
      });
    };
    window.addEventListener(
      "agent-native:first-run-completed",
      focusWhenAvailable,
    );
    window.addEventListener(
      "agent-engine:configured-changed",
      focusWhenAvailable,
    );
    return () => {
      window.removeEventListener(
        "agent-native:first-run-completed",
        focusWhenAvailable,
      );
      window.removeEventListener(
        "agent-engine:configured-changed",
        focusWhenAvailable,
      );
    };
  }, [focusComposer]);

  useEffect(() => {
    if (firstRunOwnsSurface || !pendingFocusRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (!firstRunOwnsSurfaceRef.current && pendingFocusRef.current) {
        pendingFocusRef.current = false;
        focusComposerRef.current?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [firstRunOwnsSurface]);

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
        <div
          className={`agent-prompt-home-composer mt-4 text-start${
            connectionAttached ? " agent-composer-area--attached-above" : ""
          }`}
        >
          <div
            className="agent-prompt-home-connection"
            data-visible={connection ? "true" : undefined}
            data-reserved={reserveConnectionSpace || undefined}
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
      onClickCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[role="tab"][aria-selected="true"]')
        ) {
          onValueChange(value);
        }
      }}
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
