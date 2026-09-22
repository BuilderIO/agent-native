import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { CreateTemplateDialog } from "./CreateTemplateDialog";

export function TemplatesPanel({
  libraryId,
  templates,
}: {
  libraryId: string;
  templates: any[];
}) {
  const t = useT();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const associated = templates.filter(
    (template) => template.libraryId === libraryId,
  );
  const global = templates.filter((template) => !template.libraryId);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("navigation.templates")}</h3>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <IconPlus />
          {t("templates.new")}
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {associated.map((template) => (
          <div
            key={template.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
          >
            <Link
              className="truncate text-sm font-medium underline-offset-4 hover:underline"
              to={`/templates/${template.id}`}
            >
              {template.title}
            </Link>
            <Badge variant="outline">{template.aspectRatio}</Badge>
          </div>
        ))}
        {!associated.length ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t("templates.noTemplates")}
          </p>
        ) : null}
      </div>
      {global.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("templates.global")}
          </summary>
          <div className="mt-2 space-y-2">
            {global.map((template) => (
              <GlobalTemplateRow
                key={template.id}
                template={template}
                libraryId={libraryId}
              />
            ))}
          </div>
        </details>
      ) : null}
      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        libraryId={libraryId}
        onCreated={(template) => {
          if (template?.id) navigate(`/templates/${template.id}`);
        }}
      />
    </div>
  );
}

function GlobalTemplateRow({
  template,
  libraryId,
}: {
  template: any;
  libraryId: string;
}) {
  const t = useT();
  const duplicate = useActionMutation("duplicate-template");
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
      <Link
        className="truncate text-sm font-medium underline-offset-4 hover:underline"
        to={`/templates/${template.id}`}
      >
        {template.title}
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          duplicate.mutate(
            { id: template.id, libraryId },
            { onError: (error: Error) => toast.error(error.message) },
          )
        }
      >
        {t("templates.duplicateIntoBrandKit")}
      </Button>
    </div>
  );
}
