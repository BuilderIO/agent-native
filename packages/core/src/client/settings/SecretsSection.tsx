/**
 * <SecretsSection /> — renders the registered secrets from the framework
 * secrets registry. Fetches `/_agent-native/secrets` on mount and shows a
 * card per secret with a masked input + Save / Rotate / Delete / Test
 * buttons (api-key kind) or a Connect / Disconnect button (oauth kind).
 */

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { agentNativePath } from "../api-path.js";
import {
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconPlugConnected,
  IconPlus,
  IconTrash,
  IconRefresh,
} from "@tabler/icons-react";

interface SecretStatus {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  scope: "user" | "workspace";
  kind: "api-key" | "oauth";
  required: boolean;
  status: "set" | "unset" | "invalid";
  last4?: string;
  updatedAt?: number;
  oauthProvider?: string;
  oauthConnectUrl?: string;
  error?: string;
}

const ENDPOINT = agentNativePath("/_agent-native/secrets");

export interface SecretsSectionProps {
  /** Optional hash fragment to focus a specific secret (e.g. "secrets:OPENAI_API_KEY"). */
  focusKey?: string;
}

export function SecretsSection({ focusKey }: SecretsSectionProps) {
  const [secrets, setSecrets] = useState<SecretStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(ENDPOINT)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Failed to load secrets (${r.status})`);
        }
        return (await r.json()) as SecretStatus[];
      })
      .then((data) => {
        if (!cancelled) setSecrets(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  if (error) {
    return (
      <p className="text-[10px] text-red-500">
        Failed to load secrets: {error}
      </p>
    );
  }
  if (secrets === null) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <IconLoader2 size={10} className="animate-spin" />
        Loading…
      </div>
    );
  }
  if (secrets.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">
          No secrets registered yet. Templates register API keys and connections
          via <code>registerRequiredSecret()</code>.
        </p>
        <AdHocKeysSection />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {secrets.map((secret) => (
        <SecretCard
          key={secret.key}
          secret={secret}
          onChanged={reload}
          focusInput={focusKey === secret.key}
        />
      ))}
      <AdHocKeysSection />
    </div>
  );
}

interface SecretCardProps {
  secret: SecretStatus;
  onChanged: () => void;
  focusInput?: boolean;
}

function SecretCard({ secret, onChanged, focusInput }: SecretCardProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<null | "save" | "delete" | "test">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [focusInput]);

  const setToastAndClear = (kind: "ok" | "err", text: string, ms = 2500) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), ms);
  };

  const handleSave = async () => {
    if (!value.trim() || busy) return;
    setBusy("save");
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(secret.key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: value.trim() }),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        setToastAndClear("err", err ?? `Save failed (${res.status})`);
        return;
      }
      setValue("");
      setConfirmDelete(false);
      setToastAndClear("ok", "Saved");
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy("delete");
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(secret.key)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        setToastAndClear("err", err ?? `Delete failed (${res.status})`);
        return;
      }
      setToastAndClear("ok", "Removed");
      setConfirmDelete(false);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    if (busy) return;
    setBusy("test");
    try {
      const res = await fetch(
        `${ENDPOINT}/${encodeURIComponent(secret.key)}/test`,
        {
          method: "POST",
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && body.ok) {
        setToastAndClear("ok", "Working");
      } else {
        setToastAndClear(
          "err",
          body.error ?? (body.ok === false ? "Invalid" : `Test failed`),
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const pill = useMemo(() => {
    if (secret.status === "set") {
      return (
        <span className="flex items-center gap-1 text-[10px] text-green-500">
          <IconCheck size={10} />
          Set
        </span>
      );
    }
    if (secret.required) {
      return (
        <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-500">
          Required
        </span>
      );
    }
    return (
      <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Optional
      </span>
    );
  }, [secret.status, secret.required]);

  const isOAuth = secret.kind === "oauth";

  return (
    <div className="rounded-md border border-border px-2.5 py-2 bg-accent/30">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-foreground truncate">
            {secret.label}
          </div>
          {secret.description && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {secret.description}
            </p>
          )}
        </div>
        <div className="shrink-0">{pill}</div>
      </div>

      {isOAuth ? (
        <div className="mt-2 flex items-center gap-1.5">
          {secret.oauthConnectUrl && (
            <a
              href={secret.oauthConnectUrl}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium no-underline"
              style={{ backgroundColor: "#625DF5", color: "white" }}
            >
              <IconPlugConnected size={10} />
              {secret.status === "set" ? "Reconnect" : "Connect"}
            </a>
          )}
          {secret.docsUrl && (
            <a
              href={secret.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] no-underline text-muted-foreground hover:text-foreground"
            >
              Docs
              <IconExternalLink size={10} />
            </a>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {secret.status === "set" && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Stored value ending in</span>
              <code className="rounded bg-background px-1 py-0.5 text-foreground">
                {secret.last4}
              </code>
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              placeholder={
                secret.status === "set"
                  ? "Enter new value to rotate"
                  : "Paste key"
              }
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!value.trim() || busy !== null}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40"
              style={{ backgroundColor: "#625DF5", color: "white" }}
            >
              {busy === "save" ? (
                <IconLoader2 size={10} className="animate-spin" />
              ) : secret.status === "set" ? (
                <>
                  <IconRefresh size={10} />
                  Rotate
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {secret.status === "set" && (
              <>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {busy === "test" ? (
                    <IconLoader2 size={10} className="animate-spin" />
                  ) : (
                    "Test"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-red-500 disabled:opacity-40"
                >
                  <IconTrash size={10} />
                  Remove
                </button>
              </>
            )}
            {secret.docsUrl && (
              <a
                href={secret.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] no-underline text-muted-foreground hover:text-foreground ml-auto"
              >
                Get key
                <IconExternalLink size={10} />
              </a>
            )}
          </div>
          {confirmDelete && (
            <div className="flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-500">
              <span className="min-w-0 flex-1">Remove this saved value?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded border border-red-500/40 px-1.5 py-0.5 font-medium disabled:opacity-40"
              >
                {busy === "delete" ? (
                  <IconLoader2 size={10} className="animate-spin" />
                ) : (
                  "Confirm"
                )}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy !== null}
                className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {toast && (
        <p
          className={`mt-1.5 text-[10px] ${
            toast.kind === "ok" ? "text-green-500" : "text-red-500"
          }`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}

// ─── Ad-hoc Keys Section ──────────────────────────────────────────────────

interface AdHocKey {
  name: string;
  scope: "user" | "workspace";
  scopeId: string;
  description: string | null;
  last4: string;
  createdAt: number;
  updatedAt: number;
}

const ADHOC_ENDPOINT = agentNativePath("/_agent-native/secrets/adhoc");

function AdHocKeysSection() {
  const [keys, setKeys] = useState<AdHocKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formScope, setFormScope] = useState<"user" | "workspace">("user");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(
    null,
  );
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const showToast = useCallback(
    (kind: "ok" | "err", text: string, ms = 2500) => {
      setToast({ kind, text });
      setTimeout(() => setToast(null), ms);
    },
    [],
  );

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(ADHOC_ENDPOINT)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return (await r.json()) as AdHocKey[];
      })
      .then((data) => {
        if (!cancelled) {
          setKeys(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKeys([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const resetForm = useCallback(() => {
    setShowForm(false);
    setFormName("");
    setFormValue("");
    setFormDescription("");
    setFormScope("user");
    setFormError(null);
  }, []);

  const handleAdd = useCallback(async () => {
    const name = formName.trim();
    const value = formValue.trim();
    if (!name || !value || formBusy) return;
    setFormBusy(true);
    setFormError(null);
    try {
      const res = await fetch(ADHOC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          value,
          description: formDescription.trim() || undefined,
          scope: formScope,
        }),
      });
      if (!res.ok) {
        const body = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        setFormError(body ?? `Save failed (${res.status})`);
        return;
      }
      resetForm();
      showToast("ok", "Key saved");
      reload();
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to save");
    } finally {
      setFormBusy(false);
    }
  }, [
    formName,
    formValue,
    formDescription,
    formScope,
    formBusy,
    resetForm,
    showToast,
    reload,
  ]);

  const handleDelete = useCallback(
    async (name: string) => {
      setDeletingName(name);
      try {
        const res = await fetch(
          `${ADHOC_ENDPOINT}/${encodeURIComponent(name)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
          },
        );
        if (!res.ok) {
          showToast("err", "Failed to delete key");
          return;
        }
        showToast("ok", "Key deleted");
        setConfirmDeleteName(null);
        reload();
      } finally {
        setDeletingName(null);
      }
    },
    [showToast, reload],
  );

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-foreground">
          Additional Keys
        </p>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            <IconPlus size={10} />
            Add Key
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
        Keys are referenced in automations as{" "}
        <code className="rounded bg-background px-1 py-0.5 text-[9px]">
          {"${keys.KEY_NAME}"}
        </code>
        . Values are encrypted and never shown to the AI agent.
      </p>

      {showForm && (
        <div className="rounded-md border border-border px-2.5 py-2 bg-accent/30 space-y-1.5">
          <input
            value={formName}
            onChange={(e) =>
              setFormName(
                e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
              )
            }
            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="KEY_NAME (e.g. SLACK_WEBHOOK)"
          />
          <input
            type="password"
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="Secret value"
          />
          <input
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="Description (optional)"
          />
          <div className="flex items-center gap-2">
            <select
              value={formScope}
              onChange={(e) =>
                setFormScope(e.target.value as "user" | "workspace")
              }
              className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="user">Personal</option>
              <option value="workspace">Workspace</option>
            </select>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={resetForm}
                className="rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!formName.trim() || !formValue.trim() || formBusy}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                style={{ backgroundColor: "#625DF5", color: "white" }}
              >
                {formBusy ? (
                  <IconLoader2 size={10} className="animate-spin" />
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
          {formError && <p className="text-[10px] text-red-500">{formError}</p>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <IconLoader2 size={10} className="animate-spin" />
          Loading...
        </div>
      ) : keys.length === 0 && !showForm ? (
        <p className="text-[10px] text-muted-foreground">
          No additional keys yet.
        </p>
      ) : (
        keys.map((key) => (
          <div
            key={`${key.scope}-${key.name}`}
            className="rounded-md border border-border px-2.5 py-2 bg-accent/30"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-foreground font-mono truncate">
                    {key.name}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      key.scope === "workspace"
                        ? "bg-blue-500/15 text-blue-500"
                        : "bg-accent/60 text-muted-foreground"
                    }`}
                  >
                    {key.scope === "workspace" ? "workspace" : "personal"}
                  </span>
                </div>
                {key.description && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {key.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span>
                    Ending in{" "}
                    <code className="rounded bg-background px-1 py-0.5 text-foreground">
                      {key.last4}
                    </code>
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                {confirmDeleteName === key.name ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(key.name)}
                      disabled={deletingName === key.name}
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-red-500/15 text-red-500 hover:bg-red-500/25 disabled:opacity-40"
                    >
                      {deletingName === key.name ? (
                        <IconLoader2 size={10} className="animate-spin" />
                      ) : (
                        "Confirm"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteName(null)}
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-accent/60 text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteName(key.name)}
                    className="text-muted-foreground hover:text-red-500"
                    title="Delete"
                  >
                    <IconTrash size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {toast && (
        <p
          className={`text-[10px] ${toast.kind === "ok" ? "text-green-500" : "text-red-500"}`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}
