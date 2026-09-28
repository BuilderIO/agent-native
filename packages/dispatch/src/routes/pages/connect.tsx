import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink, IconPlugConnected } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppIcon } from "../../components/app-icon";
import { DispatchShell } from "../../components/dispatch-shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  buildIdentityConnectUrl,
  fetchConnectAgentCard,
  fetchMarketplaceApps,
  normalizeConnectUrl,
  type ConnectAgentCard,
  type MarketplaceApp,
} from "../../lib/connect-apps";
import { DISPATCH_CONNECT_APPS_FLAG } from "../../shared/feature-flags";

export function meta() {
  return [{ title: "Connect apps — Dispatch" }];
}

function MarketplaceAppRow({ app }: { app: MarketplaceApp }) {
  const t = useT();
  const appUrl = normalizeConnectUrl(app.url);
  const canConnect = app.capabilities.includes("connect") && appUrl;
  if (!appUrl) return null;
  return (
    <div className="flex items-center gap-3 p-3">
      <AppIcon id={app.id} name={app.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {app.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {app.description}
        </div>
        {canConnect ? (
          <div className="text-xs text-muted-foreground">
            {t("dispatch.pages.connectAppGrant")}
          </div>
        ) : null}
      </div>
      {canConnect ? (
        <Button size="sm" variant="outline" asChild>
          <a
            href={buildIdentityConnectUrl(appUrl.toString())}
            rel="noopener noreferrer"
            target="_blank"
          >
            <IconPlugConnected size={15} />
            {t("dispatch.pages.connectApp")}
          </a>
        </Button>
      ) : (
        <Button size="sm" variant="ghost" asChild>
          <a href={appUrl.toString()} rel="noopener noreferrer" target="_blank">
            <IconExternalLink size={15} />
            {t("dispatch.pages.openApp")}
          </a>
        </Button>
      )}
    </div>
  );
}

function ConnectCard({
  card,
  appUrl,
}: {
  card: ConnectAgentCard;
  appUrl: string;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border p-4" data-connect-card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{card.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {card.description}
          </p>
        </div>
        {card.connect ? (
          <Button size="sm" asChild>
            <a
              href={buildIdentityConnectUrl(appUrl)}
              rel="noopener noreferrer"
              target="_blank"
            >
              <IconPlugConnected size={15} />
              {t("dispatch.pages.connectApp")}
            </a>
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {card.connect
          ? t("dispatch.pages.connectAppGrant")
          : t("dispatch.pages.connectAppUnsupported")}
      </p>
    </div>
  );
}

export default function ConnectRoute() {
  const enabled = useFeatureFlag(DISPATCH_CONNECT_APPS_FLAG.key);
  if (!enabled) return null;
  return <ConnectAppsContent />;
}

function ConnectAppsContent() {
  const t = useT();
  const [url, setUrl] = useState("");
  const [card, setCard] = useState<ConnectAgentCard | null>(null);
  const [cardError, setCardError] = useState(false);
  const [cardLoading, setCardLoading] = useState(false);
  const feedQuery = useQuery({
    queryKey: ["connect-apps-marketplace"],
    queryFn: () => fetchMarketplaceApps(),
    enabled: true,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const target = normalizeConnectUrl(url);

  async function inspectApp() {
    if (!target) return;
    setCardLoading(true);
    setCardError(false);
    setCard(null);
    try {
      setCard(await fetchConnectAgentCard(target.toString()));
    } catch {
      setCardError(true);
    } finally {
      setCardLoading(false);
    }
  }

  const apps = (feedQuery.data ?? []) as MarketplaceApp[];

  return (
    <DispatchShell title={t("dispatch.pages.connectApps")}>
      <div className="max-w-2xl space-y-6" data-connect-apps>
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <IconPlugConnected size={16} />
            <h2 className="text-sm font-semibold">
              {t("dispatch.pages.availableApps")}
            </h2>
          </div>
          {feedQuery.isLoading ? (
            <div className="h-16 animate-pulse rounded-lg border bg-muted/30" />
          ) : feedQuery.isError ? (
            <p
              className="rounded-lg border p-4 text-sm text-destructive"
              role="alert"
            >
              {t("dispatch.pages.appsLoadFailed")}
            </p>
          ) : apps.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {apps.map((app) => (
                <MarketplaceAppRow key={app.id} app={app} />
              ))}
            </div>
          ) : (
            <p
              className="rounded-lg border p-4 text-sm text-muted-foreground"
              role="status"
            >
              {t("dispatch.pages.noAppsAvailable")}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            {t("dispatch.pages.connectByUrl")}
          </h2>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setCard(null);
                setCardError(false);
              }}
              placeholder="https://example.com"
              aria-label={t("dispatch.pages.appUrl")}
            />
            <Button
              type="button"
              disabled={!target || cardLoading}
              onClick={() => void inspectApp()}
            >
              {t("dispatch.pages.inspectApp")}
            </Button>
          </div>
          {cardLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("dispatch.pages.inspectingApp")}
            </p>
          ) : cardError ? (
            <p className="text-sm text-destructive" role="alert">
              {t("dispatch.pages.appCardInvalid")}
            </p>
          ) : card && target ? (
            <ConnectCard card={card} appUrl={target.toString()} />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("dispatch.pages.connectAppsPrivacy")}
          </p>
        </section>
      </div>
    </DispatchShell>
  );
}
