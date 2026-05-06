import { useActionQuery } from "@agent-native/core/client";
import { IconCloudUpload, IconKey, IconPhoto } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const { data } = useActionQuery("list-libraries", { compact: true }) as any;
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure Gemini and object storage from the agent sidebar setup
          checklist.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <InfoTile
          icon={<IconKey className="h-5 w-5" />}
          title="Gemini"
          body="Required for Nano Banana 2 image generation."
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
