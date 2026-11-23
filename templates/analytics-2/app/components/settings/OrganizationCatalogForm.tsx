import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LABEL_COLORS } from "@/lib/model/label-colors";

export interface CatalogEntry {
  id: string;
  name: string;
  color: string | null;
  description?: string;
  endorsed?: boolean;
  inLibrary?: boolean;
  enforcesReview?: boolean;
}

export function OrganizationCatalogForm({
  entry,
  isStatus,
  showLibrary,
  isDefault = false,
  names,
  close,
  save,
}: {
  entry?: CatalogEntry;
  isStatus: boolean;
  showLibrary: boolean;
  isDefault?: boolean;
  names: readonly string[];
  close: () => void;
  save: (values: {
    name: string;
    color: string;
    description?: string;
    endorsed: boolean;
    inLibrary: boolean;
    enforcesReview: boolean;
  }) => Promise<void>;
}) {
  const t = useT();
  const label = (key: string, values?: Record<string, string>) =>
    t(`analytics.organizationCatalog.${key}`, values);
  const [name, setName] = useState(entry?.name ?? "");
  const [color, setColor] = useState(entry?.color ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [endorsed, setEndorsed] = useState(entry?.endorsed ?? false);
  const [inLibrary, setInLibrary] = useState(entry?.inLibrary ?? false);
  const [enforcesReview, setEnforcesReview] = useState(
    entry?.enforcesReview ?? false,
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const duplicate = names.includes(name);
  const submitLabel = label(
    entry
      ? isStatus
        ? "updateStatus"
        : "updateCategory"
      : isStatus
        ? "newStatus"
        : "newCategory",
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        void save({
          name: name.trim(),
          color,
          description,
          endorsed,
          inLibrary,
          enforcesReview,
        })
          .then(close)
          .catch((cause: unknown) =>
            setError(
              cause instanceof Error ? cause.message : label("saveError"),
            ),
          )
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1">
        {label("name")}{" "}
        <Input
          aria-label={label("name")}
          value={name}
          required
          maxLength={30}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {duplicate && (
        <span role="alert">
          {label(isStatus ? "duplicateStatus" : "duplicateCategory")}
        </span>
      )}
      <fieldset>
        <legend>{label("color")}</legend>
        <div className="flex flex-wrap gap-2">
          {LABEL_COLORS.map((option) => (
            <label key={option} title={label("useColor", { color: option })}>
              <input
                type="radio"
                name="catalog-color"
                aria-label={label("useColor", { color: option })}
                value={option}
                checked={color === option}
                onChange={() => setColor(option)}
              />
              <span className="ws-label-dot" style={{ background: option }} />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1">
        {label("description")}
        <Textarea
          aria-label={label("description")}
          value={description}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {isStatus && (
        <>
          <label>
            <input
              type="checkbox"
              checked={endorsed}
              disabled={isDefault}
              onChange={(event) => setEndorsed(event.target.checked)}
            />{" "}
            {label("endorsed")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={enforcesReview}
              onChange={(event) => setEnforcesReview(event.target.checked)}
            />{" "}
            {label("enforcesReview")}
          </label>
          {showLibrary && (
            <label>
              <input
                type="checkbox"
                checked={inLibrary || endorsed}
                disabled={endorsed}
                onChange={(event) => setInLibrary(event.target.checked)}
              />{" "}
              {label("inLibrary")}
            </label>
          )}
        </>
      )}
      {error && <span role="alert">{error}</span>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>
          {label("cancel")}
        </Button>
        <Button
          type="submit"
          disabled={pending || !name.trim() || !color || duplicate}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
