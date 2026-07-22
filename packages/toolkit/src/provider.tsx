import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ElementType,
  type ReactNode,
  type ComponentType,
} from "react";

import {
  DesignSystemContext,
  LegacyButtonRenderContext,
  type DesignSystemContextValue,
} from "./design-system/context.js";
import type { DesignSystemDefinition } from "./design-system/definition.js";
import type {
  ActionButtonProps,
  DesignSystemComponents,
} from "./design-system/types.js";
import type { ButtonProps } from "./ui/button.js";

export interface ToolkitComponents {
  Button?: ComponentType<ButtonProps>;
}

export interface ToolkitProviderProps {
  children: ReactNode;
  components?: ToolkitComponents;
  designSystem?: DesignSystemDefinition;
}

const ToolkitComponentsContext = createContext<ToolkitComponents>({});

export function ToolkitProvider({
  children,
  components,
  designSystem,
}: ToolkitProviderProps) {
  const parent = useContext(ToolkitComponentsContext);
  const parentDesignSystem = useContext(DesignSystemContext);
  const value = useMemo<ToolkitComponents>(
    () => ({ ...parent, ...components }),
    [parent, components],
  );
  const mergedDefinition = useMemo<DesignSystemDefinition | undefined>(() => {
    if (!designSystem) return parentDesignSystem.definition;
    return {
      ...parentDesignSystem.definition,
      ...designSystem,
      components: {
        ...parentDesignSystem.definition?.components,
        ...designSystem.components,
      },
    };
  }, [designSystem, parentDesignSystem.definition]);
  const legacyActionButton = useMemo<
    DesignSystemComponents["ActionButton"] | undefined
  >(() => {
    if (!value.Button) return parentDesignSystem.legacyActionButton;
    const LegacyButton = value.Button as ElementType<
      ButtonProps & { ref?: ActionButtonProps["elementRef"] }
    >;
    return function LegacyActionButton({
      children,
      intent,
      emphasis,
      size,
      pending,
      leadingIcon,
      trailingIcon,
      onPress,
      elementRef,
      ...props
    }: ActionButtonProps) {
      const variant =
        emphasis === "ghost"
          ? "ghost"
          : emphasis === "outline"
            ? "outline"
            : intent === "danger"
              ? "destructive"
              : intent === "primary"
                ? "default"
                : "secondary";
      const legacySize =
        size === "compact" ? "sm" : size === "large" ? "lg" : "default";
      return (
        <LegacyButtonRenderContext.Provider value={true}>
          <LegacyButton
            {...props}
            ref={elementRef}
            variant={variant}
            size={legacySize}
            disabled={props.disabled || pending}
            aria-busy={pending || undefined}
            onClick={(event) => onPress?.(event)}
          >
            {leadingIcon}
            {children}
            {trailingIcon}
          </LegacyButton>
        </LegacyButtonRenderContext.Provider>
      );
    };
  }, [parentDesignSystem.legacyActionButton, value.Button]);
  const designSystemValue = useMemo<DesignSystemContextValue>(
    () => ({ definition: mergedDefinition, legacyActionButton }),
    [legacyActionButton, mergedDefinition],
  );

  useEffect(() => {
    if (!mergedDefinition?.components?.ActionButton || !value.Button) return;
    const isDevelopment =
      (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ??
      true;
    if (!isDevelopment) return;
    console.warn(
      "[agent-native] ToolkitProvider received both designSystem.components.ActionButton and legacy components.Button. ActionButton takes precedence.",
    );
  }, [mergedDefinition?.components?.ActionButton, value.Button]);

  return (
    <DesignSystemContext.Provider value={designSystemValue}>
      <ToolkitComponentsContext.Provider value={value}>
        {children}
      </ToolkitComponentsContext.Provider>
    </DesignSystemContext.Provider>
  );
}

export function useToolkitComponents(): ToolkitComponents {
  return useContext(ToolkitComponentsContext);
}

export function useToolkitComponent<Name extends keyof ToolkitComponents>(
  name: Name,
): ToolkitComponents[Name] {
  return useToolkitComponents()[name];
}
