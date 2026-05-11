import { useActionQuery } from "@agent-native/core/client";
import { OnboardingPanel } from "@agent-native/core/client/onboarding";
import {
  IconCloudUpload,
  IconExternalLink,
  IconKey,
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

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Manage credentials</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Update existing API keys, swap object storage providers, or reconnect
          Builder.io from the agent sidebar setup panel.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href="/_agent-native/builder/connect?ref=images-settings"
              target="_blank"
              rel="noreferrer"
            >
              Connect Builder.io
              <IconExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
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
