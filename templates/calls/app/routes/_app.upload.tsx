import { Link } from "react-router";
import { IconAlertCircle, IconUpload } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UploadSourceTabs } from "@/components/upload/upload-source-tabs";
import { UploadDropzone } from "@/components/upload/upload-dropzone";
import { InBrowserRecorder } from "@/components/upload/in-browser-recorder";
import { RecallIntegrationCard } from "@/components/upload/recall-integration-card";
import { ZoomOauthCard } from "@/components/upload/zoom-oauth-card";

export function meta() {
  return [{ title: "Upload · Calls" }];
}

interface OnboardingState {
  deepgramConfigured?: boolean;
}

export default function UploadRoute() {
  const { data } = useActionQuery<OnboardingState>(
    "get-onboarding-status",
    undefined,
    {
      retry: false,
    },
  );
  const deepgramMissing = data && data.deepgramConfigured === false;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <IconUpload className="h-6 w-6 text-[#625DF5]" />
          Upload a call
        </h1>
        <p className="text-xs text-muted-foreground">
          Drop in a file, record in-browser, or pull from your meeting platform
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 max-w-4xl w-full mx-auto">
        {deepgramMissing ? (
          <Alert>
            <IconAlertCircle className="h-4 w-4" />
            <AlertTitle>Transcription isn't configured yet</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>
                Add your Deepgram API key to start transcribing uploads.
              </span>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link to="/settings">Go to Settings</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <UploadSourceTabs
          dropzone={<UploadDropzone />}
          recorder={<InBrowserRecorder />}
          meetingBot={<RecallIntegrationCard />}
        />

        <div>
          <h2 className="text-sm font-medium mb-2">Zoom cloud recordings</h2>
          <ZoomOauthCard />
        </div>
      </div>
    </div>
  );
}
