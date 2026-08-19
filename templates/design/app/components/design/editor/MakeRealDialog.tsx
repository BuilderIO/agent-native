import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import {
  IconCircleCheck,
  IconExternalLink,
  IconRocket,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {/* Not-configured: Builder not connected or no project ID */}
        {result?.status === "not-configured" && result.cta ? (
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
              ) : null}
            </DialogFooter>
          </>
        ) : result?.status === "processing" ? (
          /* Success: Builder accepted the migration job */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {/* guard:allow-raw-color - success checkmark; no success token exists in app/global.css */}
                <IconCircleCheck className="size-5 text-green-500" />
                {"Migration started" /* i18n-ignore */}
              </DialogTitle>
              <DialogDescription>
                {
                  "Builder is generating a React app branch from your design. The original inline design is preserved and recoverable." /* i18n-ignore */
                }
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {result.branchName && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {"Branch: " /* i18n-ignore */}
                  </span>
                  <span className="font-mono font-medium">
                    {result.branchName}
                  </span>
                </div>
              )}
              {result.url && (
                <a
                  href={withBuilderUtmTrackingParams(result.url, {
                    campaign: "product",
                    content: "design_migration",
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-[var(--design-editor-accent-color)] hover:underline"
                >
                  {"Open in Builder" /* i18n-ignore */}
                  <IconExternalLink className="size-3.5" />
                </a>
              )}
              {result.seedFileCount !== undefined && (
                <p className="text-xs text-muted-foreground">
                  {
                    `${result.seedFileCount} design file${result.seedFileCount === 1 ? "" : "s"} included in migration seed.` /* i18n-ignore */
                  }
                </p>
              )}
            </div>
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
          /* Idle or migrating */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IconRocket className="size-5" />
                {"Make this a real app" /* i18n-ignore */}
              </DialogTitle>
              <DialogDescription>
                {
                  "Connect Builder.io (free tier available) to convert this design into a React + Tailwind app with real components, props, branches, and deploys. Your current inline design is preserved as a snapshot you can restore at any time." /* i18n-ignore */
                }
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1 text-sm text-muted-foreground">
              <p>{"What happens:" /* i18n-ignore */}</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  {
                    "Your design HTML and tokens are sent to the Builder cloud agent" /* i18n-ignore */
                  }
                </li>
                <li>
                  {
                    "A React + Tailwind branch is generated in Builder" /* i18n-ignore */
                  }
                </li>
                <li>
                  {
                    "The editor switches to fusion source mode — gated panels light up" /* i18n-ignore */
                  }
                </li>
                <li>
                  {
                    "The original inline design is saved as a restorable snapshot" /* i18n-ignore */
                  }
                </li>
              </ul>
              <p className="pt-1 text-xs">
                {
                  "Requires Builder.io to be connected (free tier available) with a branch project configured." /* i18n-ignore */
                }
              </p>
            </div>
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
                onClick={() => void onConfirm()}
                disabled={pending}
                className="cursor-pointer"
              >
                {
                  pending ? (
                    <>
                      <Spinner className="mr-2 size-3.5" />
                      {"Starting migration…" /* i18n-ignore */}
                    </>
                  ) : (
                    "Start migration"
                  ) /* i18n-ignore */
                }
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
