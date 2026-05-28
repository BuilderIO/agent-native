import { Link, useNavigate, useParams } from "react-router";
import { useState } from "react";
import {
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconCopy,
  IconDownload,
  IconMessageCircle,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { assetMediaUrl } from "@/lib/asset-urls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data } = useActionQuery("get-asset", { id: id! }) as any;
  const exportAsset = useActionMutation("export-asset");
  const deleteAsset = useActionMutation("delete-asset");
  const asset = data;

  if (!asset) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading asset...</div>
    );
  }

  const isVideo =
    asset.mediaType === "video" || asset.mimeType?.startsWith("video/");
  const previewUrl = assetMediaUrl(asset.previewUrl);

  function refine() {
    sendToAgentChat({
      message: isVideo
        ? `Create a new video variation inspired by asset ${asset.id}. Ask me what should change, then call generate-video with this libraryId and folderId when ready.`
        : `Refine image ${asset.id}. Ask me what to change, then call refine-image with this assetId and show the new preview.`,
      context: `Asset: ${asset.id}\nLibrary: ${asset.libraryId}\nFolder: ${asset.folderId || "none"}\nPrompt: ${asset.prompt || ""}`,
      submit: true,
      newTab: true,
    });
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="overflow-y-auto border-b border-border bg-background p-5 lg:border-b-0 lg:border-r">
        <div className="mb-4">
          <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2">
            <Link to={`/library/${asset.libraryId}`}>
              <IconArrowLeft className="h-4 w-4" />
              Library
            </Link>
          </Button>
        </div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {isVideo && <IconVideo className="h-4 w-4 text-muted-foreground" />}
          {asset.title || (isVideo ? "Video asset" : "Asset")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">{asset.status}</Badge>
          <Badge variant="outline">{asset.role}</Badge>
          <Badge variant="outline">{isVideo ? "video" : "image"}</Badge>
          {asset.metadata?.category && (
            <Badge variant="outline">{asset.metadata.category}</Badge>
          )}
        </div>
        <Separator className="my-5" />
        <div className="space-y-4 text-sm">
          {isVideo ? (
            <Field
              label="Video"
              value={`${asset.durationSeconds || "?"}s · ${asset.aspectRatio || "n/a"} · ${asset.model || "n/a"}`}
            />
          ) : (
            <Field
              label="Dimensions"
              value={`${asset.width || "?"} x ${asset.height || "?"}`}
            />
          )}
          <Field label="MIME" value={asset.mimeType || "n/a"} />
          <Field label="Folder" value={asset.folderId || "Unfiled"} />
          <Field
            label="Description"
            value={
              asset.description || asset.altText || "No description stored"
            }
            multiline
          />
          <Field
            label="Prompt"
            value={asset.prompt || "No prompt stored"}
            multiline
          />
        </div>
        <Separator className="my-5" />
        <div className="grid gap-2">
          <Button className="gap-2" onClick={refine}>
            <IconMessageCircle className="h-4 w-4" />
            {isVideo ? "Make video variation" : "Make variations"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() =>
              exportAsset.mutate(
                { assetId: asset.id },
                {
                  onSuccess: (result: any) => {
                    window.location.href =
                      assetMediaUrl(result.downloadUrl) ?? result.downloadUrl;
                  },
                },
              )
            }
          >
            <IconDownload className="h-4 w-4" />
            Download
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              if (previewUrl) void navigator.clipboard?.writeText(previewUrl);
            }}
          >
            <IconCopy className="h-4 w-4" />
            Copy URL
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                <IconTrash className="h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete asset?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the asset from the library. Existing exports that
                  already use this URL may stop rendering.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() =>
                    deleteAsset.mutate(
                      { id: asset.id },
                      {
                        onSuccess: () =>
                          navigate(`/library/${asset.libraryId}`),
                      },
                    )
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </aside>
      <div className="flex min-h-0 items-center justify-center bg-muted/30 p-6">
        {isVideo ? (
          <video
            src={previewUrl}
            controls
            playsInline
            className="max-h-full max-w-full rounded-lg border border-border bg-black object-contain shadow-sm"
          />
        ) : (
          <AssetImagePreview
            src={previewUrl}
            alt={asset.altText || asset.title || ""}
          />
        )}
      </div>
    </div>
  );
}

function AssetImagePreview({
  src,
  alt,
}: {
  src: string | undefined;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex min-h-48 min-w-72 items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 text-sm font-medium text-muted-foreground">
        Preview unavailable
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-sm"
      onError={() => setFailed(true)}
    />
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={multiline ? "mt-1 whitespace-pre-wrap" : "mt-1 truncate"}>
        {value}
      </div>
    </div>
  );
}
