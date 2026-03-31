import { useState } from "react";
import { useGreenhouseConnect } from "@/hooks/use-greenhouse";
import {
  IconPlant2,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";

export function OnboardingScreen() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const connect = useGreenhouseConnect();

  const handleConnect = () => {
    if (!apiKey.trim()) return;
    connect.mutate(apiKey.trim());
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="w-full max-w-md px-6">
        {/* Icon */}
        <div className="mb-8 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-600/10">
            <IconPlant2 className="h-7 w-7 text-green-600" />
          </div>
        </div>

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Connect to Greenhouse
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Enter your Greenhouse Harvest API key to sync your recruiting data.
            You'll get AI-powered resume analysis, candidate comparison, and
            more.
          </p>
        </div>

        {/* Instructions */}
        <div className="mb-6 rounded-lg border border-border/60 bg-muted/30 p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Where to find your API key
          </p>
          <ol className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-foreground/60 font-medium">1.</span>
              Go to Greenhouse &rarr; Configure &rarr; Dev Center
            </li>
            <li className="flex gap-2">
              <span className="text-foreground/60 font-medium">2.</span>
              Click "API Credential Management"
            </li>
            <li className="flex gap-2">
              <span className="text-foreground/60 font-medium">3.</span>
              Create or copy a Harvest API key
            </li>
          </ol>
          <a
            href="https://support.greenhouse.io/hc/en-us/articles/202842799"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-500"
          >
            Greenhouse documentation
            <IconExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Input */}
        <div className="mb-4">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="Paste your Harvest API key"
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-green-600/50 focus:ring-1 focus:ring-green-600/30"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? (
                <IconEyeOff className="h-4 w-4" />
              ) : (
                <IconEye className="h-4 w-4" />
              )}
            </button>
          </div>

          {connect.isError && (
            <p className="mt-2 text-xs text-destructive">
              {connect.error?.message ||
                "Invalid API key. Please check your credentials."}
            </p>
          )}
        </div>

        {/* Button */}
        <button
          onClick={handleConnect}
          disabled={!apiKey.trim() || connect.isPending}
          className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {connect.isPending ? (
            <>
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : connect.isSuccess ? (
            <>
              <IconCheck className="h-4 w-4" />
              Connected
            </>
          ) : (
            "Connect"
          )}
        </button>

        <p className="mt-4 text-center text-xs text-muted-foreground/60">
          Your API key is stored securely and never shared.
        </p>
      </div>
    </div>
  );
}
