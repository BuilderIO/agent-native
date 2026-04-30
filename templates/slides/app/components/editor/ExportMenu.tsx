import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconDownload,
  IconFileTypePdf,
  IconCode,
  IconCopy,
  IconShare2,
} from "@tabler/icons-react";
import { toast } from "@/hooks/use-toast";
import { agentNativePath, appBasePath } from "@agent-native/core/client";

interface ExportMenuProps {
  deckId: string;
  deckTitle: string;
  onDuplicate: () => void;
  onExportPdf: () => void;
  onShareLink?: () => void;
  onShareTeam?: () => void;
}

export function ExportMenu({
  deckId,
  deckTitle,
  onDuplicate,
  onExportPdf,
  onShareLink,
  onShareTeam,
}: ExportMenuProps) {
  // Programmatic anchor download — avoids the popup blocker that silently
  // kills window.open() after an async fetch (no direct user gesture left).
  const triggerDownload = (filename: string) => {
    const a = document.createElement("a");
    a.href = `${appBasePath()}/api/exports/${filename}`;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleExportPptx = async () => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/export-pptx"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckId }),
        },
      );
      const data = await res.json();
      if (data.filename) {
        triggerDownload(data.filename);
      } else {
        toast({
          title: "Export failed",
          description: data.error || "Could not generate PPTX file.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Export failed:", err);
      toast({
        title: "Export failed",
        description: "Something went wrong exporting as PPTX.",
        variant: "destructive",
      });
    }
  };

  const handleExportHtml = async () => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/export-html"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckId }),
        },
      );
      const data = await res.json();
      if (data.filename) {
        triggerDownload(data.filename);
      } else {
        toast({
          title: "Export failed",
          description: data.error || "Could not generate HTML file.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Export failed:", err);
      toast({
        title: "Export failed",
        description: "Something went wrong exporting as HTML.",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent text-xs cursor-pointer">
          <IconDownload className="w-3.5 h-3.5" />
          Export
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          Export & Duplicate
        </DropdownMenuLabel>
        {onShareTeam && (
          <DropdownMenuItem onClick={onShareTeam} className="cursor-pointer">
            <IconShare2 className="w-4 h-4 mr-2" />
            Share with team...
          </DropdownMenuItem>
        )}
        {onShareLink && (
          <DropdownMenuItem onClick={onShareLink} className="cursor-pointer">
            <IconShare2 className="w-4 h-4 mr-2" />
            Public share link...
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleExportHtml} className="cursor-pointer">
          <IconCode className="w-4 h-4 mr-2" />
          Download as HTML
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportPdf} className="cursor-pointer">
          <IconFileTypePdf className="w-4 h-4 mr-2" />
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPptx} className="cursor-pointer">
          <IconDownload className="w-4 h-4 mr-2" />
          Export as PPTX
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDuplicate} className="cursor-pointer">
          <IconCopy className="w-4 h-4 mr-2" />
          Duplicate deck
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
