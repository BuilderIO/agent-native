import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Play, Maximize2 } from "lucide-react";

interface SqlEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initialSql: string;
  onExecute: (sql: string) => void;
}

export function SqlEditorModal({
  isOpen,
  onClose,
  title,
  initialSql,
  onExecute,
}: SqlEditorModalProps) {
  const [sql, setSql] = useState(initialSql);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });
  const contentRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);

  const handleExecute = () => {
    onExecute(sql);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
  };

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: dimensions.width,
      startHeight: dimensions.height,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;

      const deltaX = moveEvent.clientX - resizeRef.current.startX;
      const deltaY = moveEvent.clientY - resizeRef.current.startY;

      let newWidth = resizeRef.current.startWidth;
      let newHeight = resizeRef.current.startHeight;

      if (direction.includes('e')) {
        newWidth = Math.max(400, Math.min(window.innerWidth - 100, resizeRef.current.startWidth + deltaX));
      }
      if (direction.includes('w')) {
        newWidth = Math.max(400, Math.min(window.innerWidth - 100, resizeRef.current.startWidth - deltaX));
      }
      if (direction.includes('s')) {
        newHeight = Math.max(300, Math.min(window.innerHeight - 100, resizeRef.current.startHeight + deltaY));
      }
      if (direction.includes('n')) {
        newHeight = Math.max(300, Math.min(window.innerHeight - 100, resizeRef.current.startHeight - deltaY));
      }

      setDimensions({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction.includes('e') || direction.includes('w') ? 'ew-resize' : 
                                  direction.includes('n') || direction.includes('s') ? 'ns-resize' : 
                                  'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        ref={contentRef}
        className="flex flex-col p-0 gap-0 overflow-hidden"
        style={{ 
          width: `${dimensions.width}px`, 
          height: `${dimensions.height}px`,
          maxWidth: 'none',
          maxHeight: 'none',
        }}
      >
        {/* Resize Handles */}
        <div 
          className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize z-50"
          onMouseDown={(e) => handleResizeStart(e, 'ne')}
        />
        <div 
          className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-50"
          onMouseDown={(e) => handleResizeStart(e, 'nw')}
        />
        <div 
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-50"
          onMouseDown={(e) => handleResizeStart(e, 'se')}
        >
          <Maximize2 className="h-3 w-3 text-muted-foreground/50" />
        </div>
        <div 
          className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-50"
          onMouseDown={(e) => handleResizeStart(e, 'sw')}
        />
        
        {/* Edge handles */}
        <div 
          className="absolute top-0 left-4 right-4 h-2 cursor-ns-resize z-40"
          onMouseDown={(e) => handleResizeStart(e, 'n')}
        />
        <div 
          className="absolute bottom-0 left-4 right-4 h-2 cursor-ns-resize z-40"
          onMouseDown={(e) => handleResizeStart(e, 's')}
        />
        <div 
          className="absolute left-0 top-4 bottom-4 w-2 cursor-ew-resize z-40"
          onMouseDown={(e) => handleResizeStart(e, 'w')}
        />
        <div 
          className="absolute right-0 top-4 bottom-4 w-2 cursor-ew-resize z-40"
          onMouseDown={(e) => handleResizeStart(e, 'e')}
        />

        <DialogHeader className="p-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            View and edit the SQL query. Click "Execute" to run the updated query. Drag edges or corners to resize.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 flex flex-col gap-3 overflow-hidden px-6 pb-6">
          <Textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="flex-1 font-mono text-xs resize-none"
            placeholder="Enter SQL query..."
          />
          
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-2"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecute}
                className="gap-2"
              >
                <Play className="h-3.5 w-3.5" />
                Execute Query
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
