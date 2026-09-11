import type { ReactNode } from "react";

import { IntegrationsPanel } from "../integrations/IntegrationsPanel.js";
import { OnboardingPanel } from "../onboarding/OnboardingPanel.js";
import { SecretsSection } from "../settings/SecretsSection.js";
import { cn } from "../utils.js";
import { BuilderConnectCard } from "./BuilderConnectCard.js";

export interface SetupConnectionsPageProps {
  title?: string;
  description?: string;
  onboardingTitle?: string;
  focusSecretKey?: string;
  providerReadiness?: ReactNode;
  workspaceConnections?: ReactNode;
  children?: ReactNode;
  showOnboarding?: boolean;
  showBuilderConnect?: boolean;
  showSecrets?: boolean;
  showIntegrations?: boolean;
  className?: string;
}

export function SetupConnectionsPage({
  title = "Setup & connections",
  description = "Manage setup status, Builder connect, app secrets, and workspace connections from one standard surface.",
  onboardingTitle = "Setup checklist",
  focusSecretKey,
  providerReadiness,
  workspaceConnections,
  children,
  showOnboarding = true,
  showBuilderConnect = true,
  showSecrets = true,
  showIntegrations = false,
  className,
}: SetupConnectionsPageProps) {
  return (
    <div className={cn("min-h-full bg-background p-4 sm:p-6", className)}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">
            {title}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="flex min-w-0 flex-col gap-4">
            {showOnboarding ? (
              <OnboardingPanel title={onboardingTitle} />
            ) : null}
            {workspaceConnections ? (
              <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
                {workspaceConnections}
              </section>
            ) : null}
            {providerReadiness ? (
              <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
                {providerReadiness}
              </section>
            ) : null}
            {children}
          </main>

          <aside className="flex min-w-0 flex-col gap-4">
            {showBuilderConnect ? <BuilderConnectCard /> : null}
            {showSecrets ? (
              <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Secrets
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Registered keys and OAuth credentials are stored in the
                    scoped secrets store.
                  </p>
                </div>
                <SecretsSection focusKey={focusSecretKey} />
              </section>
            ) : null}
            {showIntegrations ? (
              <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
                <IntegrationsPanel />
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
