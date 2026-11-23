const queryNames = new Set(["_data", "_routes", "index"]);
const headerNames = new Set(["accept", "x-react-router-request"]);
const resourceTypes = new Set([
  "document",
  "fetch",
  "xhr",
  "script",
  "stylesheet",
  "other",
]);

export function classifyFailureResponse(input: {
  url: string;
  method: string;
  resourceType: string;
  headerNames: string[];
  contentType: string;
}) {
  const url = new URL(input.url);
  const contentType = input.contentType.split(";", 1)[0]?.toLowerCase();
  return {
    endpoint: url.pathname === "/home" ? "home" : "other",
    method: ["GET", "HEAD", "POST"].includes(input.method)
      ? input.method
      : "other",
    resourceType: resourceTypes.has(input.resourceType)
      ? input.resourceType
      : "other",
    searchParams: [
      ...new Set(
        [...url.searchParams.keys()].map((name) =>
          queryNames.has(name) ? name : "other",
        ),
      ),
    ].sort(),
    headers: [
      ...new Set(
        input.headerNames
          .map((name) => name.toLowerCase())
          .filter((name) => headerNames.has(name)),
      ),
    ].sort(),
    contentType:
      contentType === "text/html" || contentType === "application/json"
        ? contentType
        : "other",
    body: "not-collected",
  };
}
