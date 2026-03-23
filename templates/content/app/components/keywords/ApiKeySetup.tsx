import { useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { Key, X, ExternalLink, Check, Loader2 } from "lucide-react";
import { useKeywordApiStatus } from "@/hooks/use-keywords";
import { useQueryClient } from "@tanstack/react-query";

interface ApiKeySetupProps {
  onClose: () => void;
}

export function ApiKeySetup({ onClose }: ApiKeySetupProps) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { data: status } = useKeywordApiStatus();
  const qc = useQueryClient();

  const handleSave = async () => {
    if (!login.trim() || !password.trim()) {
      setError("Both login and password are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/keywords/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: login.trim(),
          password: password.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }
      setSuccess(true);
      qc.invalidateQueries({ queryKey: ["keywordApiStatus"] });
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            DataForSEO API
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {status?.configured && (
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-md bg-green-500/10 text-green-500 text-xs">
          <Check size={13} />
          <span>DataForSEO API is connected and active</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        Connect your{" "}
        <a
          href="https://app.dataforseo.com/api-access"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-2 hover:no-underline inline-flex items-center gap-0.5"
        >
          DataForSEO credentials <ExternalLink size={10} />
        </a>{" "}
        to enrich keyword suggestions with search volume, competition, and CPC
        data.
      </p>

      <div className="space-y-2">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            API Login
          </label>
          <input
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="your@email.com"
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            API Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your API password"
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="flex justify-end mt-3">
        <button
          onClick={handleSave}
          disabled={saving || success}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {success && <Check size={12} />}
          {success ? "Saved" : saving ? "Validating..." : "Save Credentials"}
        </button>
      </div>
    </div>
  );
}
