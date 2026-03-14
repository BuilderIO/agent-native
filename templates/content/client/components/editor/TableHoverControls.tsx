import { useEffect, useState, useRef } from "react";
import { Editor } from "@tiptap/react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface TableHoverControlsProps {
  editor: Editor;
}

export function TableHoverControls({ editor }: TableHoverControlsProps) {
  const [hoveredCell, setHoveredCell] = useState<HTMLElement | null>(null);
  const [table, setTable] = useState<HTMLElement | null>(null);
  const [cellRect, setCellRect] = useState<DOMRect | null>(null);
  const [tableRect, setTableRect] = useState<DOMRect | null>(null);
  
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      let cell = target.closest("td, th") as HTMLElement;
      let tableEl = target.closest("table") as HTMLElement;
      const isControl = target.closest('.table-hover-controls');

      // Add 24px hover forgiveness logic
      if (!cell || !tableEl) {
        // If we are not directly over a cell, check if we're near one
        const tables = Array.from(editor.view.dom.querySelectorAll("table"));
        for (const t of tables) {
          const rect = t.getBoundingClientRect();
          // Check if we are within 24px of the table
          if (
            e.clientX >= rect.left - 24 &&
            e.clientX <= rect.right + 24 &&
            e.clientY >= rect.top - 24 &&
            e.clientY <= rect.bottom + 24
          ) {
            // Find the closest row based on Y coordinate
            const rows = Array.from(t.querySelectorAll("tr"));
            let closestRow = rows[0];
            let minDistanceY = Infinity;

            for (const r of rows) {
              const rRect = r.getBoundingClientRect();
              const distY = Math.max(0, rRect.top - e.clientY, e.clientY - rRect.bottom);
              if (distY < minDistanceY) {
                minDistanceY = distY;
                closestRow = r;
              }
            }

            // Find the closest cell in that row based on X coordinate
            if (closestRow) {
              const cells = Array.from(closestRow.querySelectorAll("td, th")) as HTMLElement[];
              let closestCell = cells[0];
              let minDistanceX = Infinity;

              for (const c of cells) {
                const cRect = c.getBoundingClientRect();
                const distX = Math.max(0, cRect.left - e.clientX, e.clientX - cRect.right);
                if (distX < minDistanceX) {
                  minDistanceX = distX;
                  closestCell = c;
                }
              }

              if (closestCell) {
                cell = closestCell;
                tableEl = t;
                break; // Found our nearby cell
              }
            }
          }
        }
      }

      if ((cell && tableEl && editor.view.dom.contains(tableEl)) || isControl) {
        if (hideTimeout.current) {
          clearTimeout(hideTimeout.current);
          hideTimeout.current = null;
        }
        
        if (cell && tableEl) {
          setHoveredCell(cell);
          setTable(tableEl);
          setCellRect(cell.getBoundingClientRect());
          setTableRect(tableEl.getBoundingClientRect());
        }
      } else {
        if (!hideTimeout.current && hoveredCell) {
          hideTimeout.current = setTimeout(() => {
            setHoveredCell(null);
            setTable(null);
          }, 150);
        }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [editor, hoveredCell]);

  if (!hoveredCell || !table || !cellRect || !tableRect) return null;

  const wrapper = editor.view.dom.closest('.visual-editor-wrapper') as HTMLElement;
  const wrapperRect = wrapper?.getBoundingClientRect();
  
  if (!wrapperRect) return null;

  const handleAction = (action: 'addCol' | 'delCol' | 'addRow' | 'delRow') => {
    if (!hoveredCell) return;
    
    try {
      const pos = editor.view.posAtDOM(hoveredCell, 0);
      if (pos < 0) return;
      
      editor.chain().focus().setTextSelection(pos).run();
      
      switch (action) {
        case 'addCol':
          editor.chain().focus().addColumnAfter().run();
          break;
        case 'delCol': {
          const currentTable = hoveredCell.closest("table");
          const colsCount = currentTable?.querySelector("tr")?.querySelectorAll("td, th").length || 0;
          if (colsCount <= 1) {
            editor.chain().focus().deleteTable().run();
          } else {
            editor.chain().focus().deleteColumn().run();
          }
          break;
        }
        case 'addRow':
          editor.chain().focus().addRowAfter().run();
          break;
        case 'delRow': {
          const currentTable = hoveredCell.closest("table");
          const rowsCount = currentTable?.querySelectorAll("tr").length || 0;
          if (rowsCount <= 1) {
            editor.chain().focus().deleteTable().run();
          } else {
            editor.chain().focus().deleteRow().run();
          }
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
    
    setHoveredCell(null);
    setTable(null);
  };

  const colLeft = cellRect.left - wrapperRect.left + (cellRect.width / 2);
  const colTop = tableRect.top - wrapperRect.top - 8;

  const rowLeft = tableRect.left - wrapperRect.left - 8;
  const rowTop = cellRect.top - wrapperRect.top + (cellRect.height / 2);

  return (
    <>
      <div 
        className="table-hover-controls flex items-center gap-0.5 absolute z-50 transform -translate-x-1/2 -translate-y-full bg-background shadow-sm border border-border rounded-md p-0.5 transition-opacity"
        style={{ left: colLeft, top: colTop }}
      >
        <button 
          onClick={() => handleAction('addCol')} 
          title="Add column"
          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus size={14} strokeWidth={2.5}/>
        </button>
        <button 
          onClick={() => handleAction('delCol')} 
          title="Delete column"
          className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive transition-colors"
        >
          <Minus size={14} strokeWidth={2.5}/>
        </button>
      </div>

      <div 
        className="table-hover-controls flex flex-col items-center gap-0.5 absolute z-50 transform -translate-x-full -translate-y-1/2 bg-background shadow-sm border border-border rounded-md p-0.5 transition-opacity"
        style={{ left: rowLeft, top: rowTop }}
      >
        <button 
          onClick={() => handleAction('addRow')} 
          title="Add row"
          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus size={14} strokeWidth={2.5}/>
        </button>
        <button 
          onClick={() => handleAction('delRow')} 
          title="Delete row"
          className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive transition-colors"
        >
          <Minus size={14} strokeWidth={2.5}/>
        </button>
      </div>
    </>
  );
}
