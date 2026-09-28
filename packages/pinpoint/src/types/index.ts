// @agent-native/pinpoint — Core type definitions
// MIT License

export type PinStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export type DrawToolType = "freehand" | "arrow" | "circle" | "rect" | "text";

export interface DrawStroke {
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  type: "freehand" | "arrow" | "circle" | "rect";
}

export interface TextNote {
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface QueuedAnnotation {
  id: string;
  pin?: Pin;
  drawings?: DrawStroke[];
  textNotes?: TextNote[];
  timestamp: string;
}

export interface AgentOutput {
  message: string;
  context: string;
  submit?: boolean;
}

export type ToolbarMode = "select" | "draw" | "queue";

export interface Pin {
  id: string;
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  comment: string;
  element: ElementInfo;
  framework?: FrameworkInfo;
  status: {
    state: PinStatus;
    changedAt: string;
    changedBy?: string;
  };
}

export interface ElementInfo {
  tagName: string;
  id?: string;
  classNames: string[];
  selector: string;
  textContent?: string;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  computedStyles?: Record<string, string>;
  ariaAttributes?: Record<string, string>;
  dataAttributes?: Record<string, string>;
  domPath?: string;
}

export interface FrameworkInfo {
  framework: string;
  componentPath: string;
  sourceFile?: string;
  frameworkVersion?: string;
}

export interface ElementContext {
  element: ElementInfo;
  framework?: FrameworkInfo;
  htmlSnippet: string;
  cssSelector: string;
  computedStyles: Record<string, string>;
}

export interface ComponentInfo {
  name: string;
  displayName?: string;
  filePath?: string;
  lineNumber?: number;
  props?: Record<string, unknown>;
}

export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface Plugin {
  name: string;
  setup?(api: PinpointAPI, hooks: PluginHookRegistry): void;
  hooks?: PluginHooks;
  actions?: ContextMenuAction[];
}

export interface PluginHooks {
  onElementSelect?(element: Element, info: ElementContext): void;
  onElementHover?(element: Element): void;
  onBeforeCopy?(context: CopyContext): CopyContext | false;
  transformOutput?(output: string): string;
  onPinCreate?(pin: Pin): void;
  onPinResolve?(pin: Pin): void;
}

export interface PluginHookRegistry {
  register(hookName: keyof PluginHooks, handler: Function): void;
  unregister(hookName: keyof PluginHooks, handler: Function): void;
}

export interface CopyContext {
  pins: Pin[];
  format: OutputFormat;
  output: string;
}

export type OutputFormat = "compact" | "standard" | "detailed";

export interface ContextMenuAction {
  label: string;
  icon?: string;
  handler(element: Element, context: ElementContext): void;
}

export interface PinpointAPI {
  activate(): void;
  deactivate(): void;
  toggle(): void;
  isActive(): boolean;
  copyElement(element: Element): Promise<boolean>;
  getElementContext(element: Element): Promise<ElementContext>;
  freeze(elements?: Element[]): void;
  unfreeze(): void;
  openFile(filePath: string, lineNumber?: number): Promise<void>;
  registerPlugin(plugin: Plugin): void;
  unregisterPlugin(name: string): void;
  getPins(): Pin[];
  createPin(element: Element, comment: string): Pin;
  resolvePin(id: string, message?: string): void;
  dispose(): void;
}

export interface PinStorage {
  load(pageUrl: string): Promise<Pin[]>;
  save(pin: Pin): Promise<void>;
  update(id: string, patch: Partial<Pin>): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: { pageUrl?: string; status?: PinStatus }): Promise<Pin[]>;
  clear(pageUrl?: string): Promise<void>;
}

export interface PinpointConfig {
  target?: HTMLElement;
  author?: string;
  endpoint?: string;
  colorScheme?: "auto" | "light" | "dark";
  outputFormat?: OutputFormat;
  autoSubmit?: boolean;
  clearOnSend?: boolean;
  sendToAgent?: (output: AgentOutput) => void | Promise<void>;
  blockInteractions?: boolean;
  freezeJSTimers?: boolean;
  allowedOrigins?: string[];
  webhookUrl?: string;
  includeSourcePaths?: boolean;
  plugins?: Plugin[];
  storage?: PinStorage;
  position?: { x: number; y: number };
  markerColor?: string;
  compactPopup?: boolean;
}

export interface FrameworkAdapter {
  name: string;
  detect(): boolean;
  getComponentInfo(element: Element): ComponentInfo | null;
  getSourceLocation(element: Element): SourceLocation | null;
  freeze?(): void;
  unfreeze?(): void;
}

export interface PinEvent {
  type: "pin:created" | "pin:updated" | "pin:deleted" | "pin:resolved";
  pin: Pin;
  timestamp: string;
}
