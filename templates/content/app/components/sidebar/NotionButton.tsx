import { useState, useEffect, useCallback, useRef } from "react";
import {
  IconExternalLink,
  IconCheck,
  IconCircle,
  IconLoader2,
  IconUpload,
  IconPlugOff,
  IconRefresh,
  IconKey,
  IconGlobe,
  IconArrowLeft,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useNotionConnection, useDisconnectNotion } from "@/hooks/use-notion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Notion SVG icon ────────────────────────────────────────────────────────

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor">
      <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" />
      <path
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L75.99 3.147C71.717 0.033 69.97 -0.36 63.17 0.227L61.35 0.227zM25.723 19.043c-5.35 0.353 -6.567 0.433 -9.613 -1.993L8.95 11.467c-0.807 -0.777 -0.36 -1.75 1.163 -1.943l52.647 -3.887c4.473 -0.393 6.733 1.167 8.463 2.527l8.723 6.35c0.393 0.273 1.36 1.553 0.193 1.553l-54.637 3.18 0.22 -0.203zM19.457 88.3V35.507c0 -2.723 0.78 -4.017 3.3 -4.21l56.857 -3.307c2.333 -0.193 3.497 1.36 3.497 4.08v52.2c0 2.723 -0.39 5.053 -3.883 5.25l-54.053 3.11c-3.5 0.197 -5.717 -0.967 -5.717 -4.33zM71.9 38.587c0.39 1.75 0 3.5 -1.75 3.7l-2.72 0.533v38.503c-2.333 1.36 -4.473 2.14 -6.247 2.14 -2.913 0 -3.687 -0.78 -5.83 -3.5l-18.043 -28.357v27.39l5.637 1.36s0 3.5 -4.857 3.5l-13.393 0.78c-0.393 -0.78 0 -2.723 1.36 -3.11l3.497 -0.967v-36.17l-4.857 -0.393c-0.393 -1.75 0.583 -4.277 3.3 -4.473l14.367 -0.967 18.8 28.94v-25.64l-4.667 -0.583c-0.39 -2.143 1.163 -3.7 3.11 -3.887l13.297 -0.78z"
        fill="hsl(var(--popover))"
      />
    </svg>
  );
}

// ─── OAuth wizard steps ─────────────────────────────────────────────────────

const OAUTH_STEPS = [
  {
    title: "Create a Notion integration",
    description:
      'Go to Notion\'s developer portal, click "New integration", name it (e.g. "My Docs Sync"), and select your workspace.',
    url: "https://www.notion.so/profile/integrations",
    linkText: "Open Notion Integrations",
  },
  {
    title: "Configure as public integration",
    description:
      'Under "Distribution", toggle the integration to "Public". Then under "OAuth Domain & URIs", add this redirect URI:',
    showRedirectUri: true,
  },
  {
    title: "Copy OAuth credentials",
    description:
      'Under "OAuth Domain & URIs", copy the OAuth client ID and client secret. Then upload the JSON file or paste them below.',
    showUpload: true,
  },
  {
    title: "Connect your workspace",
    description:
      "Click the button below to authorize access to your Notion workspace. You'll be redirected to Notion to grant permission.",
    showConnect: true,
  },
];

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

type SetupMode = null | "api_key" | "oauth";

// ─── Component ──────────────────────────────────────────────────────────────

export function NotionButton() {
  const { data: connection, refetch } = useNotionConnection();
  const disconnectNotion = useDisconnectNotion();
  const [open, setOpen] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");

  const isConnected = connection?.connected ?? false;
  const needsCredentials = connection?.error === "missing_credentials";

  const fetchEnvStatus = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/env-status");
      if (res.ok) setEnvStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (showWizard) fetchEnvStatus();
  }, [showWizard, fetchEnvStatus]);

  const oauthConfigured =
    envStatus.filter((k) => k.key.startsWith("NOTION_CLIENT")).length > 0 &&
    envStatus
      .filter((k) => k.key.startsWith("NOTION_CLIENT"))
      .every((k) => k.configured);

  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/notion/callback`
      : "";

  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  function handleConnect() {
    if (!connection?.authUrl) {
      if (needsCredentials) {
        setShowWizard(true);
        return;
      }
      toast.error("Notion OAuth is not configured.");
      return;
    }
    window.open(connection.authUrl, "_blank");

    // Clear any existing poll before starting a new one
    if (pollRef.current) clearInterval(pollRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

    // Poll for connection
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/notion/status").catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.connected) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
          setShowWizard(false);
          setOpen(false);
          refetch();
        }
      }
    }, 2000);

    // Stop polling after 5 minutes
    pollTimeoutRef.current = setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = undefined;
    }, 300_000);
  }

  async function handleDisconnect() {
    try {
      await disconnectNotion.mutateAsync();
      toast.success("Disconnected Notion workspace.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect.");
    }
  }

  async function handleSaveApiKey() {
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error("Paste your integration token.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [{ key: "NOTION_API_KEY", value: key }],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      toast.success("Connected! Reloading...");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSaving(false);
    }
  }

  async function handleJsonUpload(file: File) {
    setSaving(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const clientId = json.client_id || json.oauth_client_id;
      const clientSecret = json.client_secret || json.oauth_client_secret;
      if (!clientId || !clientSecret) {
        throw new Error("Could not find client_id and client_secret in JSON");
      }
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [
            { key: "NOTION_CLIENT_ID", value: clientId },
            { key: "NOTION_CLIENT_SECRET", value: clientSecret },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }
      await fetchEnvStatus();
      toast.success("Credentials saved. Reloading...");
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse JSON");
    } finally {
      setSaving(false);
    }
  }

  // ─── Wizard UI ──────────────────────────────────────────────────────────

  if (showWizard) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title="Connect Notion"
            onClick={() => setOpen(true)}
          >
            <NotionIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={8}
          className="w-96 p-0 max-h-[80vh] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {setupMode && (
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setSetupMode(null)}
                  >
                    <IconArrowLeft size={14} />
                  </button>
                )}
                <h3 className="text-sm font-semibold">Connect Notion</h3>
              </div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowWizard(false);
                  setSetupMode(null);
                  setOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
            {!setupMode && (
              <p className="mt-1 text-xs text-muted-foreground">
                Choose how to connect your Notion workspace.
              </p>
            )}
          </div>

          {/* ─── Mode picker ─────────────────────────────────── */}
          {!setupMode && (
            <div className="p-3 space-y-2">
              <button
                className="w-full flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50"
                onClick={() => setSetupMode("api_key")}
              >
                <IconKey
                  size={16}
                  className="mt-0.5 shrink-0 text-foreground"
                />
                <div>
                  <p className="text-xs font-medium">API Key</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    Paste a token from a Notion internal integration. Simplest
                    setup — takes 2 minutes.
                  </p>
                </div>
              </button>
              <button
                className="w-full flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50"
                onClick={() => setSetupMode("oauth")}
              >
                <IconGlobe
                  size={16}
                  className="mt-0.5 shrink-0 text-foreground"
                />
                <div>
                  <p className="text-xs font-medium">OAuth Integration</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    Create a public Notion app with OAuth. Supports multi-user
                    access.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* ─── API IconKey setup ──────────────────────────────── */}
          {setupMode === "api_key" && (
            <div className="p-4 space-y-3">
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">
                    1
                  </span>
                  <div>
                    <p className="text-xs font-medium">
                      Create an internal integration
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                      Go to Notion's integrations page, click "New integration",
                      name it, and select your workspace.
                    </p>
                    <a
                      href="https://www.notion.so/profile/integrations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                    >
                      <IconExternalLink size={11} />
                      Open Notion Integrations
                    </a>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">
                    2
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">
                      Share pages with the integration
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                      Open a Notion page, click "..." → "Connections" → add your
                      integration. Repeat for each page you want to sync.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">
                    3
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">
                      Paste your integration token
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                      Copy the "Internal Integration Secret" from the
                      integration's settings page.
                    </p>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveApiKey();
                      }}
                      placeholder="ntn_..."
                      className="mt-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-mono placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              <Button
                size="sm"
                className="w-full"
                disabled={!apiKeyInput.trim() || saving}
                onClick={handleSaveApiKey}
              >
                {saving ? (
                  <>
                    <IconLoader2 size={12} className="mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
            </div>
          )}

          {/* ─── OAuth setup ────────────────────────────────── */}
          {setupMode === "oauth" && (
            <div className="p-4 space-y-3">
              {OAUTH_STEPS.map((step, i) => {
                const completed =
                  i < currentStep || (i === 2 && oauthConfigured);
                const active = i === currentStep;

                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border px-3 py-2.5",
                      active
                        ? "border-border bg-muted/50"
                        : "border-transparent",
                    )}
                  >
                    <button
                      className="flex items-start gap-2 w-full text-left"
                      onClick={() => setCurrentStep(i)}
                    >
                      <span className="mt-0.5 shrink-0">
                        {completed ? (
                          <IconCheck size={14} className="text-emerald-500" />
                        ) : active ? (
                          <IconCircle
                            size={14}
                            className="text-foreground"
                            fill="currentColor"
                          />
                        ) : (
                          <IconCircle
                            size={14}
                            className="text-muted-foreground"
                          />
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          active
                            ? "text-foreground"
                            : completed
                              ? "text-muted-foreground"
                              : "text-muted-foreground",
                        )}
                      >
                        {step.title}
                      </span>
                    </button>

                    {active && (
                      <div className="mt-2 ml-5 space-y-2">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {step.description}
                        </p>

                        {step.url && (
                          <a
                            href={step.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <IconExternalLink size={11} />
                            {step.linkText}
                          </a>
                        )}

                        {step.showRedirectUri && (
                          <div className="flex items-center gap-1">
                            <code className="flex-1 rounded bg-muted px-2 py-1 text-[10px] font-mono text-foreground break-all">
                              {redirectUri}
                            </code>
                            <button
                              className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent"
                              onClick={() => {
                                navigator.clipboard.writeText(redirectUri);
                                toast.success("Copied!");
                              }}
                            >
                              Copy
                            </button>
                          </div>
                        )}

                        {step.showUpload && (
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                              <IconUpload size={14} />
                              {saving ? "Saving..." : "Upload credentials JSON"}
                              <input
                                type="file"
                                accept=".json"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleJsonUpload(file);
                                }}
                              />
                            </label>
                            {envStatus
                              .filter((k) => k.key.startsWith("NOTION_CLIENT"))
                              .map((k) => (
                                <div
                                  key={k.key}
                                  className="flex items-center gap-2 text-[10px]"
                                >
                                  {k.configured ? (
                                    <IconCheck
                                      size={10}
                                      className="text-emerald-500"
                                    />
                                  ) : (
                                    <IconCircle
                                      size={10}
                                      className="text-muted-foreground"
                                    />
                                  )}
                                  <span className="text-muted-foreground">
                                    {k.label}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}

                        {step.showConnect && (
                          <Button
                            size="sm"
                            onClick={handleConnect}
                            disabled={!oauthConfigured}
                            className="w-full"
                          >
                            {oauthConfigured ? (
                              "Connect Notion Workspace"
                            ) : (
                              <>
                                <IconLoader2
                                  size={12}
                                  className="mr-1 animate-spin"
                                />
                                Complete steps above first
                              </>
                            )}
                          </Button>
                        )}

                        {i < OAUTH_STEPS.length - 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs"
                            onClick={() => setCurrentStep(i + 1)}
                          >
                            Next step
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  // ─── Connected state ────────────────────────────────────────────────────

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-7 h-7 flex items-center justify-center rounded hover:bg-accent",
            isConnected
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={
            isConnected
              ? `Notion: ${connection?.workspaceName ?? "Connected"}`
              : "Connect Notion"
          }
        >
          <NotionIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-64 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {isConnected ? (
          <>
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <NotionIcon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {connection?.workspaceName ?? "Notion"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Connected
                    {connection?.mode === "api_key" ? " via API key" : ""}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => {
                  refetch();
                  toast.success("Synced");
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
              >
                <IconRefresh size={12} />
                Refresh connection
              </button>
              <button
                onClick={() => {
                  handleDisconnect();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md"
              >
                <IconPlugOff size={12} />
                Disconnect workspace
              </button>
            </div>
          </>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <NotionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm font-medium">Connect Notion</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Sync documents with your Notion workspace.
            </p>
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                if (needsCredentials) {
                  setShowWizard(true);
                } else {
                  handleConnect();
                }
              }}
            >
              {needsCredentials ? "Set up Notion" : "Connect Workspace"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
