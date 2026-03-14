import { AppLayout } from "@/components/layout/AppLayout";
import { ContentTable } from "@/components/content/ContentTable";

export default function BlogIndex() {
  return (
    <AppLayout>
      <ContentTable filter="blog" />
    </AppLayout>
  );
}
