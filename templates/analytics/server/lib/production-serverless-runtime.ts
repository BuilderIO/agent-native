export function isProductionServerlessRuntime(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.NETLIFY_FUNCTION_NAME) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.LAMBDA_TASK_ROOT) ||
    process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    process.env.VERCEL === "1"
  );
}
