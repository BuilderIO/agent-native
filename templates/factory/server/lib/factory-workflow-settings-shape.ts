type JsonSchema = Record<string, unknown>;

/** A sub-shape the settings of several node kinds share, named once instead of spelled out each time. */
type NamedShapes = Readonly<Record<string, JsonSchema>>;

// Numbers the contract bounds only by the safe-integer range are unbounded.
const UNBOUNDED = 1_000_000_000;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderNumber(schema: JsonSchema): string {
  const { minimum, maximum } = schema;
  return typeof minimum === "number" &&
    typeof maximum === "number" &&
    Math.abs(minimum) < UNBOUNDED &&
    Math.abs(maximum) < UNBOUNDED
    ? `${minimum}-${maximum}`
    : "number";
}

class ShapeWriter {
  readonly used = new Set<string>();
  private readonly byJson: Map<string, string>;

  constructor(named: NamedShapes) {
    this.byJson = new Map(
      Object.entries(named).map(([name, schema]) => [
        JSON.stringify(schema),
        name,
      ]),
    );
  }

  render(schema: unknown, path: string, isRoot = false): string {
    if (!isSchema(schema)) {
      throw new Error(`Settings shape: ${path} is not a JSON Schema object.`);
    }
    const name = isRoot ? undefined : this.byJson.get(JSON.stringify(schema));
    if (name !== undefined) {
      this.used.add(name);
      return name;
    }
    if ("$ref" in schema) {
      throw new Error(`Settings shape: ${path} uses $ref, which is not read.`);
    }
    if ("const" in schema) return JSON.stringify(schema.const);
    if (Array.isArray(schema.enum)) {
      return schema.enum.map((value) => JSON.stringify(value)).join("|");
    }
    for (const keyword of ["oneOf", "anyOf"] as const) {
      const branches = schema[keyword];
      if (Array.isArray(branches)) {
        return branches
          .map((branch, index) =>
            this.render(branch, `${path}.${keyword}[${index}]`),
          )
          .join(" | ");
      }
    }
    const type = Array.isArray(schema.type) ? schema.type : [schema.type];
    return type.map((one) => this.renderType(one, schema, path)).join("|");
  }

  private renderType(type: unknown, schema: JsonSchema, path: string): string {
    switch (type) {
      case "string":
      case "boolean":
      case "null":
        return type;
      case "number":
      case "integer":
        return renderNumber(schema);
      case "array":
        return `[${schema.items === undefined ? "any" : this.render(schema.items, `${path}[]`)}]`;
      case "object":
        return this.renderObject(schema, path);
      case undefined:
        return "any";
      default:
        throw new Error(
          `Settings shape: ${path} has the type ${JSON.stringify(type)}, which is not read.`,
        );
    }
  }

  private renderObject(schema: JsonSchema, path: string): string {
    const properties = isSchema(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    const entries = Object.entries(properties).map(
      ([key, value]) =>
        `${key}${required.has(key) ? "" : "?"}:${this.render(value, `${path}.${key}`)}`,
    );
    if (isSchema(schema.additionalProperties)) {
      entries.push(
        `<name>:${this.render(schema.additionalProperties, `${path}.<name>`)}`,
      );
    }
    return `{${entries.join(",")}}`;
  }
}

/**
 * One line that shows the shape a node's `settings` takes, read off the JSON
 * Schema of its contract: `key` is required, `key?` optional, a literal or
 * enum lists its values, `a-b` is a bounded number, `[x]` a list, `{<name>:x}`
 * a map, and `|` separates the forms a field can take. A shape below the root
 * that equals one in `named` is written as its name; `used` says which. The
 * root is never replaced, so a named shape is itself described by calling this
 * with it.
 */
export function describeSettingsShape(
  schema: JsonSchema,
  named: NamedShapes = {},
): { shape: string; used: string[] } {
  const writer = new ShapeWriter(named);
  const shape = writer.render(schema, "settings", true);
  return { shape, used: [...writer.used] };
}
