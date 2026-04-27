import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import {
  IconArrowLeft,
  IconBrandGithub,
  IconUpload,
  IconFolder,
  IconX,
} from "@tabler/icons-react";
import {
  AgentSidebar,
  sendToAgentChat,
  openAgentSidebar,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface GitHubLink {
  id: string;
  url: string;
}

interface UploadedAsset {
  id: string;
  name: string;
  type: string;
  size: number;
}

export default function DesignSystemSetup() {
  const navigate = useNavigate();

  const [companyInfo, setCompanyInfo] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLinks, setGithubLinks] = useState<GitHubLink[]>([]);
  const [figFiles, setFigFiles] = useState<UploadedAsset[]>([]);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [notes, setNotes] = useState("");

  const figInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const addGithubLink = useCallback(() => {
    const url = githubUrl.trim();
    if (!url) return;
    setGithubLinks((prev) => [...prev, { id: crypto.randomUUID(), url }]);
    setGithubUrl("");
  }, [githubUrl]);

  const removeGithubLink = useCallback((id: string) => {
    setGithubLinks((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleFigUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      const newAssets: UploadedAsset[] = Array.from(files).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type,
        size: f.size,
      }));
      setFigFiles((prev) => [...prev, ...newAssets]);
      e.target.value = "";
    },
    [],
  );

  const handleAssetUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      const newAssets: UploadedAsset[] = Array.from(files).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type,
        size: f.size,
      }));
      setAssets((prev) => [...prev, ...newAssets]);
      e.target.value = "";
    },
    [],
  );

  const handleContinue = useCallback(() => {
    const parts: string[] = [];

    parts.push("Set up a design system for the following company/brand.");

    if (companyInfo.trim()) {
      parts.push(`\nCompany info:\n${companyInfo.trim()}`);
    }

    if (githubLinks.length > 0) {
      parts.push(
        `\nGitHub repositories:\n${githubLinks.map((l) => `- ${l.url}`).join("\n")}`,
      );
    }

    if (figFiles.length > 0) {
      parts.push(
        `\nFigma files provided:\n${figFiles.map((f) => `- ${f.name}`).join("\n")}`,
      );
    }

    if (assets.length > 0) {
      parts.push(
        `\nBrand assets provided:\n${assets.map((a) => `- ${a.name} (${a.type})`).join("\n")}`,
      );
    }

    if (notes.trim()) {
      parts.push(`\nAdditional notes:\n${notes.trim()}`);
    }

    openAgentSidebar();
    sendToAgentChat({ message: parts.join("\n"), submit: true });
    navigate("/design-systems");
  }, [companyInfo, githubLinks, figFiles, assets, notes, navigate]);

  return (
    <AgentSidebar
      position="right"
      emptyStateText="I'll help set up your design system"
      suggestions={[
        "Analyze my company's website for brand assets",
        "Create a minimal design system",
        "Set up a dark theme design system",
      ]}
    >
      <div className="min-h-screen bg-[hsl(240,6%,4%)]">
        {/* Header */}
        <header className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <button
              onClick={() => navigate("/design-systems")}
              className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 cursor-pointer"
            >
              <IconArrowLeft className="w-4 h-4" />
              Back
            </button>
            <Button
              size="sm"
              onClick={handleContinue}
              className="cursor-pointer"
            >
              Continue to generation
            </Button>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white/90 mb-2">
              Set up your design system
            </h1>
            <p className="text-sm text-white/40">
              Tell us about your company and attach any design resources you
              have.
            </p>
          </div>

          <div className="space-y-8">
            {/* Company name and blurb */}
            <section>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Company name and description
              </label>
              <Textarea
                value={companyInfo}
                onChange={(e) => setCompanyInfo(e.target.value)}
                placeholder="e.g. Acme Corp — We build developer tools for modern teams..."
                rows={3}
                className="bg-white/[0.04] border-white/[0.06]"
              />
            </section>

            {/* Design examples */}
            <section>
              <h2 className="text-sm font-medium text-white/70 mb-4">
                Provide examples of your design system and products
              </h2>

              {/* GitHub links */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconBrandGithub className="w-4 h-4 text-white/40" />
                  <span className="text-sm text-white/50">
                    Link code on GitHub
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                    className="bg-white/[0.04] border-white/[0.06]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addGithubLink();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addGithubLink}
                    className="cursor-pointer shrink-0"
                  >
                    Add
                  </Button>
                </div>
                {githubLinks.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {githubLinks.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center gap-2 text-sm text-white/60 bg-white/[0.03] rounded-md px-3 py-1.5"
                      >
                        <span className="truncate flex-1">{link.url}</span>
                        <button
                          onClick={() => removeGithubLink(link.id)}
                          className="text-white/30 hover:text-white/50 shrink-0 cursor-pointer"
                        >
                          <IconX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Folder drop zone */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconFolder className="w-4 h-4 text-white/40" />
                  <span className="text-sm text-white/50">
                    Link code from your computer
                  </span>
                </div>
                <div className="border border-dashed border-white/[0.08] rounded-lg p-6 text-center hover:border-white/[0.15]">
                  <p className="text-xs text-white/30">
                    Drag and drop a folder here
                  </p>
                </div>
              </div>

              {/* Figma file upload */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconUpload className="w-4 h-4 text-white/40" />
                  <span className="text-sm text-white/50">
                    Upload a .fig file
                  </span>
                </div>
                <button
                  onClick={() => figInputRef.current?.click()}
                  className="w-full border border-dashed border-white/[0.08] rounded-lg p-6 text-center hover:border-white/[0.15] cursor-pointer"
                >
                  <p className="text-xs text-white/30">
                    Click or drag to upload .fig files
                  </p>
                  <p className="text-[10px] text-white/20 mt-1">
                    Parsed locally in your browser — never uploaded
                  </p>
                </button>
                <input
                  ref={figInputRef}
                  type="file"
                  accept=".fig"
                  multiple
                  onChange={handleFigUpload}
                  className="hidden"
                />
                {figFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {figFiles.map((f) => (
                      <div
                        key={f.id}
                        className="text-sm text-white/60 bg-white/[0.03] rounded-md px-3 py-1.5"
                      >
                        {f.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Brand assets */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <IconUpload className="w-4 h-4 text-white/40" />
                  <span className="text-sm text-white/50">
                    Add fonts, logos and assets
                  </span>
                </div>
                <button
                  onClick={() => assetInputRef.current?.click()}
                  className="w-full border border-dashed border-white/[0.08] rounded-lg p-6 text-center hover:border-white/[0.15] cursor-pointer"
                >
                  <p className="text-xs text-white/30">
                    Click or drag to upload brand assets
                  </p>
                </button>
                <input
                  ref={assetInputRef}
                  type="file"
                  multiple
                  onChange={handleAssetUpload}
                  className="hidden"
                />
                {assets.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {assets.map((a) => (
                      <div
                        key={a.id}
                        className="text-sm text-white/60 bg-white/[0.03] rounded-md px-3 py-1.5"
                      >
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Additional notes */}
            <section>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Any other notes?
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Design preferences, constraints, brand guidelines..."
                rows={3}
                className="bg-white/[0.04] border-white/[0.06]"
              />
            </section>

            {/* Bottom CTA */}
            <div className="pt-4">
              <Button
                onClick={handleContinue}
                className="w-full cursor-pointer"
                size="lg"
              >
                Continue to generation
              </Button>
            </div>
          </div>
        </main>
      </div>
    </AgentSidebar>
  );
}
