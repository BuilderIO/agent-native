import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useActionQuery } from "@agent-native/core/client";

interface DesignFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
}

interface DesignData {
  id: string;
  title: string;
  files: DesignFile[];
}

export default function Present() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(0);

  const { data: design, isLoading } = useActionQuery<DesignData>("get-design", {
    id: id!,
  });

  const files = design?.files ?? [];

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        navigate(`/design/${id}`);
        return;
      }
      if (files.length <= 1) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setCurrentPage((p) => Math.min(p + 1, files.length - 1));
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentPage((p) => Math.max(p - 1, 0));
      }
    },
    [id, navigate, files.length],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!id) {
    navigate("/");
    return null;
  }

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white/30" />
      </div>
    );
  }

  if (!design || files.length === 0) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center gap-4">
        <p className="text-white/50 text-sm">No content to present</p>
        <button
          onClick={() => navigate(`/design/${id}`)}
          className="text-sm text-white/40 hover:text-white/60 underline cursor-pointer"
        >
          Back to editor
        </button>
      </div>
    );
  }

  const activeFile = files[currentPage] ?? files[0];

  return (
    <div className="h-screen w-screen bg-black overflow-hidden">
      <iframe
        srcDoc={activeFile.content}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0"
        title={`${design.title} — ${activeFile.filename}`}
      />

      {/* Page indicator */}
      {files.length > 1 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 rounded-full px-3 py-1.5">
          {files.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={`w-2 h-2 rounded-full cursor-pointer ${
                i === currentPage ? "bg-white" : "bg-white/30"
              }`}
            />
          ))}
        </div>
      )}

      {/* Exit hint */}
      <div className="fixed top-4 right-4 text-xs text-white/20">
        Press Esc to exit
      </div>
    </div>
  );
}
