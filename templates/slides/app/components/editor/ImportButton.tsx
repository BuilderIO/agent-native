import { useRef } from "react";
import { IconUpload } from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ImportButtonProps {
  deckId?: string;
  onImportComplete?: () => void;
}

export function ImportButton({ deckId, onImportComplete }: ImportButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const uploadRes = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadRes.json();

      await fetch("/_agent-native/actions/import-file", {
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
          className="p-1.5 rounded text-white/40 hover:text-white/70 hover:bg-white/[0.06] cursor-pointer"
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
      <TooltipContent>Import PPTX, DOCX, or PDF</TooltipContent>
    </Tooltip>
  );
}
