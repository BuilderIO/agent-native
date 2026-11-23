export const engineErrorMessages = {
  columnNotFound:
    "A column in this query doesn’t exist. Check the column names and try again.",
  tableNotFound:
    "A table or view in this query doesn’t exist or isn’t available to you.",
  syntax: "This query has a syntax error. Check it and try again.",
  typeMismatch:
    "The query mixes incompatible data types. Cast the values to matching types.",
  divisionByZero: "The query divided by zero.",
  timeout: "The query took too long and timed out. Try narrowing it down.",
  permissionDenied: "You don’t have permission to run this query.",
  outOfMemory:
    "The query ran out of memory. Try filtering or aggregating the data first.",
};
