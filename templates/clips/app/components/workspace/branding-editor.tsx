import { useState } from "react";
import { IconPalette, IconPhoto } from "@tabler/icons-react";
import { appBasePath, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BrandingEditorProps {
  organizationId: string;
  initialName: string;
  initialBrandColor: string;
  initialBrandLogoUrl: string | null;
  disabled?: boolean;
}

const PRESETS = [
  "#18181B",
  "#22C55E",
  "#F97316",
  "#EC4899",
  "#0EA5E9",
  "#EF4444",
  "#111827",
];

async function uploadLogo(file: File): Promise<string> {
  const body = await file.arrayBuffer();
  const res = await fetch(
    `${appBasePath()}/api/media?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      body,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    },
  );
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("Upload returned no URL");
  return json.url;
}

export function BrandingEditor({
  organizationId,
  initialName,
  initialBrandColor,
  initialBrandLogoUrl,
  disabled,
}: BrandingEditorProps) {
  const [name, setName] = useState(initialName);
  const [brandColor, setBrandColor] = useState(initialBrandColor);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(
    initialBrandLogoUrl,
  );
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const qc = useQueryClient();
  const save = useActionMutation<
    any,
    {
      organizationId: string;
      name?: string;
      brandColor?: string;
      brandLogoUrl?: string | null;
    }
  >("set-organization-branding");

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }
    try {
      setUploading(true);
      const url = await uploadLogo(file);
      setBrandLogoUrl(url);
      toast.success("Logo uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        organizationId,
        name: name.trim() || undefined,
        brandColor,
        brandLogoUrl,
      });
      toast.success("Branding updated");
      qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <IconPalette className="size-4 text-primary" />
          Branding
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Organization name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Brand color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                disabled={disabled}
                className="h-9 w-16 rounded-md border border-input bg-background p-1 cursor-pointer"
                aria-label="Brand color picker"
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                disabled={disabled}
                className="max-w-[120px] tabular-nums uppercase"
              />
              <div className="flex items-center gap-1 ml-2">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-6 w-6 rounded-full border border-input"
                    style={{ background: c }}
                    onClick={() => setBrandColor(c)}
                    aria-label={`Use ${c}`}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Logo</Label>
            <div
              className={`rounded-md border border-dashed p-4 flex items-center gap-4 ${
                dragging ? "bg-primary/5 border-primary" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
            >
              <div
                className="h-14 w-14 rounded-md flex items-center justify-center border bg-muted/30"
                style={{
                  background: brandLogoUrl ? undefined : brandColor + "20",
                }}
              >
                {brandLogoUrl ? (
                  <img
                    src={brandLogoUrl}
                    alt="Logo preview"
                    className="max-h-12 max-w-12 object-contain"
                  />
                ) : (
                  <IconPhoto className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-muted-foreground">
                  {brandLogoUrl
                    ? "Drop a new image to replace"
                    : "Drop a PNG / JPG / SVG here"}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Label
                    htmlFor="logo-upload"
                    className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-pointer hover:bg-accent"
                  >
                    {uploading ? "Uploading…" : "Choose file"}
                  </Label>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={disabled || uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />
                  {brandLogoUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setBrandLogoUrl(null)}
                      disabled={disabled}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Preview
            </div>
            <div
              className="rounded-md p-3 flex items-center gap-3 text-white"
              style={{ background: brandColor }}
            >
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt=""
                  className="h-8 w-8 rounded bg-white/90 object-contain p-1"
                />
              ) : (
                <div
                  className="h-8 w-8 rounded bg-white/90 flex items-center justify-center font-semibold text-[13px]"
                  style={{ color: brandColor }}
                >
                  {name.slice(0, 1).toUpperCase() || "C"}
                </div>
              )}
              <div className="font-medium truncate">
                {name || "Organization"}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={disabled || save.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
