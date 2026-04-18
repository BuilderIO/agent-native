import { ReactNode, useState } from "react";
import {
  IconCloudUpload,
  IconMicrophone,
  IconCalendarEvent,
} from "@tabler/icons-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { UploadDropzone } from "./upload-dropzone";
import { InBrowserRecorder } from "./in-browser-recorder";
import { RecallIntegrationCard } from "./recall-integration-card";
import { ZoomOauthCard } from "./zoom-oauth-card";

type TabKey = "upload" | "record" | "meeting";

interface UploadSourceTabsProps {
  folderId?: string | null;
  workspaceId?: string | null;
  defaultTab?: TabKey;
  className?: string;
  dropzone?: ReactNode;
  recorder?: ReactNode;
  meetingBot?: ReactNode;
}

export function UploadSourceTabs({
  folderId,
  workspaceId,
  defaultTab = "upload",
  className,
  dropzone,
  recorder,
  meetingBot,
}: UploadSourceTabsProps) {
  const [tab, setTab] = useState<TabKey>(defaultTab);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
      className={cn("w-full", className)}
    >
      <TabsList className="grid w-full grid-cols-3 max-w-xl">
        <TabsTrigger value="upload" className="gap-1.5 text-xs">
          <IconCloudUpload className="h-4 w-4" />
          Upload file
        </TabsTrigger>
        <TabsTrigger value="record" className="gap-1.5 text-xs">
          <IconMicrophone className="h-4 w-4" />
          Record now
        </TabsTrigger>
        <TabsTrigger value="meeting" className="gap-1.5 text-xs">
          <IconCalendarEvent className="h-4 w-4" />
          Join meeting
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="mt-4">
        {dropzone ?? (
          <UploadDropzone folderId={folderId} workspaceId={workspaceId} />
        )}
      </TabsContent>

      <TabsContent value="record" className="mt-4">
        {recorder ?? (
          <InBrowserRecorder folderId={folderId} workspaceId={workspaceId} />
        )}
      </TabsContent>

      <TabsContent value="meeting" className="mt-4 space-y-4">
        {meetingBot ?? (
          <>
            <RecallIntegrationCard />
            <ZoomOauthCard />
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
