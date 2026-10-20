// The editor reads the workflow contract straight from `server/workflow`:
// those modules only import zod and each other, so they are safe in the
// client bundle. Vite has no alias for `server/`, so the import is relative,
// and this file is the only place that spells the path.
export {
  END_OUTCOMES,
  MAX_EDGES,
  MAX_NODES,
  NODE_KINDS,
  RULE_OPS,
  STEP_STATUSES,
  fieldBindingSchema,
  identifierSchema,
  nodeScopeKey,
  ruleSchema,
  workflowGraphSchema,
  workflowNodeSchema,
  type EndOutcome,
  type FieldBinding,
  type NodeKind,
  type ResultField,
  type Rule,
  type RuleOp,
  type StepStatus,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeOfKind,
  type WorkflowNodeSettings,
} from "../../../server/workflow/contract.js";
export {
  FORBIDDEN_SEGMENTS,
  MAX_PATH_LENGTH,
  PATH_ROOTS,
  ExpressionError,
  parseTemplate,
  validatePath,
  type ExpressionErrorCode,
  type ParsedPath,
  type Template,
} from "../../../server/workflow/expressions.js";
export {
  ISSUE_CODES,
  validateWorkflowGraph,
  type WorkflowIssue,
  type WorkflowIssueCode,
  type WorkflowValidation,
} from "../../../server/workflow/graph-validation.js";
export {
  isWriteAllowedForNode,
  type OperationCatalog,
  type OperationDefinition,
  type OperationField,
  type OperationNodeKind,
} from "../../../server/workflow/operations.js";
export {
  LIMIT_REACHED_PORT,
  OTHERWISE_PORT,
  OUT_PORT,
  portsFor,
  portsWithLimit,
  routePort,
} from "../../../server/workflow/ports.js";
