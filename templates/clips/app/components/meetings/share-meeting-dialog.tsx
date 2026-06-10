import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { IconLink, IconMail } from "@tabler/icons-react";
import { appPath, useActionQuery } from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CopyField,
  GeneralAccessSelect,
  MakePublicCard,
  ShareCardHeader,
  SharePeopleTab,
  copyToClipboard,
  useResourceVisibilityMutation,
  type SharesQuery,
  type SharesResponse,
  type Visibility,
} from "@/components/sharing/share-ui";

export interface ShareMeetingPopoverProps {
  meetingId: string;
  meetingTitle?: string;
  children: ReactNode;
}

export function ShareMeetingPopover({
  meetingId,
  meetingTitle,
  children,
}: ShareMeetingPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[440px] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <ShareMeetingContent
          meetingId={meetingId}
          meetingTitle={meetingTitle}
        />
      </PopoverContent>
    </Popover>
  );
}

function ShareMeetingContent({
  meetingId,
  meetingTitle,
}: {
  meetingId: string;
  meetingTitle?: string;
}) {
  const shareUrl = useMemo(
    () => `${window.location.origin}${appPath(`/share/meeting/${meetingId}`)}`,
    [meetingId],
  );

  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "meeting",
    resourceId: meetingId,
  });

  const data = sharesQuery.data;
  const canManage = data?.role === "owner" || data?.role === "admin";
  const titleText = meetingTitle ? `Share "${meetingTitle}"` : "Share meeting";

  return (
    <>
      <ShareCardHeader title={titleText} ownerEmail={data?.ownerEmail} />

      <Tabs defaultValue="link" className="min-w-0 px-4 py-3">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="link" className="gap-1.5">
            <IconLink size={14} />
            Link
          </TabsTrigger>
          <TabsTrigger value="invite" className="gap-1.5">
            <IconMail size={14} />
            Invite
          </TabsTrigger>
        </TabsList>

        <TabsContent value="link" className="mt-3">
          <LinkTab
            meetingId={meetingId}
            shareUrl={shareUrl}
            sharesQuery={sharesQuery}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="invite" className="mt-3">
          <SharePeopleTab
            resourceType="meeting"
            resourceId={meetingId}
            sharesQuery={sharesQuery}
            canManage={canManage}
            onError={(err, action) =>
              toast.error(
                err instanceof Error
                  ? err.message
                  : action === "invite"
                    ? "Couldn't invite person"
                    : "Couldn't remove person",
              )
            }
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LinkTab({
  meetingId,
  shareUrl,
  sharesQuery,
  canManage,
}: {
  meetingId: string;
  shareUrl: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
}) {
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "meeting",
    meetingId,
    sharesQuery,
  );
  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const isPublic = visibility === "public";

  return (
    <div className="space-y-4">
      <GeneralAccessSelect
        visibility={visibility}
        canManage={canManage}
        isPending={isPending}
        onChange={(next) => setResourceVisibility(next)}
      />

      <CopyField label="Share link" value={shareUrl} />

      {!isPublic && canManage ? (
        <MakePublicCard
          isPending={isPending}
          onMakePublic={() =>
            setResourceVisibility("public", {
              onSuccess: () => copyToClipboard(shareUrl),
            })
          }
        />
      ) : null}
    </div>
  );
}
