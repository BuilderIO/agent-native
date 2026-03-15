import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Check, Circle, Loader2 } from "lucide-react";
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
    description: "Open Google Cloud Console and click 'Enable' on the Calendar API.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com",
    linkText: "Enable Calendar API",
  },
  {
    title: "Configure OAuth consent screen",
    description:
      'Set the app name to anything (e.g. "My Calendar"), choose "External" user type, and add your email as a test user.',
    url: "https://console.cloud.google.com/auth/branding",
    linkText: "Configure consent screen",
  },
  {
    title: "Create OAuth credentials",
    description:
      'Click "Create OAuth client", choose "Web application", and add this redirect URI:',
    url: "https://console.cloud.google.com/apis/credentials/oauthclient",
    linkText: "Create credentials",
    showRedirectUri: true,
  },
  {
    title: "Paste your credentials",
    description: "Copy the Client ID and Client Secret from the previous step.",
    showInputs: true,
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

  const redirectUri = `${window.location.origin}/api/google/callback`;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/env-status");
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

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/env-vars", {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function copyRedirectUri() {
    navigator.clipboard.writeText(redirectUri);
  }

  return (
    <div className="space-y-4">
      {STEPS.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep || (i === STEPS.length - 1 && saved);

        return (
          <div
            key={i}
            role="button"
            tabIndex={0}
            className={`w-full text-left rounded-lg border p-4 transition-colors cursor-pointer ${
              isActive
                ? "border-primary/40 bg-primary/5"
                : isCompleted
                  ? "border-green-500/20 bg-green-500/5"
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
                  <Check className="h-4 w-4 text-green-500" />
                ) : isActive ? (
                  <Circle className="h-4 w-4 text-primary fill-primary" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground mr-1.5">
                    {i + 1}.
                  </span>
                  {step.title}
                </p>

                {isActive && (
                  <div className="mt-2 space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>

                    {step.showRedirectUri && (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                          {redirectUri}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 text-xs h-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyRedirectUri();
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                    )}

                    {step.url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(step.url, "_blank");
                          if (i < STEPS.length - 1) {
                            setCurrentStep(i + 1);
                          }
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {step.linkText}
                      </Button>
                    )}

                    {step.showInputs && !allConfigured && (
                      <div
                        className="space-y-3"
                        onClick={(e) => e.stopPropagation()}
                      >
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
                            onChange={(e) => setClientSecret(e.target.value)}
                            placeholder="GOCSPX-..."
                            className="text-xs h-8 font-mono"
                          />
                        </div>
                        {error && (
                          <p className="text-xs text-destructive">{error}</p>
                        )}
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
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          )}
                          {saving ? "Saving..." : "Save credentials"}
                        </Button>
                      </div>
                    )}

                    {step.showInputs && allConfigured && (
                      <div className="flex items-center gap-2 text-xs text-green-500">
                        <Check className="h-3.5 w-3.5" />
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
