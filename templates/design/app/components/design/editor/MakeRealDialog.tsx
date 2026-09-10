import { agentNativePath } from "@agent-native/core/client/api-path";
import { useSession } from "@agent-native/core/client/hooks";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
} from "@agent-native/core/client/settings";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import {
  IconCircleCheck,
  IconExternalLink,
  IconRocket,
} from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

/** Result of `migrate-inline-design-to-app`, including the not-configured CTA. */
export interface DesignMigrationResult {
  branchName?: string;
  url?: string;
  versionId?: string;
  seedFileCount?: number;
  status?: string;
  projectId?: string;
  cta?: {
    kind: string;
    label: string;
    description?: string;
    connectUrl?: string;
    primaryAction: string;
  };
}

function isBuilderEmail(email: string | null | undefined): boolean {
  return email?.toLowerCase().endsWith("@builder.io") === true;
}

export function MakeRealDialog({
  open,
  onOpenChange,
  result,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: DesignMigrationResult | null;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { session } = useSession();
  const canMigrate = isBuilderEmail(session?.email);
  const emailFieldId = useId();
  const emailErrorId = `${emailFieldId}-error`;

  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  const builderConnect = useBuilderConnectFlow({
    enabled: open && canMigrate,
    popupUrl:
      result?.status === "not-configured" &&
      result.cta?.kind === "connect-builder"
        ? result.cta.connectUrl
        : undefined,
    provisionAccount: true,
    trackingSource: "design_make_real_dialog",
    trackingFlow: "design_migration",
  });

  useEffect(() => {
    if (!open) {
      setJoiningWaitlist(false);
      setWaitlistJoined(false);
      setWaitlistError(null);
      return;
    }
    setWaitlistEmail(session?.email ?? "");
  }, [open, session?.email]);

  const handleJoinWaitlist = async () => {
    const trimmed = waitlistEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setWaitlistError("Enter a valid email address." /* i18n-ignore */);
      return;
    }

    setJoiningWaitlist(true);
    setWaitlistError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/builder/branch-waitlist"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmed,
            pageUrl:
              typeof window === "undefined" ? undefined : window.location.href,
            useCase: "design_make_real_waitlist",
            source: "design_make_real_dialog",
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Couldn't join the waitlist. Please try again." /* i18n-ignore */,
        );
      }
      setWaitlistJoined(true);
    } catch (err) {
      setWaitlistError(
        err instanceof Error
          ? err.message
          : "Couldn't join the waitlist. Please try again." /* i18n-ignore */,
      );
    } finally {
      setJoiningWaitlist(false);
    }
  };

  const busy = pending || joiningWaitlist;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {!canMigrate ? (
          waitlistJoined ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {/* guard:allow-raw-color - success checkmark; no success token exists in app/global.css */}
                  <IconCircleCheck className="size-5 text-green-500" />
                  {"You're on the waitlist" /* i18n-ignore */}
                </DialogTitle>
                <DialogDescription>
                  {"We'll email you when access opens." /* i18n-ignore */}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  onClick={() => onOpenChange(false)}
                  className="cursor-pointer"
                >
                  {"Close" /* i18n-ignore */}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <IconRocket className="size-5" />
                  {"Make this a real app" /* i18n-ignore */}
                </DialogTitle>
                <DialogDescription>
                  {
                    "Convert designs into real React + Tailwind code with components and git branches. Join the waitlist for early access." /* i18n-ignore */
                  }
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleJoinWaitlist();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor={emailFieldId}>
                    {"Email" /* i18n-ignore */}
                  </Label>
                  <Input
                    id={emailFieldId}
                    type="email"
                    value={waitlistEmail}
                    onChange={(event) => setWaitlistEmail(event.target.value)}
                    placeholder={"you@company.com" /* i18n-ignore */}
                    autoComplete="email"
                    aria-invalid={waitlistError ? true : undefined}
                    aria-describedby={waitlistError ? emailErrorId : undefined}
                    disabled={joiningWaitlist}
                  />
                  {waitlistError ? (
                    <p
                      id={emailErrorId}
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {waitlistError}
                    </p>
                  ) : null}
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={joiningWaitlist}
                    className="cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={joiningWaitlist}
                    className="cursor-pointer"
                  >
                    {joiningWaitlist ? (
                      <>
                        <Spinner className="mr-2 size-3.5" />
                        {"Joining…" /* i18n-ignore */}
                      </>
                    ) : (
                      "Join waitlist" /* i18n-ignore */
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )
        ) : result?.status === "not-configured" && result.cta ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IconRocket className="size-5 text-muted-foreground" />
                {result.cta.label}
              </DialogTitle>
              {result.cta.description ? (
                <DialogDescription>{result.cta.description}</DialogDescription>
              ) : null}
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              {result.cta.connectUrl ? (
                result.cta.kind === "connect-builder" ? (
                  <BuilderConnectPopover flow={builderConnect}>
                    <Button className="cursor-pointer">
                      {result.cta.primaryAction}
                      <IconExternalLink className="ml-1.5 size-3.5" />
                    </Button>
                  </BuilderConnectPopover>
                ) : (
                  <Button asChild className="cursor-pointer">
                    <a
                      href={result.cta.connectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {result.cta.primaryAction}
                      <IconExternalLink className="ml-1.5 size-3.5" />
                    </a>
                  </Button>
                )
              ) : null}
            </DialogFooter>
          </>
        ) : result?.status === "processing" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {/* guard:allow-raw-color - success checkmark; no success token exists in app/global.css */}
                <IconCircleCheck className="size-5 text-green-500" />
                {"Migration started" /* i18n-ignore */}
              </DialogTitle>
              <DialogDescription>
                {
                  "Builder is generating your React app branch." /* i18n-ignore */
                }
              </DialogDescription>
            </DialogHeader>
            {(result.branchName || result.url) && (
              <div className="flex flex-col gap-2 py-1">
                {result.branchName ? (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {"Branch: " /* i18n-ignore */}
                    </span>
                    <span className="font-mono font-medium">
                      {result.branchName}
                    </span>
                  </div>
                ) : null}
                {result.url ? (
                  <a
                    href={withBuilderUtmTrackingParams(result.url, {
                      campaign: "product",
                      content: "design_migration",
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-[var(--design-editor-accent-color)] hover:underline"
                  >
                    {"Open in Builder" /* i18n-ignore */}
                    <IconExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </div>
            )}
            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                className="cursor-pointer"
              >
                {"Done" /* i18n-ignore */}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IconRocket className="size-5" />
                {"Make this a real app" /* i18n-ignore */}
              </DialogTitle>
              <DialogDescription>
                {
                  "Export this design as a full React + Tailwind app with components, state, and Git branches." /* i18n-ignore */
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={() => onConfirm()}
                disabled={pending}
                className="cursor-pointer"
              >
                {pending ? (
                  <>
                    <Spinner className="mr-2 size-3.5" />
                    {"Starting migration…" /* i18n-ignore */}
                  </>
                ) : (
                  "Start migration" /* i18n-ignore */
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
