import { ToolViewerPage } from "@agent-native/core/client/tools";
import { PageHeader } from "@/components/library/page-header";

export default function ToolViewerRoute() {
  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Tools
        </h1>
      </PageHeader>
      <ToolViewerPage />
    </>
  );
}
