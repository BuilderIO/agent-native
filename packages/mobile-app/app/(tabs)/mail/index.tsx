import ScreenHost, {
  type ScreenImplementationProps,
} from "@/components/ScreenHost";
import WorkspaceAppTab from "@/components/WorkspaceAppTab";

type MailInboxParams = { appId: "mail" };

function RemoteMailInbox({
  params,
}: ScreenImplementationProps<MailInboxParams, undefined>) {
  return <WorkspaceAppTab appId={params.appId} />;
}

export default function MailTab() {
  return (
    <ScreenHost
      screen="mail.inbox"
      params={{ appId: "mail" }}
      renderers={{ remote: RemoteMailInbox }}
      sync={undefined}
    />
  );
}
