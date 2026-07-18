import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

export type ComposerTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export type ReasoningEffort =
  | "auto"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface EngineModelGroup {
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
}

export interface ComposerModelState {
  selectedModel: string;
  selectedEngine: string;
  selectedEffort: ReasoningEffort;
  availableModels: EngineModelGroup[];
  isLoading: boolean;
  onModelChange: (model: string, engine: string) => void;
  onEffortChange: (effort: ReasoningEffort) => void;
}

export interface ComposerBuilderConnectFlow {
  hasFetchedStatus: boolean;
  configured: boolean;
  envManaged: boolean;
  connecting: boolean;
  statusResolved: boolean;
  start: () => void;
}

export interface AgentChatContextItem {
  key: string;
  title: string;
  context: string;
}

export interface ComposerAgentChatMessage {
  message: string;
  context?: string;
  mode?: "plan" | "act";
  submit?: boolean;
}

export interface ComposerAgentChatContextSetOptions extends AgentChatContextItem {
  openSidebar?: boolean;
  focus?: boolean;
}

export interface ComposerAgentChatOpenThreadRequest {
  threadId: string;
  onlyIfActiveThreadId?: string;
}

export interface ComposerBuilderConnectFlowOptions {
  enabled?: boolean;
  popupUrl?: string;
  trackingSource?: string;
  trackingFlow?: string;
  onConnected?: (state: { orgName: string | null }) => void | Promise<void>;
}

export interface AgentComposerReference {
  label: string;
  icon?: string;
  source?: string;
  refType: string;
  refId?: string | null;
  refPath?: string | null;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  clearsSlots?: string[];
  relatedReferences?: AgentComposerReference[];
}
export interface AgentComposerReferenceInsertPayload extends AgentComposerReference {
  insertMessageId: string;
}

export interface VoiceContextPack {
  surface?: string;
  mode?: string;
  snippets?: Array<{ label: string; value: string }>;
  terms?: Array<{ term: string; replacement?: string }>;
}

export interface ComposerRuntimeAdapters {
  resolvePath?: (path: string) => string;
  translate?: ComposerTranslate;
  models?: {
    useChatModels?: (options: { enabled: boolean }) => ComposerModelState;
    useAgentEngineConfigured?: (enabled: boolean) => {
      missing: boolean;
      state: string;
    };
    fetchAgentEngineConfiguredState?: (
      enabled: boolean,
      options: { timeoutMs: number },
    ) => Promise<"missing" | "configured" | string>;
    BuilderSetupCard?: ComponentType<any>;
    BuilderSetupContent?: ComponentType<any>;
    reasoning?: {
      defaultEffort?: ReasoningEffort;
      getOptionsForModel?: (model?: string) => ReasoningEffort[];
      label?: (effort: ReasoningEffort) => string;
      resolve?: (model: string, effort?: ReasoningEffort) => ReasoningEffort;
    };
  };
  agentChat?: {
    sendToAgentChat?: (input: ComposerAgentChatMessage) => void;
    setContextItem?: (input: ComposerAgentChatContextSetOptions) => void;
    requestThreadOpen?: (input: ComposerAgentChatOpenThreadRequest) => void;
    formatContextItems?: (
      items: readonly AgentChatContextItem[] | undefined,
    ) => string;
    normalizeReference?: (reference: unknown) => AgentComposerReference | null;
    StaleIndexBoundary?: ComponentType<any>;
  };
  builder?: {
    useConnectFlow?: (
      options: ComposerBuilderConnectFlowOptions,
    ) => ComposerBuilderConnectFlow;
    tryDelegateBuildRequest?: (text: string) => boolean;
    isTrustedFrameMessage?: (event: MessageEvent) => boolean;
    isTrustedBuilderMessage?: (event: MessageEvent) => boolean;
  };
  resources?: {
    useOrg?: () => {
      data?: { orgId?: string | null; role?: string | null } | null;
    };
    isMcpIntegrationAvailable?: () => boolean;
    useCreateMcpServer?: () => {
      mutateAsync: (input: any) => Promise<unknown>;
    };
    McpIntegrationDialog?: ComponentType<any>;
  };
  voice?: {
    useProviderStatus?: () => {
      status: { builder?: boolean; openai?: boolean } | null;
      refresh: () => void;
    };
    getBrowserTabId?: () => string;
    readAppState?: <T>(
      key: string,
    ) => T | null | undefined | Promise<T | null | undefined>;
    setAppState?: (key: string, value: unknown) => void | Promise<unknown>;
    subscribeSidebarState?: (
      listener: (detail: { open?: boolean } | undefined) => void,
    ) => () => void;
    applyContextReplacements?: (
      text: string,
      context: VoiceContextPack | undefined,
    ) => string;
  };
}

const identityPath = (path: string) => path;
const fallbackTranslate: ComposerTranslate = (key, options) =>
  typeof options?.defaultValue === "string" ? options.defaultValue : key;
const fallbackModels = {
  useChatModels: () => ({
    selectedModel: "auto",
    selectedEngine: "auto",
    selectedEffort: "medium" as ReasoningEffort,
    availableModels: [],
    isLoading: false,
    onModelChange: () => {},
    onEffortChange: () => {},
  }),
  useAgentEngineConfigured: () => ({ missing: false, state: "configured" }),
  fetchAgentEngineConfiguredState: async () => "configured",
};
const FragmentBoundary: ComponentType<{ children?: ReactNode }> = ({
  children,
}) => <>{children}</>;
const fallbackBuilderFlow = {
  hasFetchedStatus: false,
  configured: false,
  envManaged: false,
  connecting: false,
  statusResolved: false,
  start: () => {},
};

const fallbackAdapters: Required<Pick<ComposerRuntimeAdapters, "resolvePath">> &
  ComposerRuntimeAdapters = {
  resolvePath: identityPath,
  translate: fallbackTranslate,
  models: fallbackModels,
  agentChat: {
    sendToAgentChat: () => {},
    setContextItem: () => {},
    requestThreadOpen: () => {},
    formatContextItems: () => "",
    normalizeReference: (reference) =>
      reference &&
      typeof reference === "object" &&
      typeof (reference as AgentComposerReference).label === "string" &&
      typeof (reference as AgentComposerReference).refType === "string"
        ? (reference as AgentComposerReference)
        : null,
    StaleIndexBoundary: FragmentBoundary,
  },
  builder: {
    useConnectFlow: () => fallbackBuilderFlow,
    tryDelegateBuildRequest: () => false,
    isTrustedFrameMessage: () => false,
    isTrustedBuilderMessage: () => false,
  },
  resources: {
    useOrg: () => ({ data: null }),
    isMcpIntegrationAvailable: () => false,
    useCreateMcpServer: () => ({ mutateAsync: async () => undefined }),
  },
  voice: {
    useProviderStatus: () => ({ status: null, refresh: () => {} }),
    getBrowserTabId: () => "",
    readAppState: () => undefined,
    setAppState: () => {},
    subscribeSidebarState: () => () => {},
    applyContextReplacements: applyVoiceContextReplacements,
  },
};

const ComposerRuntimeAdaptersContext =
  createContext<ComposerRuntimeAdapters>(fallbackAdapters);

export function ComposerRuntimeAdaptersProvider({
  adapters,
  children,
}: {
  adapters: ComposerRuntimeAdapters;
  children: ReactNode;
}) {
  return (
    <ComposerRuntimeAdaptersContext.Provider
      value={{
        ...fallbackAdapters,
        ...adapters,
        models: { ...fallbackModels, ...adapters.models },
        agentChat: { ...fallbackAdapters.agentChat, ...adapters.agentChat },
        builder: { ...fallbackAdapters.builder, ...adapters.builder },
        resources: { ...fallbackAdapters.resources, ...adapters.resources },
        voice: { ...fallbackAdapters.voice, ...adapters.voice },
      }}
    >
      {children}
    </ComposerRuntimeAdaptersContext.Provider>
  );
}

export function useComposerRuntimeAdapters() {
  return useContext(ComposerRuntimeAdaptersContext);
}

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
export function getReasoningEffortOptionsForModel(
  _model?: string,
): ReasoningEffort[] {
  return ["low", "medium", "high"];
}
export function reasoningEffortLabel(effort: ReasoningEffort): string {
  return effort === "xhigh"
    ? "Extra high"
    : effort[0].toUpperCase() + effort.slice(1);
}
export function resolveReasoningEffortSelection(
  _model: string,
  effort?: ReasoningEffort,
): ReasoningEffort {
  return effort ?? DEFAULT_REASONING_EFFORT;
}

export const AGENT_CHAT_INSERT_REFERENCE_EVENT =
  "agent-native:insert-composer-reference";
export const AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE =
  "agent-native:insert-composer-reference";

export function formatPromptContextItems(
  items: AgentChatContextItem[] | undefined,
): string {
  return (
    items
      ?.map((item) => item.context ?? item.title ?? "")
      .filter(Boolean)
      .join("\n\n") ?? ""
  );
}

export function applyVoiceContextReplacements(
  text: string,
  context: VoiceContextPack | undefined,
): string {
  const isAlphaNumeric = (value: string | undefined) =>
    value != null && /[\p{L}\p{N}_]/u.test(value);
  const isSafeBoundary = (
    value: string,
    index: number,
    direction: "before" | "after",
  ) => {
    const char = value[index];
    if (char == null) return true;
    if (isAlphaNumeric(char) || "@/\\:".includes(char)) return false;
    if (".-+".includes(char)) {
      const neighbor =
        direction === "before" ? value[index - 1] : value[index + 1];
      return !isAlphaNumeric(neighbor);
    }
    return true;
  };
  let next = text;
  for (const term of context?.terms ?? []) {
    const source = term.term.trim();
    const replacement = term.replacement?.trim();
    if (!replacement || source.length < 2 || replacement === source) continue;
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(escaped, "giu"), (match, offset: number) => {
      const end = offset + match.length;
      return isSafeBoundary(next, offset - 1, "before") &&
        isSafeBoundary(next, end, "after")
        ? replacement
        : match;
    });
  }
  return next;
}
