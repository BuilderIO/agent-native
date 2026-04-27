import { useState, useCallback, useRef, useEffect } from "react";
import {
  IconZoomIn,
  IconZoomOut,
  IconMaximize,
  IconChevronDown,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ZOOM_PRESETS } from "./types";

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

export function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleZoomIn = useCallback(() => {
    const next = ZOOM_PRESETS.find((p) => p > zoom);
    onZoomChange(next ?? 200);
  }, [zoom, onZoomChange]);

  const handleZoomOut = useCallback(() => {
    const prev = [...ZOOM_PRESETS].reverse().find((p) => p < zoom);
    onZoomChange(prev ?? 50);
  }, [zoom, onZoomChange]);

  const handleFitToScreen = useCallback(() => {
    onZoomChange(100);
  }, [onZoomChange]);

  const handleStartEdit = useCallback(() => {
    setEditValue(String(zoom));
    setIsEditing(true);
  }, [zoom]);

  const handleCommitEdit = useCallback(() => {
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 500) {
      onZoomChange(parsed);
    }
    setIsEditing(false);
  }, [editValue, onZoomChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleCommitEdit();
      }
      if (e.key === "Escape") {
        setIsEditing(false);
      }
    },
    [handleCommitEdit],
  );

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-md border border-border px-1 h-8">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleZoomOut}
        disabled={zoom <= 50}
      >
        <IconZoomOut className="w-3.5 h-3.5" />
      </Button>

      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleCommitEdit}
          onKeyDown={handleKeyDown}
          className="w-12 h-6 text-xs text-center bg-background border border-border rounded px-1 outline-none"
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-0.5 px-1.5 h-6 text-xs text-foreground tabular-nums hover:bg-accent rounded"
            >
              {zoom}%
              <IconChevronDown className="w-3 h-3 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-24">
            {ZOOM_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset}
                onClick={() => onZoomChange(preset)}
                className="text-xs justify-center tabular-nums"
              >
                {preset}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleZoomIn}
        disabled={zoom >= 200}
      >
        <IconZoomIn className="w-3.5 h-3.5" />
      </Button>

      <div className="w-px h-4 bg-border mx-0.5" />

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleFitToScreen}
        title="Fit to screen"
      >
        <IconMaximize className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
