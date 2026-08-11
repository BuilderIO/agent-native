import { TextField } from "@agent-native/toolkit/design-system";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";

import { agentNativePath } from "../api-path.js";

const STATUS_ENDPOINT = agentNativePath("/_agent-native/file-upload/status");
const SECRET_ENDPOINT = agentNativePath("/_agent-native/secrets/adhoc");

const STORAGE_FIELDS = [
  {
    key: "S3_ENDPOINT",
    label: "Endpoint URL",
    placeholder: "https://s3.us-east-1.amazonaws.com",
  },
  { key: "S3_BUCKET", label: "Bucket name", placeholder: "my-uploads-bucket" },
  {
    key: "S3_ACCESS_KEY_ID",
    label: "Access key ID",
    placeholder: "AKIA...",
  },
  {
    key: "S3_SECRET_ACCESS_KEY",
    label: "Secret access key",
    placeholder: "Paste your secret access key",
    secret: true,
  },
  { key: "S3_REGION", label: "Region", placeholder: "auto" },
  {
    key: "S3_PUBLIC_BASE_URL",
    label: "Public base URL",
    placeholder: "https://cdn.example.com",
  },
] as const;

export function FileStorageSettingsForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(STATUS_ENDPOINT)
      .then(async (response) => {
        if (!response.ok) throw new Error("Storage status unavailable");
        return (await response.json()) as { configured?: boolean };
      })
      .then((status) => {
        if (!cancelled) setConfigured(status.configured === true);
      })
      .catch(() => {
        if (!cancelled) setConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, [saved]);

  const setValue = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const missing = STORAGE_FIELDS.filter(
      (field) => field.key !== "S3_REGION" && !(values[field.key] ?? "").trim(),
    );
    if (missing.length > 0) {
      setError(
        `Enter ${missing[0]?.label.toLowerCase() ?? "all required values"}.`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      for (const field of STORAGE_FIELDS) {
        const value = values[field.key]?.trim();
        if (!value) continue;
        const response = await fetch(SECRET_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: field.key,
            value,
            scope: "workspace",
            description: "S3-compatible object storage for file uploads",
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : `Could not save ${field.label}`,
          );
        }
      }
      setValues({});
      setSaved(true);
      setConfigured(true);
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save storage keys",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {configured ? (
          <IconCheck size={13} className="text-emerald-500" />
        ) : null}
        {configured
          ? "Object storage is connected. Re-enter keys below only to rotate them."
          : "Use a public base URL so attachment links remain stable throughout the thread."}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {STORAGE_FIELDS.map((field) => (
          <TextField
            key={field.key}
            type={"secret" in field && field.secret ? "password" : "text"}
            value={values[field.key] ?? ""}
            onChange={(value) => setValue(field.key, value)}
            aria-label={field.label}
            placeholder={field.placeholder}
            className="w-full text-[11px]"
          />
        ))}
      </div>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      {saved ? (
        <p className="text-[11px] text-emerald-600">Storage keys saved.</p>
      ) : null}
      <ToolkitButton
        type="submit"
        variant="default"
        disabled={saving}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium"
      >
        {saving ? <IconLoader2 size={13} className="animate-spin" /> : null}
        {saving ? "Saving…" : "Save storage keys"}
      </ToolkitButton>
    </form>
  );
}
