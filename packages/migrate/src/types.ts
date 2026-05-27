export type MigrationPhase =
  | "discover"
  | "plan"
  | "approve"
  | "sweep"
  | "verify"
  | "complete";

export type MigrationTaskStatus =
  | "pending"
  | "running"
  | "passed"
  | "covered"
  | "failed"
  | "manual";

export type MigrationConfidence = "high" | "medium" | "low";

export type MigrationInputKind = "path" | "url" | "description";

export type RouteKind =
  | "marketing"
  | "docs"
  | "landing"
  | "app"
  | "api"
  | "unknown";

export interface SiteRoute {
  id: string;
  path: string;
  filePath: string;
  router: "next-pages" | "next-app" | "unknown";
  kind: RouteKind;
  dynamic: boolean;
  public: boolean;
  notes?: string[];
}

export interface SiteGraph {
  framework: "nextjs" | "react" | "aem" | "unknown";
  sourceRoot: string;
  routes: SiteRoute[];
  redirects: Array<{ from: string; to: string; status?: number }>;
  metadata: Record<string, unknown>;
}

export interface ComponentGraph {
  components: Array<{
    id: string;
    name: string;
    filePath: string;
    usedByRoutes: string[];
    notes?: string[];
  }>;
  designTokens: Record<string, unknown>;
}

export interface ContentGraph {
  models: Array<{
    id: string;
    name: string;
    source: "static" | "cms" | "aem-content-fragment" | "unknown";
    fields: Array<{ name: string; type: string; required?: boolean }>;
  }>;
  assets: Array<{
    id: string;
    path: string;
    type: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface BehaviorGraph {
  apiEndpoints: Array<{
    id: string;
    path: string;
    method: string;
    filePath: string;
    recommendedRecipe: string;
  }>;
  dataStores: Array<{
    id: string;
    name: string;
    filePath: string;
    kind: "database" | "api" | "local-state" | "unknown";
  }>;
  llmCalls: Array<{ id: string; filePath: string; provider: string }>;
  clientState: Array<{ id: string; filePath: string; reason: string }>;
  auth: Array<{ id: string; filePath: string; provider: string }>;
  jobs: Array<{ id: string; filePath: string; kind: string }>;
}

export interface ProjectIR {
  site: SiteGraph;
  components: ComponentGraph;
  content: ContentGraph;
  behavior: BehaviorGraph;
}

export interface MigrationRun {
  id: string;
  sourceRoot: string;
  inputKind: MigrationInputKind | string;
  inputDescription: string;
  outputRoot: string;
  target: "agent-native" | "agent-native-builder" | string;
  phase: MigrationPhase;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
  artifactDir: string;
  ir?: ProjectIR;
}

export interface MigrationTask {
  id: string;
  runId: string;
  recipeName: string;
  title: string;
  status: MigrationTaskStatus;
  confidence: MigrationConfidence;
  targetIds: string[];
  summary: string;
  updatedAt: string;
}

export interface MigrationReport {
  runId: string;
  ok: boolean;
  generatedAt: string;
  summary: string;
  verifierResults: VerifierResult[];
  manualDecisions: string[];
}

export interface MigrationContext {
  run: MigrationRun;
  ir: ProjectIR;
  tasks: MigrationTask[];
  artifacts: MigrationArtifacts;
  logger?: (message: string) => void;
}

export interface MigrationArtifacts {
  runDir: string;
  assessmentPath: string;
  planPath: string;
  planInputsPath: string;
  tasksPath: string;
  reportPath: string;
  irPath: string;
}

export interface SourceAdapter {
  id: string;
  label: string;
  kind?: "deterministic" | "agent";
  inputKinds?: Array<MigrationInputKind | string>;
  detect(sourceRoot: string): Promise<boolean>;
  introspect(sourceRoot: string): Promise<ProjectIR>;
}

export interface TargetAdapter {
  id: string;
  label: string;
  scaffold(context: MigrationContext): Promise<TargetAdapterResult>;
  verify?(context: MigrationContext): Promise<VerifierResult[]>;
}

export interface TargetAdapterResult {
  ok: boolean;
  summary: string;
  changedFiles: string[];
  artifactPaths: string[];
}

export interface MigrationRecipe {
  name: string;
  title: string;
  description: string;
  selectTasks(context: MigrationContext): Promise<MigrationTask[]>;
  apply?(context: MigrationContext, task: MigrationTask): Promise<RecipeResult>;
}

export interface RecipeResult {
  ok: boolean;
  summary: string;
  changedFiles: string[];
  artifactPaths: string[];
  criticDecision?: CriticDecision;
}

export type CriticDecision =
  | "retry-with-more-context"
  | "tune-recipe"
  | "manual-decision-needed"
  | "rollback-generated-output"
  | "accept";

export interface Verifier {
  id: string;
  label: string;
  run(context: MigrationContext): Promise<VerifierResult>;
}

export interface VerifierResult {
  id: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  summary: string;
  artifactPaths: string[];
  suggestedNextTask?: string;
}

export interface AemSourceMode {
  id: "crawl" | "api" | "package" | "code" | "enterprise";
  label: string;
  description: string;
}
