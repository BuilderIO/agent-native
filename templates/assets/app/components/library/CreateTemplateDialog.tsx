import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ASPECT_RATIOS,
  IMAGE_CATEGORIES,
  type AspectRatio,
  type ImageCategory,
} from "@shared/api";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function CreateTemplateDialog({
  open,
  onOpenChange,
  libraryId: lockedLibraryId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId?: string;
  onCreated: (template: any) => void;
}) {
  const t = useT();
  const id = useId();
  const create = useActionMutation("create-template");
  const { data: librariesData } = useActionQuery("list-libraries", {
    compact: true,
  }) as any;
  const [title, setTitle] = useState("");
  const [libraryId, setLibraryId] = useState<string | null>(
    lockedLibraryId ?? null,
  );
  const [category, setCategory] = useState<ImageCategory>("social");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [textPolicy, setTextPolicy] = useState(t("library.defaultTextPolicy"));
  const [includeLogo, setIncludeLogo] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLibraryId(lockedLibraryId ?? null);
    setIncludeLogo(false);
  }, [lockedLibraryId, open]);

  function submit() {
    const name = title.trim();
    if (!name) return;
    create.mutate(
      {
        title: name,
        libraryId,
        category,
        aspectRatio,
        promptTemplate: promptTemplate.trim() || undefined,
        textPolicy,
        includeLogo,
      },
      {
        onSuccess: (template: any) => {
          toast.success(t("templates.created"));
          onOpenChange(false);
          onCreated(template?.template ?? template);
          setTitle("");
          setPromptTemplate("");
          setTextPolicy(t("library.defaultTextPolicy"));
        },
        onError: (error: Error) =>
          toast.error(error.message || t("templates.createFailed")),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("templates.new")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-title`}>{t("templates.name")}</Label>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("templates.brandKit")}</Label>
            <Select
              value={libraryId ?? "global"}
              onValueChange={(value) =>
                setLibraryId(value === "global" ? null : value)
              }
              disabled={Boolean(lockedLibraryId)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">
                  {t("templates.globalNoBrandKit")}
                </SelectItem>
                {(librariesData?.libraries ?? []).map((library: any) => (
                  <SelectItem key={library.id} value={library.id}>
                    {library.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t("templates.category")}</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as ImageCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("templates.aspectRatio")}</Label>
              <Select
                value={aspectRatio}
                onValueChange={(value) => setAspectRatio(value as AspectRatio)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((ratio) => (
                    <SelectItem key={ratio} value={ratio}>
                      {ratio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-prompt`}>
              {t("templates.promptTemplate")}
            </Label>
            <Textarea
              id={`${id}-prompt`}
              value={promptTemplate}
              onChange={(event) => setPromptTemplate(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-text-policy`}>
              {t("templates.textPolicy")}
            </Label>
            <Textarea
              id={`${id}-text-policy`}
              value={textPolicy}
              onChange={(event) => setTextPolicy(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-3 rounded-md border border-border p-3">
            <Checkbox
              checked={includeLogo}
              onCheckedChange={(checked) => setIncludeLogo(checked === true)}
            />
            <span className="text-sm font-medium">
              {t("templates.includeLogo")}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("brandKitDetail.cancel")}
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={submit}>
            {t("brandKitDetail.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
