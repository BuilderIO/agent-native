declare const fragmentBrand: unique symbol;
declare const identifierBrand: unique symbol;
declare const boundValueBrand: unique symbol;

// Registry symbols let separate loaded copies compose the same SQL protocol.
const fragmentRuntimeBrand = Symbol.for("@agent-native/core/sql-fragment");
const identifierRuntimeBrand = Symbol.for("@agent-native/core/sql-identifier");
const boundValueRuntimeBrand = Symbol.for("@agent-native/core/sql-bound-value");
const parameterOffsetsRuntimeBrand = Symbol.for(
  "@agent-native/core/sql-fragment-parameter-offsets",
);

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

interface FragmentBuilder {
  sqlParts: string[];
  args: unknown[];
  parameterOffsets: number[];
  length: number;
}

function createBuilder(): FragmentBuilder {
  return { sqlParts: [], args: [], parameterOffsets: [], length: 0 };
}

function appendText(builder: FragmentBuilder, text: string): void {
  builder.sqlParts.push(text);
  builder.length += text.length;
}

function parameterOffsets(value: object): readonly number[] | undefined {
  const metadata = (value as Record<symbol, unknown>)[
    parameterOffsetsRuntimeBrand
  ];
  return Array.isArray(metadata) &&
    metadata.every((offset) => typeof offset === "number")
    ? metadata
    : undefined;
}

function makeFragment(
  sqlText: string, // raw-sql-ok: the private builder composes only validated fragments and fixed text.
  args: readonly unknown[],
  offsets: readonly number[],
): SqlFragment {
  return Object.freeze({
    sql: sqlText,
    args: Object.freeze([...args]),
    [fragmentRuntimeBrand]: true as const,
    [parameterOffsetsRuntimeBrand]: Object.freeze([...offsets]),
  }) as unknown as SqlFragment;
}

function requirePresent<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new TypeError(message);
  }
  return value;
}

export function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    fragmentRuntimeBrand in value &&
    "sql" in value &&
    "args" in value &&
    typeof value.sql === "string" &&
    Array.isArray(value.args) &&
    parameterOffsets(value) !== undefined
  );
}

export function getSqlFragmentParameterOffsets(
  fragment: SqlFragment,
): readonly number[] {
  const offsets = parameterOffsets(fragment);
  if (!offsets) {
    throw new TypeError("SQL fragment is missing parameter marker metadata.");
  }
  return offsets;
}

function isSqlIdentifier(value: unknown): value is SqlIdentifier {
  return (
    typeof value === "object" &&
    value !== null &&
    identifierRuntimeBrand in value &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function isSqlBoundValue(value: unknown): value is SqlBoundValue {
  return (
    typeof value === "object" &&
    value !== null &&
    boundValueRuntimeBrand in value &&
    "value" in value
  );
}

function appendFragment(fragment: SqlFragment, builder: FragmentBuilder): void {
  for (const offset of getSqlFragmentParameterOffsets(fragment)) {
    builder.parameterOffsets.push(builder.length + offset);
  }
  appendText(builder, fragment.sql);
  builder.args.push(...fragment.args);
}

function appendInterpolation(
  value: SqlInterpolation,
  builder: FragmentBuilder,
): void {
  if (isSqlFragment(value)) {
    appendFragment(value, builder);
    return;
  }
  if (isSqlIdentifier(value)) {
    appendText(builder, value.name);
    return;
  }
  if (isSqlBoundValue(value)) {
    builder.parameterOffsets.push(builder.length);
    appendText(builder, "?");
    builder.args.push(value.value);
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
  const builder = createBuilder();
  appendText(builder, first);
  for (let index = 0; index < values.length; index += 1) {
    const value = requirePresent(
      values[index],
      "SQL template interpolation is missing.",
    );
    appendInterpolation(value, builder);
    const followingString = requirePresent(
      strings[index + 1],
      "SQL template must end with a string.",
    );
    appendText(builder, followingString);
  }
  return makeFragment(
    builder.sqlParts.join(""),
    builder.args,
    builder.parameterOffsets,
  );
};

export const sql: SqlTag = Object.assign(tag, {
  value(value: unknown): SqlBoundValue {
    if (value === undefined) {
      throw new TypeError(
        "SQL bound values cannot be undefined; use null explicitly.",
      );
    }
    return Object.freeze({
      value,
      [boundValueRuntimeBrand]: true as const,
    }) as unknown as SqlBoundValue;
  },
  ident(name: string): SqlIdentifier {
    const match = /^[a-z_][a-z0-9_]*$/.exec(name);
    if (match?.[0] !== name) {
      throw new TypeError(`Invalid SQL identifier: ${name}`);
    }
    return Object.freeze({
      name,
      [identifierRuntimeBrand]: true as const,
    }) as unknown as SqlIdentifier;
  },
  join(fragments: readonly SqlFragment[], separator: SqlFragment): SqlFragment {
    if (!isSqlFragment(separator)) {
      throw new TypeError("SQL join separator must be a SQL fragment.");
    }
    const builder = createBuilder();
    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index];
      if (!isSqlFragment(fragment)) {
        throw new TypeError("SQL join items must be SQL fragments.");
      }
      if (index > 0) appendFragment(separator, builder);
      appendFragment(fragment, builder);
    }
    return makeFragment(
      builder.sqlParts.join(""),
      builder.args,
      builder.parameterOffsets,
    );
  },
  in(values: readonly unknown[]): SqlFragment {
    if (values.length === 0) {
      throw new RangeError("SQL IN requires at least one value.");
    }
    if (values.some((value) => value === undefined)) {
      throw new TypeError(
        "SQL IN values cannot include undefined; use null explicitly.",
      );
    }
    const builder = createBuilder();
    appendText(builder, "(");
    for (let index = 0; index < values.length; index += 1) {
      if (index > 0) appendText(builder, ", ");
      builder.parameterOffsets.push(builder.length);
      appendText(builder, "?");
      const value = requirePresent(
        values[index],
        "SQL IN values cannot include undefined; use null explicitly.",
      );
      builder.args.push(value);
    }
    appendText(builder, ")");
    return makeFragment(
      builder.sqlParts.join(""),
      builder.args,
      builder.parameterOffsets,
    );
  },
});
