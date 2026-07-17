import { useT } from "@agent-native/core/client";
import { IconFileText, IconPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { useCreatePage } from "@/hooks/use-create-page";

export function EmptyState() {
  const createPage = useCreatePage();
  const t = useT();

  const handleCreate = () => {
    void createPage().catch(() => undefined);
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-muted mb-6">
          <IconFileText size={24} className="text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {t("empty.noPageTitle")}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {t("empty.noPageDescription")}
        </p>
        <Button onClick={handleCreate} size="sm">
          <IconPlus size={14} className="me-1.5" />
          {t("empty.newPage")}
        </Button>
      </div>
    </div>
  );
}
