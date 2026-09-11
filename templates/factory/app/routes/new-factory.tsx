import { useT } from "@agent-native/core/client/i18n";
import { IconArrowLeft } from "@tabler/icons-react";
import { Link, useNavigate } from "react-router";

import { FactoryWorkspaceActions } from "@/components/factory/FactoryWorkspaceActions";
import { NewFactoryForm } from "@/components/factory/NewFactoryForm";
import { Button } from "@/components/ui/button";

export default function NewFactoryRoute() {
  const t = useT();
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <div className="flex items-center gap-3 px-4 py-4 lg:px-6">
        <Button asChild type="button" variant="ghost" className="gap-2 px-2">
          <Link to="/factory">
            <IconArrowLeft className="size-4" />
            {t("navigation.triage")}
          </Link>
        </Button>
        <div className="ms-auto">
          <FactoryWorkspaceActions />
        </div>
      </div>
      <section className="flex flex-1 flex-col px-4 pb-8 lg:px-6">
        <NewFactoryForm
          onCreated={(factoryId) =>
            navigate(`/factory?factoryId=${encodeURIComponent(factoryId)}`)
          }
        />
      </section>
    </div>
  );
}
