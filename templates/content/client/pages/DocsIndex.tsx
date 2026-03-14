import { AppLayout } from "@/components/layout/AppLayout";
import { ContentTable } from "@/components/content/ContentTable";

export default function DocsIndex() {
  return (
    <AppLayout>
      <ContentTable filter="docs" />
    </AppLayout>
  );
}
