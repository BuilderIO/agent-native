import { useT } from "@agent-native/core/client/i18n";
import { IconCube } from "@tabler/icons-react";

export type SemanticModelField = {
  name: string;
  kind: "dimension" | "measure";
  type?: string;
};

export type SemanticModelItem = {
  id: string;
  name: string;
  description?: string;
  fields: readonly SemanticModelField[];
};

export function SemanticModelList({
  models,
  search,
  selectedId,
  onSelect,
}: {
  models: readonly SemanticModelItem[];
  search: string;
  selectedId: string | null;
  onSelect: (model: SemanticModelItem) => void;
}) {
  const t = useT();
  const needle = search.trim().toLowerCase();
  const visible = models.filter((model) =>
    model.name.toLowerCase().includes(needle),
  );
  if (visible.length === 0) {
    return (
      <p className="nb-side-panel-note">
        {t(
          models.length === 0
            ? "dataBrowser.empty.models"
            : "dataBrowser.browse.noMatches",
          { query: search.trim() },
        )}
      </p>
    );
  }
  return (
    <ul className="nb-outline-list">
      {visible.map((model) => (
        <li key={model.id}>
          <button
            type="button"
            className="nb-outline-item"
            style={{ paddingInlineStart: 6 }}
            aria-current={selectedId === model.id ? "true" : undefined}
            onClick={() => onSelect(model)}
          >
            <IconCube size={13} aria-hidden="true" />
            <span className="nb-outline-name">{model.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SemanticModelDetail({ model }: { model: SemanticModelItem }) {
  const t = useT();
  const groups = [
    { kind: "dimension", label: t("dataBrowser.notebook.dimensions") },
    { kind: "measure", label: t("dataBrowser.notebook.measures") },
  ] as const;
  return (
    <>
      <h3 className="nb-data-browser-detail-title">{model.name}</h3>
      {model.description ? (
        <p className="nb-side-panel-note">{model.description}</p>
      ) : null}
      {groups.map(({ kind, label }) => {
        const fields = model.fields.filter((field) => field.kind === kind);
        if (fields.length === 0) return null;
        return (
          <section key={kind}>
            <h4 className="nb-data-browser-detail-title">{label}</h4>
            <ul className="nb-outline-list">
              {fields.map((field) => (
                <li key={field.name} className="nb-outline-item">
                  <span className="nb-outline-name">{field.name}</span>
                  {field.type ? (
                    <span className="nb-outline-kind">{field.type}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
