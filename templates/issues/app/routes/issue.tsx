import { useSearchParams } from "react-router";
import { postNavigate, isInAgentEmbed } from "@agent-native/core/client";
import { IconExternalLink } from "@tabler/icons-react";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { Button } from "@/components/ui/button";

export function meta() {
  return [{ title: "Issue Preview — Issues" }];
}

export default function IssuePreviewRoute() {
  const [searchParams] = useSearchParams();
  const issueKey = searchParams.get("issueKey");
  const projectKey = searchParams.get("projectKey");

  if (!issueKey) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">
          Missing issueKey parameter.
        </p>
      </div>
    );
  }

  const openInAppPath = projectKey
    ? `/projects/${projectKey}/${issueKey}`
    : `/my-issues/${issueKey}`;

  return (
    <div className="relative flex h-screen flex-col bg-background">
      {isInAgentEmbed() && (
        <div className="absolute right-3 top-3 z-10">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => postNavigate(openInAppPath)}
          >
            <IconExternalLink className="h-3.5 w-3.5" />
            Open in app
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <IssueDetail issueKey={issueKey} closePath="" />
      </div>
    </div>
  );
}
