import { useState, useRef, useCallback } from "react";
import {
  IconX,
  IconCheck,
  IconLoader2,
  IconDatabase,
  IconCloud,
  IconChevronRight,
} from "@tabler/icons-react";

interface CloudUpgradeProps {
  title?: string;
  description?: string;
  onClose?: () => void;
}

interface Provider {
  id: string;
  name: string;
  description: string;
  urlPrefix: string;
  needsAuthToken: boolean;
  steps: string[];
}

const PROVIDERS: Provider[] = [
  {
    id: "turso",
    name: "Turso",
    description: "SQLite at the edge",
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
    description: "Serverless Postgres",
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
    description: "Open source Firebase alternative",
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
    name: "Cloudflare D1",
    description: "SQLite on Cloudflare's edge",
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
  title = "Share Publicly",
  description = "To share content publicly, connect a cloud database.",
  onClose,
}: CloudUpgradeProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [dbUrl, setDbUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [status, setStatus] = useState<
    "idle" | "saving" | "polling" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const connectingRef = useRef(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider);

  const handleConnect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;

    if (!dbUrl.trim()) {
      setErrorMsg("Database URL is required");
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

      const saveRes = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }

      // Poll db-health until it returns ok
      setStatus("polling");
      let ok = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const healthRes = await fetch("/api/db-health");
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
        throw new Error(
          "Database connection failed after 30 attempts. Check your credentials.",
        );
      }

      setStatus("success");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Connection failed");
      setStatus("error");
    } finally {
      connectingRef.current = false;
    }
  }, [dbUrl, authToken]);

  const isConnecting = status === "saving" || status === "polling";

  return (
    <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <IconCloud className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>

      <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
        {description}
      </p>

      {/* Provider selection */}
      <div className="mb-5 grid grid-cols-2 gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedProvider(p.id)}
            className={`flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors ${
              selectedProvider === p.id
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
            }`}
          >
            <span
              className={`text-sm font-medium ${
                selectedProvider === p.id
                  ? "text-blue-700 dark:text-blue-300"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {p.name}
            </span>
            <span className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {p.description}
            </span>
          </button>
        ))}
      </div>

      {/* Provider setup steps */}
      {provider && (
        <div className="mb-5 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Setup steps
          </p>
          <ol className="space-y-1">
            {provider.steps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300"
              >
                <IconChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" />
                <span className="font-mono">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Credential inputs */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            DATABASE_URL
          </label>
          <input
            type="text"
            placeholder={
              provider?.urlPrefix
                ? `${provider.urlPrefix}...`
                : "libsql://... or postgres://..."
            }
            value={dbUrl}
            onChange={(e) => setDbUrl(e.target.value)}
            disabled={isConnecting}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>

        {(!provider || provider.needsAuthToken) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              DATABASE_AUTH_TOKEN
              {provider && !provider.needsAuthToken && (
                <span className="ml-1 text-zinc-400">(optional)</span>
              )}
            </label>
            <input
              type="password"
              placeholder="Auth token"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              disabled={isConnecting}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>
        )}
      </div>

      {/* Error message */}
      {status === "error" && errorMsg && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">
          {errorMsg}
        </p>
      )}

      {/* Success message */}
      {status === "success" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <IconCheck className="h-3.5 w-3.5" />
          <span>Connected successfully. Reloading...</span>
        </div>
      )}

      {/* Connect button */}
      <button
        onClick={handleConnect}
        disabled={isConnecting || !dbUrl.trim() || status === "success"}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isConnecting ? (
          <>
            <IconLoader2 className="h-4 w-4 animate-spin" />
            <span>
              {status === "saving"
                ? "Saving credentials..."
                : "Testing connection..."}
            </span>
          </>
        ) : (
          <>
            <IconDatabase className="h-4 w-4" />
            <span>Test & Connect</span>
          </>
        )}
      </button>
    </div>
  );
}
