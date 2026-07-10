import { useT } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconCircle,
  IconFrame,
  IconHandStop,
  IconLine,
  IconMessage,
  IconPencil,
  IconPointer,
  IconScale,
  IconScribble,
  IconSquare,
  IconTypography,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createCoreCommands } from "@/components/design/code-workbench/commands";
import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
  type DesignShortcutCategory,
  formatShortcutKeycaps,
} from "@/components/design/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface KeyboardShortcutsPanelProps {
  onClose: () => void;
}

const TOOL_ICON_BY_SHORTCUT: Record<string, typeof IconPointer> = {
  "move-tool": IconPointer,
  "frame-tool": IconFrame,
  "text-tool": IconTypography,
  "pen-tool": IconPencil,
  "hand-tool": IconHandStop,
  "scale-tool": IconScale,
  "comment-tool": IconMessage,
  "draw-tool": IconScribble,
  rectangle: IconSquare,
  ellipse: IconCircle,
  line: IconLine,
  arrow: IconArrowUpRight,
};

const ESSENTIAL_DESCRIPTION_KEY_BY_SHORTCUT = {
  "toggle-ui": "designEditor.keyboardShortcuts.descriptions.toggleUi",
  undo: "designEditor.keyboardShortcuts.descriptions.undo",
  redo: "designEditor.keyboardShortcuts.descriptions.redo",
} as const;

const CODE_CATEGORY_BY_COMMAND: Record<string, DesignShortcutCategory> = {
  "workbench.save": "edit",
  "workbench.saveAll": "edit",
  "workbench.quickOpen": "edit",
  "workbench.commandPalette": "edit",
  "workbench.search": "edit",
  "workbench.explorer": "view",
  "workbench.toggleSidebar": "view",
  "workbench.nextTab": "selection",
  "workbench.previousTab": "selection",
  "editor.gotoSymbol": "selection",
  "editor.gotoLine": "selection",
};

const ACCESSIBLE_KEY_NAME_BY_TOKEN: Record<string, string> = {
  alt: "alt",
  arrowdown: "arrowDown",
  arrowleft: "arrowLeft",
  arrowright: "arrowRight",
  arrowup: "arrowUp",
  backspace: "backspace",
  ctrl: "control",
  delete: "delete",
  enter: "enter",
  shift: "shift",
  tab: "tab",
  "?": "questionMark",
  "\\": "backslash",
  "=": "equals",
  "-": "minus",
  "[": "leftBracket",
  "]": "rightBracket",
};

function KeycapGroup({
  binding,
  applePlatform,
}: {
  binding: string;
  applePlatform: boolean;
}) {
  return (
    <span
      data-keycap-group={binding}
      aria-hidden="true"
      className="inline-flex items-center gap-0.5 whitespace-nowrap"
    >
      {formatShortcutKeycaps(binding, applePlatform).map((keycap, index) => (
        <kbd
          key={`${keycap}-${index}`}
          aria-hidden="true"
          className="inline-flex min-w-5 items-center justify-center rounded-[3px] border border-neutral-500/70 bg-neutral-700/80 px-1 py-0.5 font-sans text-[10px] font-medium leading-none text-neutral-100 shadow-[0_1px_0_rgba(255,255,255,0.1)]"
        >
          {keycap}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutBindings({ bindings }: { bindings: readonly string[] }) {
  const t = useT();
  const applePlatform =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  const accessibleBindings = bindings.map((binding) =>
    binding
      .split("+")
      .map((rawToken) => {
        const token = rawToken.toLowerCase();
        if (token === "$mod") {
          return t(
            `designEditor.keyboardShortcuts.keys.${applePlatform ? "command" : "control"}`,
          );
        }
        if (token === "alt" && applePlatform) {
          return t("designEditor.keyboardShortcuts.keys.option");
        }
        const keyName = ACCESSIBLE_KEY_NAME_BY_TOKEN[token];
        if (keyName) {
          return t(`designEditor.keyboardShortcuts.keys.${keyName}`);
        }
        return rawToken.length === 1 ? rawToken.toLocaleUpperCase() : rawToken;
      })
      .join(" "),
  );

  return (
    <span
      data-shortcut-bindings
      role="group"
      aria-label={accessibleBindings.join(
        ` ${t("designEditor.keyboardShortcuts.keys.or")} `,
      )}
      className="flex shrink-0 items-center gap-1.5"
    >
      {bindings.map((binding) => (
        <KeycapGroup
          key={binding}
          binding={binding}
          applePlatform={applePlatform}
        />
      ))}
    </span>
  );
}

export function KeyboardShortcutsPanel({
  onClose,
}: KeyboardShortcutsPanelProps) {
  const t = useT();
  const [category, setCategory] = useState<DesignShortcutCategory>("essential");
  const initialTabRef = useRef<HTMLButtonElement | null>(null);
  const codeShortcuts = useMemo(
    () =>
      createCoreCommands().flatMap((command) => {
        const commandCategory = CODE_CATEGORY_BY_COMMAND[command.id];
        return commandCategory && command.keybindings?.length
          ? [{ ...command, shortcutCategory: commandCategory }]
          : [];
      }),
    [],
  );

  useEffect(() => {
    // Radix Menu restores focus to its trigger in its own close frame. Wait
    // through that frame before moving focus into the newly-opened dock so
    // menu invocation and the global shortcut share the same focus contract.
    let focusFrame = 0;
    const menuCloseFrame = window.requestAnimationFrame(() => {
      focusFrame = window.requestAnimationFrame(() => {
        initialTabRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(menuCloseFrame);
      if (focusFrame) window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  return (
    <section
      data-keyboard-shortcuts-panel
      role="region"
      aria-label={t("designEditor.keyboardShortcuts.title")}
      className="absolute inset-x-0 bottom-0 z-[60] flex h-[241px] flex-col border-t border-neutral-700 bg-neutral-900 text-neutral-100 shadow-[0_-12px_28px_rgba(0,0,0,0.28)]"
    >
      <Tabs
        value={category}
        onValueChange={(value) => setCategory(value as DesignShortcutCategory)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          data-shortcuts-tab-row
          className="flex h-[38px] shrink-0 items-center border-b border-neutral-700"
        >
          <div className="min-w-0 flex-1 overflow-x-auto pl-[124px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList
              data-shortcuts-tab-strip
              className="h-9 w-max justify-start rounded-none bg-transparent p-0"
            >
              {DESIGN_SHORTCUT_CATEGORIES.map((categoryId) => (
                <TabsTrigger
                  key={categoryId}
                  value={categoryId}
                  ref={categoryId === "essential" ? initialTabRef : undefined}
                  className="h-9 rounded-none border-x-0 border-b-2 border-t-0 border-transparent bg-transparent px-2.5 text-[11px] font-medium text-neutral-400 shadow-none data-[state=active]:border-blue-400 data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none"
                >
                  {t(`designEditor.keyboardShortcuts.categories.${categoryId}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <Button
            data-keyboard-shortcuts-close
            type="button"
            variant="ghost"
            size="icon"
            className="ml-2 size-7 shrink-0 text-neutral-300 hover:bg-neutral-700 hover:text-white"
            aria-label={t("designEditor.keyboardShortcuts.close")}
            onClick={onClose}
          >
            <IconX className="size-4" />
          </Button>
        </div>

        {DESIGN_SHORTCUT_CATEGORIES.map((categoryId) => {
          const designRows = DESIGN_SHORTCUTS.filter((item) =>
            categoryId === "tools"
              ? item.category === "tools" || item.category === "shape"
              : item.category === categoryId,
          );
          const codeRows = codeShortcuts.filter(
            (item) => item.shortcutCategory === categoryId,
          );
          return (
            <TabsContent
              key={categoryId}
              value={categoryId}
              data-shortcuts-tabpanel={categoryId}
              className="m-0 min-h-0 flex-1 overflow-y-auto px-4 py-2 data-[state=inactive]:hidden"
            >
              {categoryId === "essential" ? (
                <div
                  data-shortcuts-content-column
                  className="mx-auto max-w-[400px]"
                >
                  <h2
                    data-essential-shortcuts-heading
                    className="mb-2 text-[13px] font-semibold text-white"
                  >
                    {`${t("designEditor.keyboardShortcuts.categories.essential")} ${t("designEditor.keyboardShortcuts.title").toLocaleLowerCase()}`}
                  </h2>
                  <div className="space-y-6">
                    {[
                      DESIGN_SHORTCUTS.find((item) => item.id === "toggle-ui"),
                      DESIGN_SHORTCUTS.find((item) => item.id === "undo"),
                      DESIGN_SHORTCUTS.find((item) => item.id === "redo"),
                    ].map((item, index) =>
                      item ? (
                        <section
                          data-essential-shortcut-card
                          data-shortcut-id={item.id}
                          key={item.id}
                          className="relative pt-7"
                        >
                          <div className="absolute left-0 top-0">
                            <span className="flex size-5 items-center justify-center rounded-full bg-neutral-700 text-[10px] font-semibold text-white">
                              {index + 1}
                            </span>
                          </div>
                          <div className="mt-7 flex min-h-[58px] items-center justify-between gap-6 border-b border-neutral-700 pb-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-neutral-100">
                                {t(item.labelKey)}
                              </div>
                              <p
                                data-essential-shortcut-description
                                className="mt-1 text-[10px] leading-4 text-neutral-400"
                              >
                                {t(
                                  ESSENTIAL_DESCRIPTION_KEY_BY_SHORTCUT[
                                    item.id as keyof typeof ESSENTIAL_DESCRIPTION_KEY_BY_SHORTCUT
                                  ],
                                )}
                              </p>
                            </div>
                            <ShortcutBindings bindings={item.bindings} />
                          </div>
                        </section>
                      ) : null,
                    )}
                  </div>
                </div>
              ) : (
                <div
                  data-shortcut-grid={categoryId}
                  data-shortcuts-content-column
                  className="mx-auto max-w-[400px]"
                >
                  {designRows.map((item) => (
                    <div
                      data-shortcut-id={item.id}
                      key={item.id}
                      className="flex min-h-8 items-center gap-3 border-b border-neutral-800 py-1"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-[11px] text-neutral-200">
                        {(() => {
                          const ToolIcon = TOOL_ICON_BY_SHORTCUT[item.id];
                          return ToolIcon ? (
                            <ToolIcon className="size-3.5 shrink-0 text-neutral-400" />
                          ) : null;
                        })()}
                        <span className="truncate">
                          {t(item.labelKey)}
                          {item.context === "screen" ? (
                            <span className="ml-1.5 rounded bg-neutral-700 px-1 py-0.5 text-[9px] uppercase tracking-wide text-neutral-300">
                              {t(
                                "designEditor.keyboardShortcuts.screenContext",
                              )}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <ShortcutBindings bindings={item.bindings} />
                    </div>
                  ))}
                  {codeRows.map((item) => (
                    <div
                      data-code-shortcut-id={item.id}
                      key={item.id}
                      className="flex min-h-8 items-center gap-3 border-b border-neutral-800 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-200">
                        {item.title}
                        <span className="ml-1.5 rounded bg-blue-500/20 px-1 py-0.5 text-[9px] uppercase tracking-wide text-blue-200">
                          {t("designEditor.keyboardShortcuts.codeContext")}
                        </span>
                      </span>
                      <ShortcutBindings bindings={item.keybindings ?? []} />
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}
