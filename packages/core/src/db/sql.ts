const fragmentBrand: unique symbol = Symbol("SqlFragment");
const identifierBrand: unique symbol = Symbol("SqlIdentifier");
const boundValueBrand: unique symbol = Symbol("SqlBoundValue");

export interface SqlFragment {
  readonly sql: string;
  readonly args: readonly unknown[];
  readonly [fragmentBrand]: true;
}

interface SqlIdentifier {
  readonly name: string;
  readonly [identifierBrand]: true;
}

interface SqlBoundValue {
  readonly value: unknown;
  readonly [boundValueBrand]: true;
}

type SqlInterpolation = SqlFragment | SqlIdentifier | SqlBoundValue;

export interface SqlTag {
  (strings: TemplateStringsArray, ...values: SqlInterpolation[]): SqlFragment;
  value(value: unknown): SqlBoundValue;
  ident(name: string): SqlIdentifier;
  join(fragments: readonly SqlFragment[], separator: SqlFragment): SqlFragment;
  in(values: readonly unknown[]): SqlFragment;
}

function makeFragment(sqlText: string, args: readonly unknown[]): SqlFragment {
  return Object.freeze({
    sql: sqlText,
    args: Object.freeze([...args]),
    [fragmentBrand]: true as const,
  });
}

function requirePresent<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new TypeError(message);
  }
  return value;
}

function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    fragmentBrand in value &&
    "sql" in value &&
    "args" in value &&
    typeof value.sql === "string" &&
    Array.isArray(value.args)
  );
}

function isSqlIdentifier(value: unknown): value is SqlIdentifier {
  return (
    typeof value === "object" &&
    value !== null &&
    identifierBrand in value &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function isSqlBoundValue(value: unknown): value is SqlBoundValue {
  return (
    typeof value === "object" &&
    value !== null &&
    boundValueBrand in value &&
    "value" in value
  );
}

function appendFragment(
  fragment: SqlFragment,
  sqlParts: string[],
  args: unknown[],
): void {
  sqlParts.push(fragment.sql);
  args.push(...fragment.args);
}

function appendInterpolation(
  value: SqlInterpolation,
  sqlParts: string[],
  args: unknown[],
): void {
  if (isSqlFragment(value)) {
    appendFragment(value, sqlParts, args);
    return;
  }
  if (isSqlIdentifier(value)) {
    sqlParts.push(value.name);
    return;
  }
  if (isSqlBoundValue(value)) {
    sqlParts.push("?");
    args.push(value.value);
    return;
  }
  throw new TypeError(
    "SQL interpolation must be a fragment, identifier, or bound value.",
  );
}

const tag = (
  strings: TemplateStringsArray,
  ...values: SqlInterpolation[]
): SqlFragment => {
  if (strings.length !== values.length + 1) {
    throw new TypeError("SQL template strings and values do not match.");
  }
  const first = requirePresent(
    strings[0],
    "SQL template must contain an initial string.",
  );
  const sqlParts: string[] = [first];
  const args: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = requirePresent(
      values[index],
      "SQL template interpolation is missing.",
    );
    appendInterpolation(value, sqlParts, args);
    const followingString = requirePresent(
      strings[index + 1],
      "SQL template must end with a string.",
    );
    sqlParts.push(followingString);
  }
  return makeFragment(sqlParts.join(""), args);
};

export const sql: SqlTag = Object.assign(tag, {
  value(value: unknown): SqlBoundValue {
    if (value === undefined) {
      throw new TypeError(
        "SQL bound values cannot be undefined; use null explicitly.",
      );
    }
    return Object.freeze({ value, [boundValueBrand]: true as const });
  },
  ident(name: string): SqlIdentifier {
    const match = /^[a-z_][a-z0-9_]*$/.exec(name);
    if (match?.[0] !== name) {
      throw new TypeError(`Invalid SQL identifier: ${name}`);
    }
    return Object.freeze({ name, [identifierBrand]: true as const });
  },
  join(fragments: readonly SqlFragment[], separator: SqlFragment): SqlFragment {
    if (!isSqlFragment(separator)) {
      throw new TypeError("SQL join separator must be a SQL fragment.");
    }
    const sqlParts: string[] = [];
    const args: unknown[] = [];
    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index];
      if (!isSqlFragment(fragment)) {
        throw new TypeError("SQL join items must be SQL fragments.");
      }
      if (index > 0) appendFragment(separator, sqlParts, args);
      appendFragment(fragment, sqlParts, args);
    }
    return makeFragment(sqlParts.join(""), args);
  },
  in(values: readonly unknown[]): SqlFragment {
    if (values.length === 0) {
      throw new RangeError("SQL IN requires at least one value.");
    }
    const args = [...values];
    if (args.some((value) => value === undefined)) {
      throw new TypeError(
        "SQL IN values cannot include undefined; use null explicitly.",
      );
    }
    return makeFragment(`(${args.map(() => "?").join(", ")})`, args);
  },
});
