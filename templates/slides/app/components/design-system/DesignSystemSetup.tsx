import { useState, useCallback } from "react";
import {
  IconUpload,
  IconWorld,
  IconPalette,
  IconLoader2,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DesignSystemSetupProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  editingId?: string;
}

export function DesignSystemSetup({
  open,
  onClose,
  onComplete,
  editingId,
}: DesignSystemSetupProps) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [brandNotes, setBrandNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type === "application/pdf" ||
        f.name.endsWith(".svg"),
    );
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
      }
    },
    [],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const endpoint = editingId
        ? "/_agent-native/actions/update-design-system"
        : "/_agent-native/actions/create-design-system";

      const payload: Record<string, unknown> = {
        title: companyName || "My Brand",
        description: brandNotes || undefined,
        data: JSON.stringify({
          colors: {
            primary: "#609FF8",
            secondary: "#4ADE80",
            accent: "#00E5FF",
            background: "#000000",
            surface: "#0a0a0a",
            text: "#ffffff",
            textMuted: "rgba(255,255,255,0.55)",
          },
          typography: {
            headingFont: "Poppins",
            bodyFont: "Inter",
            headingWeight: "900",
            bodyWeight: "400",
            headingSizes: { h1: "64px", h2: "40px", h3: "28px" },
          },
          spacing: { slidePadding: "80px 110px", elementGap: "20px" },
          borders: { radius: "12px", accentWidth: "4px" },
          slideDefaults: { background: "#000000", labelStyle: "uppercase" },
          logos: [],
          notes: brandNotes || undefined,
        }),
      };

      if (editingId) {
        payload.id = editingId;
      }

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Reset form
      setCompanyName("");
      setWebsiteUrl("");
      setBrandNotes("");
      setFiles([]);
      onComplete();
    } catch (err) {
      console.error("Failed to save design system:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[hsl(240,5%,8%)] border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="text-white/90 flex items-center gap-2">
            <IconPalette className="w-5 h-5 text-[#609FF8]" />
            {editingId ? "Edit Design System" : "New Design System"}
          </DialogTitle>
          <DialogDescription className="text-white/40">
            Define your brand identity. Colors, fonts, and logos will be applied
            to every new deck.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Company Name */}
          <div className="space-y-2">
            <Label htmlFor="company-name" className="text-white/70">
              Company / Brand Name
            </Label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc."
              className="bg-white/[0.04] border-white/[0.08] text-white/90 placeholder:text-white/25"
            />
          </div>

          {/* Website URL */}
          <div className="space-y-2">
            <Label htmlFor="website-url" className="text-white/70">
              Website URL
            </Label>
            <div className="relative">
              <IconWorld className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <Input
                id="website-url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://acme.com"
                className="bg-white/[0.04] border-white/[0.08] text-white/90 placeholder:text-white/25 pl-9"
              />
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label className="text-white/70">
              Brand Assets (logos, fonts, guidelines)
            </Label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`relative rounded-lg border-2 border-dashed p-6 text-center ${
                dragOver
                  ? "border-[#609FF8]/50 bg-[#609FF8]/5"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              <IconUpload className="w-6 h-6 text-white/25 mx-auto mb-2" />
              <p className="text-sm text-white/40">
                Drop files here or{" "}
                <label className="text-[#609FF8] hover:text-[#609FF8]/80 cursor-pointer">
                  browse
                  <input
                    type="file"
                    multiple
                    accept="image/*,.svg,.pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </p>
              <p className="text-xs text-white/20 mt-1">
                SVG, PNG, PDF up to 10MB
              </p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-1.5 mt-3">
                {files.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]"
                  >
                    <span className="text-sm text-white/70 truncate">
                      {file.name}
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-xs text-white/30 hover:text-white/60 shrink-0 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Brand Notes */}
          <div className="space-y-2">
            <Label htmlFor="brand-notes" className="text-white/70">
              Brand Notes
            </Label>
            <Textarea
              id="brand-notes"
              value={brandNotes}
              onChange={(e) => setBrandNotes(e.target.value)}
              placeholder="Describe your brand style, preferred colors, tone, or any guidelines..."
              rows={3}
              className="bg-white/[0.04] border-white/[0.08] text-white/90 placeholder:text-white/25 resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={generating}
            className="text-white/50 hover:text-white/80 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="cursor-pointer"
          >
            {generating ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : editingId ? (
              "Save Changes"
            ) : (
              "Create Design System"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
