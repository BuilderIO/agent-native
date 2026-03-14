import { useState, useRef, useEffect } from "react";
import { Save, ChevronDown, Edit2, Trash2, Check, X, RefreshCw, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useImagePresets } from "@/hooks/use-image-presets";

interface PresetManagerProps {
  selectedPaths: string[];
  onLoadPreset: (paths: string[]) => void;
}

export function PresetManager({ selectedPaths, onLoadPreset }: PresetManagerProps) {
  const { presets, savePreset, deletePreset, updatePreset } = useImagePresets();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [editName, setEditName] = useState("");
  const [editingInstructionsId, setEditingInstructionsId] = useState<string | null>(null);
  const [editInstructions, setEditInstructions] = useState("");
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const [lastLoadedPresetId, setLastLoadedPresetId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Find active preset (exact match)
  const activePreset = presets.find(
    (p) =>
      selectedPaths.length === p.paths.length &&
      p.paths.every((path) => selectedPaths.includes(path))
  );

  // Detect if selection has been modified from the last loaded preset
  const lastLoadedPreset = lastLoadedPresetId ? presets.find(p => p.id === lastLoadedPresetId) : null;
  const selectionModified = lastLoadedPreset && !activePreset && selectedPaths.length > 0;

  useEffect(() => {
    if (showSaveDialog && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showSaveDialog]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleSave = () => {
    if (!presetName.trim() || selectedPaths.length === 0) return;
    savePreset(presetName.trim(), selectedPaths);
    setPresetName("");
    setShowSaveDialog(false);
  };

  const handleLoadOrClear = (preset: typeof presets[0]) => {
    // If this preset is already active, clear selection
    if (activePreset?.id === preset.id) {
      onLoadPreset([]);
      setLastLoadedPresetId(null);
    } else {
      onLoadPreset(preset.paths);
      setLastLoadedPresetId(preset.id);
    }
    setShowMenu(false);
  };

  const handleUpdatePreset = () => {
    if (!lastLoadedPreset || selectedPaths.length === 0) return;
    updatePreset(lastLoadedPreset.id, { paths: selectedPaths });
    // After update, the activePreset check will match again
  };

  const handleEdit = (preset: typeof presets[0]) => {
    setEditingId(preset.id);
    setEditName(preset.name);
  };

  const handleEditInstructions = (preset: typeof presets[0]) => {
    setEditingInstructionsId(preset.id);
    setEditInstructions(preset.instructions || "");
    setTimeout(() => instructionsRef.current?.focus(), 50);
  };

  const handleSaveInstructions = (id: string) => {
    updatePreset(id, { instructions: editInstructions.trim() });
    setEditingInstructionsId(null);
    setEditInstructions("");
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) return;
    updatePreset(id, { name: editName.trim() });
    setEditingId(null);
    setEditName("");
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this preset?")) {
      deletePreset(id);
      setEditingId(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Preset dropdown */}
      {presets.length > 0 && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border border-border transition-colors",
              activePreset
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {activePreset ? (
              <>
                <Check size={10} />
                {activePreset.name}
                <span className="text-[10px] opacity-60">({activePreset.paths.length})</span>
              </>
            ) : (
              "Presets"
            )}
            <ChevronDown size={10} />
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-full left-0 mt-1 min-w-[200px] rounded-md border border-border bg-background shadow-lg z-50">
              <div className="p-1 space-y-0.5 max-h-[300px] overflow-y-auto">
                {presets.map((preset) => {
                  const isActive = activePreset?.id === preset.id;
                  const isEditing = editingId === preset.id;

                  return (
                    <div
                      key={preset.id}
                      className={cn(
                        "group rounded-md transition-colors",
                        isActive && !isEditing && "bg-muted"
                      )}
                    >
                      {isEditing ? (
                        // Edit mode
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(preset.id);
                              if (e.key === "Escape") {
                                setEditingId(null);
                                setEditName("");
                              }
                            }}
                            className="flex-1 rounded border border-input bg-muted px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                          <button
                            onClick={() => handleSaveEdit(preset.id)}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditName("");
                            }}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        // Normal mode
                        <div className="flex items-center">
                          <button
                            onClick={() => handleLoadOrClear(preset)}
                            className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-muted rounded-md transition-colors"
                          >
                            {isActive && <Check size={10} className="text-foreground" />}
                            <span className={cn("font-medium", isActive && "text-foreground")}>
                              {preset.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {preset.paths.length}
                            </span>
                          </button>
                          <div className="flex items-center gap-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleEditInstructions(preset)}
                              className={cn(
                                "p-1 rounded hover:bg-muted",
                                preset.instructions ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                              )}
                              title={preset.instructions ? "Edit instructions" : "Add instructions"}
                            >
                              <FileText size={10} />
                            </button>
                            <button
                              onClick={() => handleEdit(preset)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                              title="Edit preset"
                            >
                              <Edit2 size={10} />
                            </button>
                            <button
                              onClick={() => handleDelete(preset.id)}
                              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Delete preset"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Instructions editor */}
                      {editingInstructionsId === preset.id && (
                        <div className="px-2 pb-2 pt-1">
                          <textarea
                            ref={instructionsRef}
                            value={editInstructions}
                            onChange={(e) => setEditInstructions(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setEditingInstructionsId(null);
                                setEditInstructions("");
                              }
                            }}
                            placeholder="Instructions for AI image generation (e.g. minimal text, specific composition rules)..."
                            className="w-full rounded border border-input bg-muted px-2 py-1.5 text-[11px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none leading-relaxed"
                            rows={3}
                          />
                          <div className="flex items-center gap-1 mt-1 justify-end">
                            <button
                              onClick={() => {
                                setEditingInstructionsId(null);
                                setEditInstructions("");
                              }}
                              className="px-2 py-0.5 text-[10px] rounded text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveInstructions(preset.id)}
                              className="px-2 py-0.5 text-[10px] rounded bg-foreground text-background hover:opacity-90"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Show existing instructions inline */}
                      {preset.instructions && editingInstructionsId !== preset.id && (
                        <div className="px-2 pb-1.5">
                          <p className="text-[10px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                            {preset.instructions}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Update / Save preset */}
      {selectionModified && (
        <button
          onClick={handleUpdatePreset}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-yellow-600/50 bg-yellow-600/10 text-yellow-500 hover:bg-yellow-600/20 transition-colors"
        >
          <RefreshCw size={10} />
          Update "{lastLoadedPreset!.name}"
        </button>
      )}
      {selectedPaths.length > 0 && (
        <>
          {!showSaveDialog ? (
            <button
              onClick={() => setShowSaveDialog(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Save size={10} />
              Save as preset
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") {
                    setShowSaveDialog(false);
                    setPresetName("");
                  }
                }}
                placeholder="Preset name..."
                className="w-32 rounded-md border border-input bg-muted px-2 py-1 text-[11px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                onClick={handleSave}
                disabled={!presetName.trim()}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setPresetName("");
                }}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
