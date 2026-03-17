// @agent-native/pinpoint — Core type definitions
// MIT License

export type PinStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export interface Pin {
  id: string;
  pageUrl: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  author?: string;
  comment: string;
  element: ElementInfo;
  framework?: FrameworkInfo;
  status: {
    state: PinStatus;
    changedAt: string;
    changedBy?: string; // 'user' | 'agent' | author name
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
  framework: string; // 'react' | 'vue' | 'svelte' | 'angular' | 'unknown'
  componentPath: string; // <App> <Layout> <Sidebar> <NavLink>
  sourceFile?: string; // src/components/Sidebar.tsx:42
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

// Plugin types
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

// API surface
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

// Storage interface (carried forward from our fork — our design)
export interface PinStorage {
  load(pageUrl: string): Promise<Pin[]>;
  save(pin: Pin): Promise<void>;
  update(id: string, patch: Partial<Pin>): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: { pageUrl?: string; status?: PinStatus }): Promise<Pin[]>;
  clear(pageUrl?: string): Promise<void>;
}

// Configuration
export interface PinpointConfig {
  /** Target element to mount pinpoint into */
  target?: HTMLElement;
  /** Author name for annotations */
  author?: string;
  /** REST API endpoint for pin storage */
  endpoint?: string;
  /** Color scheme */
  colorScheme?: "auto" | "light" | "dark";
  /** Output detail level */
  outputFormat?: OutputFormat;
  /** Auto-submit to agent chat */
  autoSubmit?: boolean;
  /** Clear pins after sending */
  clearOnSend?: boolean;
  /** Block page interactions during annotation */
  blockInteractions?: boolean;
  /** Freeze JS timers (opt-in, disabled by default) */
  freezeJSTimers?: boolean;
  /** Allowed origins for postMessage */
  allowedOrigins?: string[];
  /** Webhook URL for pin events */
  webhookUrl?: string;
  /** Include source file paths in output */
  includeSourcePaths?: boolean;
  /** Plugins */
  plugins?: Plugin[];
  /** Custom storage adapter */
  storage?: PinStorage;
  /** Initial position of the toolbar */
  position?: { x: number; y: number };
  /** Marker color */
  markerColor?: string;
  /** Compact popup — hide technical details behind a toggle (default: true) */
  compactPopup?: boolean;
}

// Framework adapter interface
export interface FrameworkAdapter {
  name: string;
  detect(): boolean;
  getComponentInfo(element: Element): ComponentInfo | null;
  getSourceLocation(element: Element): SourceLocation | null;
  freeze?(): void;
  unfreeze?(): void;
}

// SSE event
export interface PinEvent {
  type: "pin:created" | "pin:updated" | "pin:deleted" | "pin:resolved";
  pin: Pin;
  timestamp: string;
}
