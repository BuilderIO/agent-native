import {
  useActionQuery,
  useBuilderStatus,
  useBuilderConnectFlow,
} from "@agent-native/core/client";
import { OnboardingPanel } from "@agent-native/core/client/onboarding";
import {
  IconAlertCircle,
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

type ImageGenerationConfig = {
  builderEnabled?: boolean;
  builderConnected?: boolean;
  geminiConfigured?: boolean;
  configured?: boolean;
  lastIssue?: {
    message?: unknown;
    at?: unknown;
  } | null;
};

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
  const flow = useBuilderConnectFlow({
    trackingSource: "images_settings_credentials",
  });
  // `BUILDER_IMAGE_GENERATION_ENABLED=false` deployments reject Builder
  // credentials in `generateWithManagedImageProvider` even when Builder is
  // connected. Surface that here so the settings UI doesn't send users
  // down a Connect-Builder path that can't succeed. The onboarding plugin
  // already marks the corresponding setup step `disabled` in this case;
  // this card mirrors the gating.
  const { data: configData } = useActionQuery(
    "get-image-generation-config",
    {},
  ) as { data?: ImageGenerationConfig };
  // While the flag query is loading, assume Builder is enabled (the
  // production default) so the connect button doesn't briefly flash as
  // disabled on first render.
  const builderEnabled = configData?.builderEnabled ?? true;
  const setupIssue =
    typeof configData?.lastIssue?.message === "string"
      ? configData.lastIssue.message
      : null;
  const configured = flow.hasFetchedStatus
    ? flow.configured
    : !!status?.configured;
  const orgName = flow.orgName ?? status?.orgName ?? null;

  if (!builderEnabled) {
    return (
      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Manage credentials</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Builder-managed image generation is disabled for this deployment by
          the <code className="text-xs">BUILDER_IMAGE_GENERATION_ENABLED</code>{" "}
          environment variable. Add a Gemini API key from the Setup checklist
          above; the manual fallback is the only path that will succeed until
          the flag is re-enabled.
        </p>
        {setupIssue ? <SetupIssueCallout message={setupIssue} /> : null}
      </div>
    );
  }

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
          {setupIssue ? <SetupIssueCallout message={setupIssue} /> : null}
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
          onClick={() => flow.start()}
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

function SetupIssueCallout({ message }: { message: string }) {
  return (
    <div className="mt-3 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
      <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="leading-relaxed">{message}</p>
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
