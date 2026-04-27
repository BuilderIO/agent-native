import { useState, useRef, useEffect, useCallback } from "react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import {
  IconPlus,
  IconCheck,
  IconTrash,
  IconPencil,
  IconFlag,
  IconCalendar,
  IconChevronRight,
  IconListCheck,
  IconDotsVertical,
  IconCircleCheck,
  IconCircle,
  IconX,
  IconChevronDown,
  IconInbox,
  IconStar,
  IconAlertCircle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TodoList {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string | null;
  position: number;
  totalCount: number;
  completedCount: number;
}

interface Todo {
  id: string;
  listId: string;
  title: string;
  notes: string;
  completed: boolean;
  priority: "none" | "low" | "medium" | "high";
  dueDate: string | null;
  position: number;
  createdAt: string;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

const LIST_COLORS: Record<
  string,
  { bg: string; text: string; ring: string; dot: string }
> = {
  blue: {
    bg: "bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    ring: "ring-blue-500/30",
    dot: "bg-blue-500",
  },
  green: {
    bg: "bg-green-500/10",
    text: "text-green-600 dark:text-green-400",
    ring: "ring-green-500/30",
    dot: "bg-green-500",
  },
  red: {
    bg: "bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
    ring: "ring-red-500/30",
    dot: "bg-red-500",
  },
  purple: {
    bg: "bg-purple-500/10",
    text: "text-purple-600 dark:text-purple-400",
    ring: "ring-purple-500/30",
    dot: "bg-purple-500",
  },
  orange: {
    bg: "bg-orange-500/10",
    text: "text-orange-600 dark:text-orange-400",
    ring: "ring-orange-500/30",
    dot: "bg-orange-500",
  },
  pink: {
    bg: "bg-pink-500/10",
    text: "text-pink-600 dark:text-pink-400",
    ring: "ring-pink-500/30",
    dot: "bg-pink-500",
  },
  teal: {
    bg: "bg-teal-500/10",
    text: "text-teal-600 dark:text-teal-400",
    ring: "ring-teal-500/30",
    dot: "bg-teal-500",
  },
};

const PRIORITY_CONFIG = {
  none: { label: "No priority", icon: null, color: "text-muted-foreground" },
  low: { label: "Low", icon: IconFlag, color: "text-blue-500" },
  medium: { label: "Medium", icon: IconFlag, color: "text-amber-500" },
  high: { label: "High", icon: IconAlertCircle, color: "text-red-500" },
};

// ── TodoItem ──────────────────────────────────────────────────────────────────

function TodoItem({
  todo,
  onToggle,
  onDelete,
  onUpdate,
}: {
  todo: Todo;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Todo>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const priorityCfg = PRIORITY_CONFIG[todo.priority];
  const PriorityIcon = priorityCfg.icon;
  const isOverdue =
    todo.dueDate &&
    !todo.completed &&
    new Date(todo.dueDate) < new Date(new Date().toDateString());

  const handleTitleSave = () => {
    const t = editTitle.trim();
    if (t && t !== todo.title) onUpdate(todo.id, { title: t });
    else setEditTitle(todo.title);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group rounded-xl border border-border/60 bg-card transition-all duration-200",
        todo.completed && "opacity-60",
        "hover:border-border hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle(todo.id, !todo.completed)}
          className={cn(
            "mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
            todo.completed
              ? "border-green-500 bg-green-500 text-white"
              : "border-muted-foreground/40 hover:border-green-500",
          )}
        >
          {todo.completed && <IconCheck size={12} strokeWidth={3} />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTitleSave();
                if (e.key === "Escape") {
                  setEditTitle(todo.title);
                  setEditing(false);
                }
              }}
              className="w-full bg-transparent text-sm outline-none border-b border-primary"
            />
          ) : (
            <span
              className={cn(
                "text-sm leading-snug cursor-text",
                todo.completed && "line-through text-muted-foreground",
              )}
              onDoubleClick={() => setEditing(true)}
            >
              {todo.title}
            </span>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {PriorityIcon && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-xs",
                  priorityCfg.color,
                )}
              >
                <PriorityIcon size={11} />
                {priorityCfg.label}
              </span>
            )}
            {todo.dueDate && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-xs",
                  isOverdue ? "text-red-500" : "text-muted-foreground",
                )}
              >
                <IconCalendar size={11} />
                {new Date(todo.dueDate + "T12:00:00").toLocaleDateString(
                  undefined,
                  {
                    month: "short",
                    day: "numeric",
                  },
                )}
              </span>
            )}
            {todo.notes && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <IconChevronDown
                  size={11}
                  className={cn(
                    "transition-transform",
                    expanded && "rotate-180",
                  )}
                />
                Notes
              </button>
            )}
          </div>

          {expanded && todo.notes && (
            <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 border-border pl-2">
              {todo.notes}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground">
                <IconDotsVertical size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <IconPencil size={14} className="mr-2" />
                Edit title
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Priority
              </div>
              {(["none", "low", "medium", "high"] as const).map((p) => (
                <DropdownMenuItem
                  key={p}
                  onClick={() => onUpdate(todo.id, { priority: p })}
                  className={todo.priority === p ? "bg-accent" : ""}
                >
                  <span className={cn("mr-2", PRIORITY_CONFIG[p].color)}>
                    {PRIORITY_CONFIG[p].icon ? (
                      (() => {
                        const Icon = PRIORITY_CONFIG[p].icon!;
                        return <Icon size={13} />;
                      })()
                    ) : (
                      <span className="w-[13px] block" />
                    )}
                  </span>
                  {PRIORITY_CONFIG[p].label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(todo.id)}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash size={14} className="mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ── NewTodoInput ──────────────────────────────────────────────────────────────

function NewTodoInput({
  listId,
  onAdd,
}: {
  listId: string;
  onAdd: (title: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const t = value.trim();
    if (!t) return;
    onAdd(t);
    setValue("");
  };

  return (
    <div className="flex items-center gap-2 px-1">
      <div className="w-5 h-5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
        <IconPlus size={10} className="text-muted-foreground/50" />
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Add a todo…"
        className="flex-1 bg-transparent text-sm outline-none text-muted-foreground placeholder:text-muted-foreground/50 focus:text-foreground"
      />
      {value && (
        <button
          onClick={handleSubmit}
          className="shrink-0 text-xs text-primary hover:text-primary/80 font-medium"
        >
          Add
        </button>
      )}
    </div>
  );
}

// ── ListPanel ─────────────────────────────────────────────────────────────────

function ListPanel({
  list,
  onDelete,
  onUpdate,
}: {
  list: TodoList;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TodoList>) => void;
}) {
  const colors = LIST_COLORS[list.color] ?? LIST_COLORS.blue;
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingList, setEditingList] = useState(false);
  const [editTitle, setEditTitle] = useState(list.title);

  const { data, refetch } = useActionQuery("todosGet", { listId: list.id });
  const todos: Todo[] = data?.todos ?? [];

  const createTodo = useActionMutation("todoCreate");
  const updateTodo = useActionMutation("todoUpdate");
  const deleteTodo = useActionMutation("todoDelete");
  const clearCompleted = useActionMutation("todosClearCompleted");

  const filtered = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;
  const progress = todos.length > 0 ? (completedCount / todos.length) * 100 : 0;

  const handleAdd = async (title: string) => {
    await createTodo.mutateAsync({ listId: list.id, title });
    refetch();
  };

  const handleToggle = async (id: string, completed: boolean) => {
    await updateTodo.mutateAsync({ id, completed });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await deleteTodo.mutateAsync({ id });
    refetch();
  };

  const handleUpdate = async (id: string, updates: Partial<Todo>) => {
    await updateTodo.mutateAsync({ id, ...updates });
    refetch();
  };

  const handleClearCompleted = async () => {
    await clearCompleted.mutateAsync({ listId: list.id });
    refetch();
  };

  const handleListTitleSave = () => {
    const t = editTitle.trim();
    if (t && t !== list.title) onUpdate(list.id, { title: t });
    else setEditTitle(list.title);
    setEditingList(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* List header */}
      <div className={cn("px-6 pt-6 pb-4 rounded-t-2xl", colors.bg)}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {list.icon && (
              <span className="text-2xl shrink-0">{list.icon}</span>
            )}
            {editingList ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleListTitleSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleListTitleSave();
                  if (e.key === "Escape") {
                    setEditTitle(list.title);
                    setEditingList(false);
                  }
                }}
                className="flex-1 text-2xl font-bold bg-transparent outline-none border-b-2 border-primary"
              />
            ) : (
              <h2
                className={cn(
                  "text-2xl font-bold truncate cursor-pointer",
                  colors.text,
                )}
                onDoubleClick={() => setEditingList(true)}
              >
                {list.title}
              </h2>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground">
                <IconDotsVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setEditingList(true)}>
                <IconPencil size={14} className="mr-2" />
                Rename list
              </DropdownMenuItem>
              {completedCount > 0 && (
                <DropdownMenuItem onClick={handleClearCompleted}>
                  <IconTrash size={14} className="mr-2" />
                  Clear completed
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(list.id)}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash size={14} className="mr-2" />
                Delete list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3">
          <span className={cn("text-sm font-medium", colors.text)}>
            {activeCount} remaining
          </span>
          {completedCount > 0 && (
            <span className="text-sm text-muted-foreground">
              · {completedCount} done
            </span>
          )}
        </div>

        {/* Progress bar */}
        {todos.length > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                colors.dot,
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background/50">
        {(["all", "active", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors",
              filter === f
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Todo list */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <IconListCheck
                size={32}
                className="text-muted-foreground/30 mb-3"
              />
              <p className="text-sm text-muted-foreground">
                {filter === "completed"
                  ? "No completed todos yet"
                  : filter === "active"
                    ? "All caught up! 🎉"
                    : "No todos yet. Add one below!"}
              </p>
            </div>
          ) : (
            filtered.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* New todo input */}
      <div className="px-4 py-3 border-t border-border bg-background/50">
        <NewTodoInput listId={list.id} onAdd={handleAdd} />
      </div>
    </div>
  );
}

// ── NewListDialog ─────────────────────────────────────────────────────────────

function NewListDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, color: string, icon?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("blue");
  const [icon, setIcon] = useState("");

  const handleCreate = () => {
    if (!title.trim()) return;
    onCreate(title.trim(), color, icon.trim() || undefined);
    setTitle("");
    setColor("blue");
    setIcon("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Todo List</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Title</label>
            <Input
              autoFocus
              placeholder="e.g. Work tasks, Shopping…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Icon (optional)</label>
            <Input
              placeholder="Paste an emoji, e.g. 🎯"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(LIST_COLORS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setColor(key)}
                  className={cn(
                    "w-7 h-7 rounded-full transition-all",
                    val.dot,
                    color === key
                      ? "ring-2 ring-offset-2 ring-current scale-110"
                      : "hover:scale-110",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!title.trim()}>
            Create list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main TodoApp ──────────────────────────────────────────────────────────────

export function TodoApp() {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);

  const { data, refetch } = useActionQuery("todoListsGet", {});
  const lists: TodoList[] = data?.lists ?? [];

  const createList = useActionMutation("todoListCreate");
  const updateList = useActionMutation("todoListUpdate");
  const deleteList = useActionMutation("todoListDelete");

  // Auto-select first list
  useEffect(() => {
    if (!selectedListId && lists.length > 0) {
      setSelectedListId(lists[0].id);
    }
  }, [lists, selectedListId]);

  const selectedList = lists.find((l) => l.id === selectedListId);

  const handleCreateList = async (
    title: string,
    color: string,
    icon?: string,
  ) => {
    const result = await createList.mutateAsync({
      title,
      color: color as any,
      icon,
    });
    await refetch();
    setSelectedListId(result.id);
  };

  const handleUpdateList = async (id: string, updates: Partial<TodoList>) => {
    await updateList.mutateAsync({ id, ...updates } as any);
    refetch();
  };

  const handleDeleteList = async (id: string) => {
    await deleteList.mutateAsync({ id });
    await refetch();
    if (selectedListId === id) {
      const remaining = lists.filter((l) => l.id !== id);
      setSelectedListId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col bg-muted/20">
        <div className="flex items-center justify-between px-4 h-14 border-b border-border">
          <span className="font-semibold text-base flex items-center gap-2">
            <IconListCheck size={18} className="text-primary" />
            My Lists
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setNewListOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconPlus size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>New list</TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea className="flex-1 py-2">
          {lists.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">No lists yet</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNewListOpen(true)}
                className="text-xs"
              >
                <IconPlus size={13} className="mr-1" />
                Create a list
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5 px-2">
              {lists.map((list) => {
                const colors = LIST_COLORS[list.color] ?? LIST_COLORS.blue;
                const isSelected = list.id === selectedListId;
                return (
                  <button
                    key={list.id}
                    onClick={() => setSelectedListId(list.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors text-sm",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "w-2.5 h-2.5 rounded-full shrink-0",
                        colors.dot,
                      )}
                    />
                    <span className="flex-1 truncate font-medium">
                      {list.icon && <span className="mr-1">{list.icon}</span>}
                      {list.title}
                    </span>
                    {list.totalCount > 0 && (
                      <span
                        className={cn(
                          "text-xs tabular-nums shrink-0 font-medium",
                          isSelected
                            ? "text-accent-foreground/70"
                            : "text-muted-foreground/60",
                        )}
                      >
                        {list.totalCount - list.completedCount > 0
                          ? list.totalCount - list.completedCount
                          : "✓"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Summary footer */}
        {lists.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>Total tasks</span>
                <span className="font-medium text-foreground">
                  {lists.reduce((s, l) => s + l.totalCount, 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Completed</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {lists.reduce((s, l) => s + l.completedCount, 0)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selectedList ? (
          <ListPanel
            key={selectedList.id}
            list={selectedList}
            onDelete={handleDeleteList}
            onUpdate={handleUpdateList}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <IconListCheck size={32} className="text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">No list selected</h3>
              <p className="text-sm text-muted-foreground">
                Create a list to get started
              </p>
            </div>
            <Button onClick={() => setNewListOpen(true)}>
              <IconPlus size={16} className="mr-2" />
              New list
            </Button>
          </div>
        )}
      </div>

      <NewListDialog
        open={newListOpen}
        onClose={() => setNewListOpen(false)}
        onCreate={handleCreateList}
      />
    </div>
  );
}
