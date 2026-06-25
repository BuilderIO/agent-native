import { agentNativePath, appApiPath, useT } from "@agent-native/core/client";
import {
  IconCheck,
  IconLoader2,
  IconDatabase,
  IconCloud,
  IconChevronRight,
} from "@tabler/icons-react";
import { useState, useRef, useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface CloudUpgradeProps {
  title?: string;
  description?: string;
  onClose?: () => void;
}

interface Provider {
  id: string;
  name?: string;
  nameKey?: string;
  descriptionKey: string;
  urlPrefix: string;
  needsAuthToken: boolean;
  steps: string[];
}

const PROVIDERS: Provider[] = [
  {
    id: "turso",
    name: "Turso",
    descriptionKey: "cloudUpgrade.providerDescriptions.turso",
    urlPrefix: "libsql://",
    needsAuthToken: true,
    steps: [
      "Install CLI: curl -sSfL https://get.tur.so/install.sh | bash",
      "Sign up / login: turso auth login (opens browser)",
      "Create a database: turso db create my-app",
      "Copy the URL: turso db show my-app --url → starts with libsql://",
      "Create an auth token: turso db tokens create my-app → paste below",
    ],
  },
  {
    id: "neon",
    name: "Neon",
    descriptionKey: "cloudUpgrade.providerDescriptions.neon",
    urlPrefix: "postgres://",
    needsAuthToken: false,
    steps: [
      "Go to console.neon.tech and sign up or log in",
      'Click "New Project" → pick a name and region → click Create',
      "On the project dashboard, find the Connection Details panel",
      'Select "Connection string" tab → copy the postgres://... URL',
      "Paste the full connection string (includes password) below",
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    descriptionKey: "cloudUpgrade.providerDescriptions.supabase",
    urlPrefix: "postgres://",
    needsAuthToken: false,
    steps: [
      "Go to supabase.com/dashboard and sign up or log in",
      'Click "New Project" → set a name and database password → click Create',
      "Wait for the project to finish provisioning (~30 seconds)",
      "Go to Project Settings → Database → Connection string",
      'Select "URI" tab → copy the postgres://... string (replace [YOUR-PASSWORD] with your DB password)',
    ],
  },
  {
    id: "d1",
    nameKey: "cloudUpgrade.providerNames.d1",
    descriptionKey: "cloudUpgrade.providerDescriptions.d1",
    urlPrefix: "d1://",
    needsAuthToken: true,
    steps: [
      "Go to dash.cloudflare.com → Workers & Pages → D1 SQL Database",
      'Click "Create" → name your database → click Create',
      "Copy the Database ID from the database overview page",
      "For the auth token: go to My Profile → API Tokens → Create Token",
      'Select "Edit Cloudflare Workers" template → Create Token → copy it',
      "Paste as: d1://<database-id> with the API token below",
    ],
  },
];

export function CloudUpgrade({
  title,
  description,
  onClose,
}: CloudUpgradeProps) {
  const t = useT();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [dbUrl, setDbUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "polling" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const connectingRef = useRef(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider);
  const providerName = (provider: Provider) =>
    provider.nameKey ? t(provider.nameKey) : (provider.name ?? provider.id);

  const handleConnect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;

    if (!dbUrl.trim()) {
      setErrorMsg(t("cloudUpgrade.databaseUrlRequired"));
      setStatus("error");
      connectingRef.current = false;
      return;
    }

    try {
      setStatus("saving");
      setErrorMsg("");

      const vars: Array<{ key: string; value: string }> = [
        { key: "DATABASE_URL", value: dbUrl.trim() },
      ];
      if (authToken.trim()) {
        vars.push({ key: "DATABASE_AUTH_TOKEN", value: authToken.trim() });
      }

      const saveRes = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        throw new Error(data.error || t("cloudUpgrade.saveCredentialsFailed"));
      }

      // Poll db-health until it returns ok
      setStatus("polling");
      let ok = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const healthRes = await fetch(appApiPath("/api/db-health"));
          const health = await healthRes.json();
          if (health.ok && health.local === false) {
            ok = true;
            break;
          }
        } catch {
          // Keep polling
        }
      }

      if (!ok) {
        throw new Error(t("cloudUpgrade.connectionFailedAfterAttempts"));
      }

      setStatus("success");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : t("cloudUpgrade.connectionFailed"),
      );
      setStatus("error");
    } finally {
      connectingRef.current = false;
    }
  }, [dbUrl, authToken, t]);

  const isConnecting = status === "saving" || status === "polling";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <IconCloud className="h-5 w-5 text-primary" />
            <DialogTitle>
              {title ?? t("cloudUpgrade.sharePublicly")}
            </DialogTitle>
          </div>
          <DialogDescription>
            {description ?? t("cloudUpgrade.sharePubliclyDescription")}
          </DialogDescription>
        </DialogHeader>

        {/* Provider selection */}
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p.id)}
              className={cn(
                "flex flex-col items-start rounded-lg border px-3 py-2.5 text-left min-h-[44px]",
                selectedProvider === p.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30",
              )}
            >
              <span
                className={cn(
                  "text-sm font-medium",
                  selectedProvider === p.id
                    ? "text-primary"
                    : "text-foreground",
                )}
              >
                {providerName(p)}
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                {t(p.descriptionKey)}
              </span>
            </button>
          ))}
        </div>

        {/* Provider setup steps */}
        {provider && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("cloudUpgrade.setupSteps")}
            </p>
            <ol className="space-y-1">
              {provider.steps.map((step, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <IconChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="font-mono break-words">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Credential inputs */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">DATABASE_URL</Label>
            <Input
              placeholder={
                provider?.urlPrefix
                  ? `${provider.urlPrefix}...`
                  : "libsql://... or postgres://..."
              }
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              disabled={isConnecting}
              className="text-sm"
            />
          </div>

          {(!provider || provider.needsAuthToken) && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                DATABASE_AUTH_TOKEN
                {provider && !provider.needsAuthToken && (
                  <span className="ml-1 text-muted-foreground">
                    ({t("common.optional")})
                  </span>
                )}
              </Label>
              <Input
                type="password"
                placeholder={t("cloudUpgrade.authToken")}
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                disabled={isConnecting}
                className="text-sm"
              />
            </div>
          )}
        </div>

        {/* Error message */}
        {status === "error" && errorMsg && (
          <p className="text-xs text-destructive">{errorMsg}</p>
        )}

        {/* Success message */}
        {status === "success" && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <IconCheck className="h-3.5 w-3.5" />
            <span>{t("cloudUpgrade.connectedReloading")}</span>
          </div>
        )}

        {/* Connect button */}
        <Button
          onClick={handleConnect}
          disabled={isConnecting || !dbUrl.trim() || status === "success"}
          className="w-full gap-2"
        >
          {isConnecting ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              <span>
                {status === "saving"
                  ? t("cloudUpgrade.savingCredentials")
                  : t("cloudUpgrade.testingConnection")}
              </span>
            </>
          ) : (
            <>
              <IconDatabase className="h-4 w-4" />
              <span>{t("cloudUpgrade.testAndConnect")}</span>
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
