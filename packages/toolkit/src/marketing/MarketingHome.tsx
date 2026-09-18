import * as React from "react";

import { Button } from "../ui/button.js";
import { cn } from "../utils.js";
import { Starfield } from "./Starfield.js";

export interface MarketingValueProp {
  title: React.ReactNode;
  description?: React.ReactNode;
}

export interface MarketingHomeProps {
  /** Product or app name shown in the public shell. */
  appName: React.ReactNode;
  /** Choose the standard public shell or the split auth composition. */
  variant?: "default" | "auth";
  /** Main value proposition. */
  tagline?: React.ReactNode;
  /** Supporting product description. */
  description?: React.ReactNode;
  /** Short value props rendered below the hero. */
  valueProps?: readonly (MarketingValueProp | React.ReactNode)[];
  /** Optional visual layer, including a 3D/canvas background. */
  background?: React.ReactNode;
  /** Primary and secondary calls to action. */
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /** Optional page-level action rendered above the auth split. */
  topRight?: React.ReactNode;
  /** Convenience links for the default primary and secondary buttons. */
  primaryActionHref?: string;
  secondaryActionHref?: string;
  primaryActionLabel?: React.ReactNode;
  secondaryActionLabel?: React.ReactNode;
  /** Optional auth or signup surface beside the marketing copy. */
  auth?: React.ReactNode;
  /** Replace the default hero entirely while retaining the page shell. */
  children?: React.ReactNode;
  className?: string;
}

export function MarketingHome({
  appName,
  variant = "default",
  tagline,
  description,
  valueProps = [],
  background = <Starfield />,
  primaryAction,
  secondaryAction,
  topRight,
  auth,
  children,
  className,
  primaryActionHref,
  secondaryActionHref,
  primaryActionLabel,
  secondaryActionLabel,
}: MarketingHomeProps) {
  const isAuthVariant = variant === "auth";
  const resolvedPrimaryAction =
    primaryAction ??
    (primaryActionHref ? (
      <Button asChild size="lg">
        <a href={primaryActionHref}>
          {primaryActionLabel ?? <>Open {appName}</>}
        </a>
      </Button>
    ) : null);
  const resolvedSecondaryAction =
    secondaryAction ??
    (secondaryActionHref ? (
      <Button asChild size="lg" variant="outline">
        <a href={secondaryActionHref}>{secondaryActionLabel ?? "Sign in"}</a>
      </Button>
    ) : null);

  const content = children ?? (
    <>
      <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
        {appName}
      </p>
      <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
        {tagline ?? appName}
      </h1>
      {description ? (
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
      {valueProps.length > 0 ? (
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {valueProps.map((valueProp, index) => {
            const isStructured =
              typeof valueProp === "object" &&
              valueProp !== null &&
              "title" in valueProp;
            const title = isStructured
              ? (valueProp as MarketingValueProp).title
              : valueProp;
            const valueDescription = isStructured
              ? (valueProp as MarketingValueProp).description
              : undefined;
            return (
              <div
                key={index}
                className="rounded-xl border border-border/60 bg-background/70 p-4 backdrop-blur-sm"
              >
                <p className="text-sm font-medium text-foreground">{title}</p>
                {valueDescription ? (
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {valueDescription}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {resolvedPrimaryAction || resolvedSecondaryAction ? (
        <div className="mt-10 flex flex-wrap items-center gap-3">
          {resolvedPrimaryAction}
          {resolvedSecondaryAction}
        </div>
      ) : null}
    </>
  );

  return (
    <main
      className={cn(
        "relative isolate min-h-screen overflow-hidden bg-background text-foreground",
        className,
      )}
      data-agent-native-marketing-home
    >
      {background ? (
        <div className="pointer-events-none absolute inset-0 -z-10">
          {background}
        </div>
      ) : null}
      <div
        className={cn(
          isAuthVariant
            ? cn(
                "auth-marketing-shell mx-auto flex min-h-screen w-full items-center px-6 py-10 sm:px-10 lg:px-16",
                topRight ? "auth-marketing-shell-with-top-right" : "",
              )
            : "mx-auto flex min-h-screen w-full max-w-7xl items-center px-6 py-16 sm:px-10 lg:px-16",
        )}
      >
        {isAuthVariant && topRight ? (
          <div className="auth-marketing-top-right">{topRight}</div>
        ) : null}
        <div
          className={cn(
            isAuthVariant && auth ? "split" : "grid w-full items-center gap-12",
            auth ? "lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]" : "",
            isAuthVariant && auth ? "max-w-6xl" : "",
            isAuthVariant && topRight ? "auth-marketing-layout" : "",
          )}
        >
          <section
            className={isAuthVariant && auth ? "marketing-panel" : undefined}
          >
            {content}
          </section>
          {auth ? (
            <aside
              className={cn(
                isAuthVariant
                  ? "form-panel w-full max-w-md justify-self-end"
                  : "",
              )}
            >
              {auth}
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
