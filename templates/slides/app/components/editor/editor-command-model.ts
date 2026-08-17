import type { ComponentType } from "react";

export type EditorCommandGroup =
  | "media"
  | "slideTools"
  | "comments"
  | "deck"
  | "other";

export interface EditorCommand {
  id: string;
  group: EditorCommandGroup;
  label: string;
  keywords?: string[];
  icon?: ComponentType<{ className?: string; size?: number }>;
  active?: boolean;
  run: () => void;
}

const EMPTY_COMMANDS: readonly EditorCommand[] = [];
type EditorCommandSource = () => readonly EditorCommand[];

let activeCommandSource: EditorCommandSource | null = null;

export function registerEditorCommands(source: EditorCommandSource) {
  activeCommandSource = source;

  return () => {
    if (activeCommandSource === source) activeCommandSource = null;
  };
}

export function getEditorCommands(): readonly EditorCommand[] {
  return activeCommandSource?.() ?? EMPTY_COMMANDS;
}
