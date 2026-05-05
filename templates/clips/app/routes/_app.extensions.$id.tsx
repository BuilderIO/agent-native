import { ExtensionViewerPage } from "@agent-native/core/client/extensions";
import { PageHeader } from "@/components/library/page-header";

export default function ExtensionViewerRoute() {
  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Tools
        </h1>
      </PageHeader>
      <ExtensionViewerPage />
    </>
  );
}
