import { useState, useEffect, useCallback, useRef } from "react";
import {
  IconExternalLink,
  IconCheck,
  IconCircle,
  IconLoader2,
  IconUpload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

const STEPS = [
  {
    title: "Enable the Google Calendar API",
    description:
      "Open Google Cloud Console and click 'Enable' on the Calendar API.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com",
    linkText: "Enable Calendar API",
  },
  {
    title: "Configure OAuth consent screen",
    description:
      'Set the app name to anything (e.g. "My Calendar"), choose "External" user type, and add your email as a test user. If you see an overview page, consent is already configured — skip to the next step.',
    url: "https://console.cloud.google.com/apis/credentials/consent",
    linkText: "Configure consent screen",
  },
  {
    title: "Create OAuth credentials",
    description:
      '1) Click "+ Create Credentials" → "OAuth client ID"\n2) Choose "Web application"\n3) Add this redirect URI:',
    url: "https://console.cloud.google.com/apis/credentials",
    linkText: "Create credentials",
    showRedirectUri: true,
  },
  {
    title: "Upload credentials JSON",
    description:
      'Click "Download JSON" on the credentials page, then upload it here. Or paste the Client ID and Client Secret manually.',
    showUpload: true,
  },
];

export function GoogleSetupWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);
  const [showManualFields, setShowManualFields] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const redirectUri = `${typeof window !== "undefined" ? window.location.origin : ""}/_agent-native/google/callback`;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/env-status");
      if (res.ok) {
        const data: EnvKeyStatus[] = await res.json();
        setEnvStatus(data);
        const allConfigured = data.every((k) => k.configured);
        if (allConfigured && data.length > 0) {
          setSaved(true);
          setCurrentStep(STEPS.length - 1);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const allConfigured =
    envStatus.length > 0 && envStatus.every((k) => k.configured);

  async function handleJsonUpload(file: File) {
    setSaving(true);
    setError(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      // Google's downloaded JSON has the credentials nested under "web" or "installed"
      const creds = json.web || json.installed || json;
      const id = creds.client_id;
      const secret = creds.client_secret;

      if (!id || !secret) {
        throw new Error("Could not find client_id and client_secret in JSON");
      }

      const res = await fetch("/api/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [
            { key: "GOOGLE_CLIENT_ID", value: id },
            { key: "GOOGLE_CLIENT_SECRET", value: secret },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }

      setSaved(true);
      await fetchStatus();
      // Reload after a short delay to let Vite restart with new env vars
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse JSON");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [
            { key: "GOOGLE_CLIENT_ID", value: clientId.trim() },
            { key: "GOOGLE_CLIENT_SECRET", value: clientSecret.trim() },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }

      setSaved(true);
      setClientId("");
      setClientSecret("");
      await fetchStatus();
      // Reload after a short delay to let Vite restart with new env vars
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div className="space-y-4">
      {STEPS.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted =
          i < currentStep || (i === STEPS.length - 1 && saved);

        return (
          <div
            key={i}
            role="button"
            tabIndex={0}
            className={`w-full text-left rounded-lg border p-4 transition-colors cursor-pointer ${
              isActive
                ? "border-primary/40 bg-primary/5"
                : isCompleted
                  ? "border-border bg-accent"
                  : "border-border/50 opacity-50"
            }`}
            onClick={() => !saved && setCurrentStep(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                !saved && setCurrentStep(i);
              }
            }}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {isCompleted ? (
                  <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : isActive ? (
                  <IconCircle className="h-4 w-4 text-primary fill-primary" />
                ) : (
                  <IconCircle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                  {step.title}
                </p>

                {isActive && (
                  <div className="mt-2 space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                      {step.description}
                    </p>

                    {step.showRedirectUri && (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all select-all">
                          {redirectUri}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 text-xs h-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(redirectUri, "redirect");
                          }}
                        >
                          {copiedKey === "redirect" ? (
                            <>
                              <IconCheck className="h-3 w-3" />
                              Copied
                            </>
                          ) : (
                            "Copy"
                          )}
                        </Button>
                      </div>
                    )}

                    {step.url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs h-7"
                        asChild
                      >
                        <a
                          href={step.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (i < STEPS.length - 1) {
                              setCurrentStep(i + 1);
                            }
                          }}
                        >
                          <IconExternalLink className="h-3 w-3" />
                          {step.linkText}
                        </a>
                      </Button>
                    )}

                    {step.showUpload && !allConfigured && (
                      <div
                        className="space-y-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".json"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleJsonUpload(file);
                          }}
                        />
                        {error && (
                          <p className="text-xs text-destructive">{error}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            disabled={saving}
                          >
                            {saving ? (
                              <IconLoader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <IconUpload className="h-3 w-3" />
                            )}
                            {saving ? "Saving..." : "Upload JSON"}
                          </Button>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowManualFields(!showManualFields);
                            }}
                          >
                            {showManualFields
                              ? "Hide manual entry"
                              : "Or paste manually"}
                          </button>
                        </div>

                        {showManualFields && (
                          <div className="space-y-3 pt-1">
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="client-id"
                                className="text-xs text-muted-foreground"
                              >
                                Client ID
                              </Label>
                              <Input
                                id="client-id"
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                placeholder="123456789.apps.googleusercontent.com"
                                className="text-xs h-8 font-mono"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="client-secret"
                                className="text-xs text-muted-foreground"
                              >
                                Client Secret
                              </Label>
                              <Input
                                id="client-secret"
                                type="password"
                                value={clientSecret}
                                onChange={(e) =>
                                  setClientSecret(e.target.value)
                                }
                                placeholder="GOCSPX-..."
                                className="text-xs h-8 font-mono"
                              />
                            </div>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSave();
                              }}
                              disabled={
                                saving ||
                                !clientId.trim() ||
                                !clientSecret.trim()
                              }
                            >
                              {saving && (
                                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                              )}
                              {saving ? "Saving..." : "Save credentials"}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {step.showUpload && allConfigured && (
                      <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                        <IconCheck className="h-3.5 w-3.5" />
                        Credentials configured. You can now connect your Google
                        Calendar above.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
