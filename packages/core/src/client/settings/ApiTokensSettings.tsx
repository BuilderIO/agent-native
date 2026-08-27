import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { IconCopy, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { appPath } from "../api-path.js";
import { useOrg } from "../org/hooks.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { SettingsSkeleton } from "./SettingsSkeleton.js";

const PERSONAL_TOKENS_ENDPOINT = appPath("/mcp/connect/tokens");
const PERSONAL_TOKEN_ENDPOINT = appPath("/mcp/connect/token");
const PERSONAL_TOKEN_REVOKE_ENDPOINT = appPath("/mcp/connect/tokens/revoke");

interface PersonalToken {
  id: string;
  label: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

interface ServiceToken {
  id: string;
  serviceName: string;
  label: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

interface PersonalTokensResponse {
  tokens: PersonalToken[];
}

interface ServiceTokensResponse {
  tokens: ServiceToken[];
}

interface MintedTokenResponse {
  token: string;
}

type TokenKind = "personal" | "service";

type ApiToken = {
  id: string;
  name: string;
  type: TokenKind;
  createdAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function usePersonalTokens() {
  return useQuery({
    queryKey: ["api-tokens", "personal"],
    queryFn: () => apiFetch<PersonalTokensResponse>(PERSONAL_TOKENS_ENDPOINT),
  });
}

function formatDate(value: number | null): string {
  return value === null ? "Never" : new Date(value).toLocaleDateString();
}

export function ApiTokensSettings() {
  const queryClient = useQueryClient();
  const { data: org } = useOrg();
  const personalTokens = usePersonalTokens();
  const serviceTokens = useActionQuery<ServiceTokensResponse>(
    "list-org-service-tokens",
    { includeRevoked: true },
    { enabled: Boolean(org?.orgId) },
  );
  const mintPersonalToken = useMutation({
    mutationFn: (input: { label: string; ttlDays: number }) =>
      apiFetch<MintedTokenResponse>(PERSONAL_TOKEN_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
  const revokePersonalToken = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(PERSONAL_TOKEN_REVOKE_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
  });
  const mintServiceToken = useActionMutation<
    MintedTokenResponse,
    { name: string; ttlDays?: number }
  >("create-org-service-token");
  const revokeServiceToken = useActionMutation<{ ok: boolean }, { id: string }>(
    "revoke-org-service-token",
  );
  const canManageServiceTokens = org?.role === "owner" || org?.role === "admin";
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TokenKind>("personal");
  const [ttlDays, setTtlDays] = useState("365");
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invalidateTokens = () => {
    void queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-org-service-tokens"],
    });
  };

  const tokens = useMemo<ApiToken[]>(
    () => [
      ...(personalTokens.data?.tokens ?? []).map((token) => ({
        id: token.id,
        name: token.label || "Personal token",
        type: "personal" as const,
        createdAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
        revokedAt: token.revokedAt,
      })),
      ...(serviceTokens.data?.tokens ?? []).map((token) => ({
        id: token.id,
        name: token.serviceName || token.label || "Service token",
        type: "service" as const,
        createdAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
        revokedAt: token.revokedAt,
      })),
    ],
    [personalTokens.data, serviceTokens.data],
  );

  const loading = personalTokens.isLoading || serviceTokens.isLoading;
  const error = personalTokens.error ?? serviceTokens.error;

  useEffect(() => {
    if (!createOpen) {
      setRevealedToken(null);
      setName("");
      setKind("personal");
      setTtlDays("365");
      setCreateError(null);
      setCopied(false);
    }
  }, [createOpen]);

  function createToken() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError("Enter a token name.");
      return;
    }
    const ttl = Number(ttlDays);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 365) {
      setCreateError("Choose a lifetime from 1 to 365 days.");
      return;
    }
    setCreateError(null);
    if (kind === "personal") {
      mintPersonalToken.mutate(
        { label: trimmedName, ttlDays: ttl },
        {
          onSuccess: (result) => {
            setRevealedToken(result.token);
            invalidateTokens();
          },
          onError: (reason) => setCreateError(reason.message),
        },
      );
      return;
    }
    mintServiceToken.mutate(
      { name: trimmedName, ttlDays: ttl },
      {
        onSuccess: (result) => {
          setRevealedToken(result.token);
          invalidateTokens();
        },
        onError: (reason) => setCreateError(reason.message),
      },
    );
  }

  function revokeToken() {
    if (!revokeTarget) return;
    if (revokeTarget.type === "personal") {
      revokePersonalToken.mutate(revokeTarget.id, {
        onSuccess: () => {
          invalidateTokens();
          setRevokeTarget(null);
        },
        onError: (reason) => setRevokeError(reason.message),
      });
      return;
    }
    revokeServiceToken.mutate(
      { id: revokeTarget.id },
      {
        onSuccess: () => invalidateTokens(),
        onSettled: () => setRevokeTarget(null),
      },
    );
  }

  async function copyToken() {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken);
    setCopied(true);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">API Tokens</h2>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <IconPlus className="size-4" /> Create token
        </Button>
      </div>

      {loading ? <SettingsSkeleton lines={3} /> : null}
      {error ? (
        <p className="text-sm text-destructive">Could not load API tokens.</p>
      ) : null}
      {!loading && !error && tokens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
          <IconKey className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Use tokens to connect n8n, Make, or any HTTP client
          </p>
          <a
            className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
            href="/docs/automate-slides"
          >
            Automate Slides docs
          </a>
        </div>
      ) : null}
      {!loading && !error && tokens.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card divide-y divide-border/60">
          {tokens.map((token) => (
            <div
              key={`${token.type}-${token.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
            >
              <div className="min-w-44 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {token.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {token.type === "personal" ? "Personal" : "Org service"}
                  {token.revokedAt ? " · Revoked" : ""}
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="block">
                  Created {formatDate(token.createdAt)}
                </span>
                <span className="block">
                  Last used {formatDate(token.lastUsedAt)}
                </span>
              </div>
              {!token.revokedAt &&
              (token.type === "personal" || canManageServiceTokens) ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => {
                    setRevokeError(null);
                    setRevokeTarget(token);
                  }}
                >
                  <IconTrash className="size-4 text-destructive" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {revealedToken ? "Copy your API token" : "Create API token"}
            </DialogTitle>
            {revealedToken ? (
              <DialogDescription>
                This token is shown once. Store it somewhere secure before
                closing this dialog.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {revealedToken ? (
            <div className="space-y-3">
              <code className="block break-all rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground">
                {revealedToken}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyToken()}
              >
                <IconCopy className="size-4" />{" "}
                {copied ? "Copied" : "Copy token"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="grid gap-2 text-sm font-medium text-foreground">
                Name
                <input
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus:ring-1 focus:ring-ring"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {["n8n", "Make", "Zapier"].map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setName(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium text-foreground">
                  Type
                </legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="token-type"
                    checked={kind === "personal"}
                    onChange={() => setKind("personal")}
                  />{" "}
                  Personal
                </label>
                {canManageServiceTokens ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="token-type"
                      checked={kind === "service"}
                      onChange={() => setKind("service")}
                    />{" "}
                    Org service
                  </label>
                ) : null}
              </fieldset>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                Lifetime (days)
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus:ring-1 focus:ring-ring"
                  value={ttlDays}
                  onChange={(event) => setTtlDays(event.target.value)}
                />
              </label>
              {createError ? (
                <p className="text-sm text-destructive">{createError}</p>
              ) : null}
            </div>
          )}
          <DialogFooter>
            {revealedToken ? (
              <Button type="button" onClick={() => setCreateOpen(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={createToken}
                  disabled={
                    mintPersonalToken.isPending || mintServiceToken.isPending
                  }
                >
                  Create token
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke API token?</DialogTitle>
            <DialogDescription>
              {revokeTarget?.name} will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          {revokeError ? (
            <p className="text-sm text-destructive">{revokeError}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={revokeToken}
              disabled={
                revokePersonalToken.isPending || revokeServiceToken.isPending
              }
            >
              Revoke token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
