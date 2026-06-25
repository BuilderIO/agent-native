import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "FULL",
  "CROSS",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "ILIKE",
  "IS",
  "NULL",
  "TRUE",
  "FALSE",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "WITH",
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "DISTINCT",
  "UNION",
  "ALL",
  "INTERSECT",
  "EXCEPT",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "DROP",
  "ALTER",
  "ADD",
  "COLUMN",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "DEFAULT",
  "UNIQUE",
  "CHECK",
  "EXISTS",
  "BETWEEN",
  "ASC",
  "DESC",
  "NULLS",
  "FIRST",
  "LAST",
  "OVER",
  "PARTITION",
  "ROWS",
  "RANGE",
  "UNBOUNDED",
  "PRECEDING",
  "FOLLOWING",
  "CURRENT",
  "ROW",
  "WINDOW",
  "LATERAL",
  "ARRAY",
  "STRUCT",
  "UNNEST",
  "TABLESAMPLE",
  "SYSTEM",
  "BERNOULLI",
  "PERCENT",
  "FETCH",
  "NEXT",
  "ONLY",
  "TIES",
  "RECURSIVE",
  "TEMPORARY",
  "TEMP",
  "IF",
  "IFNULL",
  "IFF",
  "QUALIFY",
  "PIVOT",
  "UNPIVOT",
  "MATCH",
  "AGAINST",
  "NATURAL",
  "USING",
  "REPLACE",
  "IGNORE",
  "ROLLUP",
  "CUBE",
  "GROUPING",
  "SETS",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "TIME",
  "INTERVAL",
  "CAST",
  "CONVERT",
  "TRY_CAST",
  "SAFE_CAST",
  "EXTRACT",
  "EPOCH",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "WEEK",
  "QUARTER",
  "DOW",
  "DOY",
]);

type TokenType =
  | "keyword"
  | "function"
  | "string"
  | "comment"
  | "number"
  | "operator"
  | "punctuation"
  | "variable"
  | "plain";

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const value = end === -1 ? sql.slice(i) : sql.slice(i, end);
      tokens.push({ type: "comment", value });
      i += value.length;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const value = end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      tokens.push({ type: "comment", value });
      i += value.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          j++;
        }
      }
      tokens.push({ type: "string", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (sql[i] === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '"') j++;
      if (j < sql.length) j++;
      tokens.push({ type: "plain", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (sql[i] === "`") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== "`") j++;
      if (j < sql.length) j++;
      tokens.push({ type: "plain", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (sql[i] === "{" && sql[i + 1] === "{") {
      const end = sql.indexOf("}}", i + 2);
      const value = end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      tokens.push({ type: "variable", value });
      i += value.length;
      continue;
    }
    if (
      /[0-9]/.test(sql[i]) ||
      (sql[i] === "." && /[0-9]/.test(sql[i + 1] ?? ""))
    ) {
      let j = i;
      while (j < sql.length && /[0-9._eExX]/.test(sql[j])) j++;
      tokens.push({ type: "number", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      let k = j;
      while (k < sql.length && sql[k] === " ") k++;
      const isFunction = sql[k] === "(";
      if (isFunction && !KEYWORDS.has(upper)) {
        tokens.push({ type: "function", value: word });
      } else if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: word });
      } else {
        tokens.push({ type: "plain", value: word });
      }
      i = j;
      continue;
    }
    const twoChar = sql.slice(i, i + 2);
    if (["<>", "!=", "<=", ">=", "::", "||"].includes(twoChar)) {
      tokens.push({ type: "operator", value: twoChar });
      i += 2;
      continue;
    }
    const ch = sql[i];
    if ("=<>+-*/%!".includes(ch)) {
      tokens.push({ type: "operator", value: ch });
    } else if ("(),;.[]".includes(ch)) {
      tokens.push({ type: "punctuation", value: ch });
    } else {
      tokens.push({ type: "plain", value: ch });
    }
    i++;
  }
  return tokens;
}

const TOKEN_CLASS: Record<TokenType, string> = {
  keyword: "text-blue-600 dark:text-blue-400 font-semibold",
  function: "text-violet-600 dark:text-violet-400",
  string: "text-green-700 dark:text-green-400",
  comment: "text-slate-400 dark:text-slate-500 italic",
  number: "text-amber-600 dark:text-amber-400",
  operator: "text-rose-500 dark:text-rose-400",
  punctuation: "text-slate-500 dark:text-slate-400",
  variable: "text-orange-600 dark:text-orange-400 font-medium",
  plain: "",
};

interface SqlHighlightProps extends HTMLAttributes<HTMLPreElement> {
  sql: string;
  preClassName?: string;
}

export const SqlHighlight = forwardRef<HTMLPreElement, SqlHighlightProps>(
  function SqlHighlight({ sql, className, preClassName, ...props }, ref) {
    const tokens = tokenize(sql);
    const nodes: ReactNode[] = tokens.map((tok, idx) => {
      const cls = TOKEN_CLASS[tok.type];
      if (!cls) return tok.value;
      return (
        <span key={idx} className={cls}>
          {tok.value}
        </span>
      );
    });
    return (
      <pre
        ref={ref}
        {...props}
        className={cn(
          "font-mono text-xs leading-5 whitespace-pre-wrap break-words",
          preClassName,
          className,
        )}
      >
        <code>{nodes}</code>
      </pre>
    );
  },
);
