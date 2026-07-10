import { agentNativePath, appBasePath, useT } from "@agent-native/core/client";
import { IconUpload } from "@tabler/icons-react";
import { useRef } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseUploadResponse } from "@/lib/upload-response";

interface ImportButtonProps {
  deckId?: string;
  onImportComplete?: () => void;
}

export function ImportButton({ deckId, onImportComplete }: ImportButtonProps) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const uploadRes = await fetch(`${appBasePath()}/api/uploads`, {
        method: "POST",
        body: formData,
      });
      // R83 — guard the parse: a failed upload can come back as a non-JSON
      // body (upstream proxy/platform error page, plaintext "Internal
      // Error", etc.). Calling uploadRes.json() unconditionally used to
      // throw a raw "Unexpected token ... is not valid JSON" SyntaxError
      // here instead of a clean, catchable failure.
      const uploadData = await parseUploadResponse(uploadRes, "Upload failed");
      if (!uploadRes.ok) {
        throw new Error(uploadData.error || "Upload failed");
      }

      await fetch(agentNativePath("/_agent-native/actions/import-file"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: uploadData.path || uploadData.url,
          deckId,
        }),
      });

      onImportComplete?.();
    } catch (err) {
      console.error("Import failed:", err);
    }

    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => fileRef.current?.click()}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
        >
          <IconUpload className="w-4 h-4" />
          <input
            ref={fileRef}
            type="file"
            accept=".pptx,.docx,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("raw.importFileTypes")}</TooltipContent>
    </Tooltip>
  );
}
