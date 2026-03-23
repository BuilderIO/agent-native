import type { CompositionEntry } from "@/remotion/registry";

type PropsEditorProps = {
  composition: CompositionEntry;
  props: Record<string, any>;
  onPropsChange: (props: Record<string, any>) => void;
};

function renderField(
  key: string,
  value: any,
  onChange: (key: string, value: any) => void,
  depth = 0,
): React.ReactNode {
  if (Array.isArray(value)) {
    return (
      <div key={key} className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {key}
        </label>
        <div className="space-y-2 pl-3 border-l border-border">
          {value.map((item, i) => (
            <div key={i} className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground/60 font-mono">
                [{i}]
              </span>
              {typeof item === "object" && item !== null ? (
                <div className="space-y-1.5">
                  {Object.entries(item).map(([k, v]) =>
                    renderField(
                      k,
                      v,
                      (subKey, subVal) => {
                        const newArr = [...value];
                        newArr[i] = { ...item, [subKey]: subVal };
                        onChange(key, newArr);
                      },
                      depth + 1,
                    ),
                  )}
                </div>
              ) : (
                renderField(
                  String(i),
                  item,
                  (_, v) => {
                    const newArr = [...value];
                    newArr[i] = v;
                    onChange(key, newArr);
                  },
                  depth + 1,
                )
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (typeof value === "object" && value !== null) {
    return (
      <div key={key} className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {key}
        </label>
        <div className="space-y-1.5 pl-3 border-l border-border">
          {Object.entries(value).map(([k, v]) =>
            renderField(
              k,
              v,
              (subKey, subVal) => {
                onChange(key, { ...value, [subKey]: subVal });
              },
              depth + 1,
            ),
          )}
        </div>
      </div>
    );
  }

  // Color input
  if (typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value)) {
    return (
      <div key={key} className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground min-w-0 flex-shrink-0 capitalize">
          {key}
        </label>
        <div className="flex items-center gap-1.5 flex-1 justify-end">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(key, e.target.value)}
            className="w-6 h-6 rounded border border-border cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(key, e.target.value)}
            className="w-20 text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground/80 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>
    );
  }

  // String input
  if (typeof value === "string") {
    const isMultiline = value.includes("\n") || value.length > 40;
    return (
      <div key={key} className="space-y-1">
        <label className="text-xs text-muted-foreground capitalize">
          {key}
        </label>
        {isMultiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(key, e.target.value)}
            rows={3}
            className="w-full text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-foreground/80 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(key, e.target.value)}
            className="w-full text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        )}
      </div>
    );
  }

  // Number input
  if (typeof value === "number") {
    return (
      <div key={key} className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground capitalize flex-shrink-0">
          {key}
        </label>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(key, Number(e.target.value))}
          className="w-full text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-foreground/80 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>
    );
  }

  // Boolean
  if (typeof value === "boolean") {
    return (
      <div key={key} className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground capitalize flex-1">
          {key}
        </label>
        <button
          onClick={() => onChange(key, !value)}
          className={`w-8 h-5 rounded-full transition-colors ${
            value ? "bg-primary" : "bg-secondary"
          }`}
        >
          <div
            className={`w-3.5 h-3.5 bg-white rounded-full transition-transform mx-0.5 ${
              value ? "translate-x-3" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    );
  }

  return null;
}

export function PropsEditor({
  composition,
  props,
  onPropsChange,
}: PropsEditorProps) {
  const handleChange = (key: string, value: any) => {
    onPropsChange({ ...props, [key]: value });
  };

  return (
    <div className="space-y-3 p-4 border-t">
      {/* Props fields */}
      {Object.entries(props).length > 0 ? (
        Object.entries(props).map(([key, value]) =>
          renderField(key, value, handleChange),
        )
      ) : (
        <div className="text-center py-6 px-4 bg-muted/30 rounded-lg border border-dashed border-border">
          <p className="text-xs text-muted-foreground">
            No properties to configure
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Add to the video by asking the agent to create something
          </p>
        </div>
      )}
    </div>
  );
}
