import {
  useActionQuery,
  useBuilderStatus,
  useBuilderConnectFlow,
} from "@agent-native/core/client";
import { OnboardingPanel } from "@agent-native/core/client/onboarding";
import {
  IconCheck,
  IconCloudUpload,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconPhoto,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const { data } = useActionQuery("list-libraries", { compact: true }) as any;
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Builder-managed image generation and object storage to start
          creating brand images.
        </p>
      </div>

      <OnboardingPanel title="Setup" />

      <div className="grid gap-4 md:grid-cols-3">
        <InfoTile
          icon={<IconKey className="h-5 w-5" />}
          title="Image generation"
          body="Builder-managed generation uses Builder credits; Gemini keys remain available as the fallback."
        />
        <InfoTile
          icon={<IconCloudUpload className="h-5 w-5" />}
          title="Object storage"
          body="Required in production for originals, thumbnails, and exports."
        />
        <InfoTile
          icon={<IconPhoto className="h-5 w-5" />}
          title="Libraries"
          body={`${(data as any)?.count ?? 0} accessible libraries`}
        />
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Cross-agent access</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This app is discoverable over A2A as the Images agent. Slides,
              Design, Content, and Mail should call Images instead of image
              providers directly when brand libraries matter.
            </p>
          </div>
          <Badge variant="secondary">A2A ready</Badge>
        </div>
      </div>

      <ManageCredentialsSection />
    </div>
  );
}

function ManageCredentialsSection() {
  const { status } = useBuilderStatus();
  const flow = useBuilderConnectFlow();
  const configured = flow.hasFetchedStatus
    ? flow.configured
    : !!status?.configured;
  const orgName = flow.orgName ?? status?.orgName ?? null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Manage credentials</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {configured
              ? "Builder.io is connected for managed image generation. Reconnect to switch to a different Builder account or space."
              : "Connect Builder.io for one-click managed image generation, or add a Gemini API key as a manual fallback from the Setup checklist above."}
          </p>
          {configured && orgName ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Connected as{" "}
              <span className="font-medium text-foreground">{orgName}</span>.
            </p>
          ) : null}
          {flow.error ? (
            <p className="mt-2 text-xs text-destructive">{flow.error}</p>
          ) : null}
        </div>
        {configured ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <IconCheck className="h-3 w-3" />
            Connected
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={flow.start}
          disabled={flow.connecting}
          className="cursor-pointer"
        >
          {flow.connecting ? (
            <>
              <IconLoader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Waiting for Builder…
            </>
          ) : configured ? (
            <>
              Reconnect Builder.io
              <IconExternalLink className="ml-1 h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Connect Builder.io
              <IconExternalLink className="ml-1 h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function InfoTile({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
