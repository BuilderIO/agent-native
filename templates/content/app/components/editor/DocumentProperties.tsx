import { useMemo, useState } from "react";
import {
  IconAlignLeft,
  IconAt,
  IconCalendar,
  IconCheck,
  IconCircleChevronDown,
  IconCircleDotted,
  IconClockFilled,
  IconClock,
  IconCopy,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconHash,
  IconLink,
  IconList,
  IconNumber,
  IconNumber123,
  IconPhone,
  IconPlus,
  IconSquareCheck,
  IconTrash,
  IconUserCircle,
  type Icon,
} from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  useConfigureDocumentProperty,
  useDeleteDocumentProperty,
  useDocumentProperties,
  useDuplicateDocumentProperty,
  useSetDocumentProperty,
} from "@/hooks/use-document-properties";
import {
  DOCUMENT_PROPERTY_TYPE_LABELS,
  DOCUMENT_PROPERTY_TYPES,
  DOCUMENT_PROPERTY_VISIBILITY_LABELS,
  DOCUMENT_PROPERTY_VISIBILITIES,
  defaultPropertyOptions,
  isEmptyPropertyValue,
  isComputedPropertyType,
  type DocumentPropertyOption,
  type DocumentPropertyOptionColor,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
  type DocumentPropertyVisibility,
} from "@shared/properties";
import type { DocumentProperty } from "@shared/api";

interface DocumentPropertiesProps {
  documentId: string;
  canEdit: boolean;
}

const TYPE_ICONS: Record<DocumentPropertyType, Icon> = {
  text: IconAlignLeft,
  number: IconHash,
  select: IconCircleChevronDown,
  multi_select: IconList,
  status: IconCircleDotted,
  date: IconCalendar,
  checkbox: IconSquareCheck,
  url: IconLink,
  email: IconAt,
  phone: IconPhone,
  id: IconNumber,
  created_time: IconClockFilled,
  created_by: IconUserCircle,
  last_edited_time: IconClockFilled,
};

const OPTION_COLOR_CLASSES: Record<DocumentPropertyOptionColor, string> = {
  gray: "bg-muted text-muted-foreground",
  brown: "bg-amber-950/10 text-amber-900 dark:text-amber-200",
  orange: "bg-orange-500/15 text-orange-800 dark:text-orange-200",
  yellow: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-100",
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  blue: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  purple: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
  pink: "bg-pink-500/15 text-pink-800 dark:text-pink-200",
  red: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
};

const OPTION_COLORS: DocumentPropertyOptionColor[] = [
  "gray",
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "red",
];

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `option-${Date.now()}`;
}

function formatDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(year, month - 1, day));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function optionClass(option?: DocumentPropertyOption | null) {
  return OPTION_COLOR_CLASSES[option?.color ?? "gray"];
}

function optionById(property: DocumentProperty, id: string | null) {
  return property.definition.options.options?.find(
    (option) => option.id === id,
  );
}

function displayValue(property: DocumentProperty) {
  const value = property.value;
  const type = property.definition.type;

  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/70">Empty</span>;
  }

  if (type === "checkbox") {
    return value ? (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <IconCheck className="size-3.5" />
        Checked
      </span>
    ) : (
      <span className="text-muted-foreground/70">Unchecked</span>
    );
  }

  if (type === "date") {
    return <span>{formatDate(String(value))}</span>;
  }

  if (type === "created_time" || type === "last_edited_time") {
    return <span>{formatDateTime(String(value))}</span>;
  }

  if (type === "select" || type === "status") {
    const option = optionById(property, String(value));
    return option ? (
      <OptionPill option={option} />
    ) : (
      <span>{String(value)}</span>
    );
  }

  if (type === "multi_select" && Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-muted-foreground/70">Empty</span>;
    return (
      <span className="inline-flex flex-wrap gap-1">
        {value.map((id) => {
          const option = optionById(property, id);
          return option ? <OptionPill key={id} option={option} /> : null;
        })}
      </span>
    );
  }

  if (type === "url" && typeof value === "string") {
    return (
      <span className="underline decoration-muted-foreground/40 underline-offset-2">
        {value}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

function OptionPill({ option }: { option: DocumentPropertyOption }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs font-medium",
        optionClass(option),
      )}
    >
      <span className="truncate">{option.name}</span>
    </span>
  );
}

function makeOption(
  name: string,
  index: number,
  existingIds: string[],
): DocumentPropertyOption {
  const baseId = slugify(name);
  let id = baseId;
  let suffix = 2;
  while (existingIds.includes(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    name: name.trim(),
    color: OPTION_COLORS[index % OPTION_COLORS.length],
  };
}

function scalarPlaceholder(type: DocumentPropertyType) {
  switch (type) {
    case "number":
      return "0";
    case "date":
      return "Select a date";
    case "url":
      return "https://example.com";
    case "email":
      return "name@example.com";
    case "phone":
      return "+1 (555) 123-4567";
    default:
      return "Empty";
  }
}

export function DocumentProperties({
  documentId,
  canEdit,
}: DocumentPropertiesProps) {
  const { data, isLoading } = useDocumentProperties(documentId);
  const properties = data?.properties ?? [];
  const visibleProperties = properties.filter(isPropertyVisible);
  const hiddenProperties = properties.filter(
    (property) => !isPropertyVisible(property),
  );

  return (
    <div className="mt-5 border-y border-transparent py-1">
      {isLoading ? (
        <div className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          Loading properties
        </div>
      ) : visibleProperties.length > 0 ? (
        <div className="grid gap-0.5">
          {visibleProperties.map((property) => (
            <PropertyRow
              key={property.definition.id}
              property={property}
              documentId={documentId}
              canEdit={canEdit}
            />
          ))}
        </div>
      ) : null}

      {canEdit && hiddenProperties.length > 0 ? (
        <HiddenPropertiesMenu
          documentId={documentId}
          properties={hiddenProperties}
        />
      ) : null}

      {canEdit ? <AddProperty documentId={documentId} /> : null}
    </div>
  );
}

function isPropertyVisible(property: DocumentProperty) {
  const visibility = property.definition.visibility;
  if (visibility === "always_hide") return false;
  if (visibility === "hide_when_empty") {
    return !isEmptyPropertyValue(property.value);
  }
  return true;
}

function HiddenPropertiesMenu({
  documentId,
  properties,
}: {
  documentId: string;
  properties: DocumentProperty[];
}) {
  const configure = useConfigureDocumentProperty(documentId);

  async function showProperty(property: DocumentProperty) {
    await configure.mutateAsync({
      id: property.definition.id,
      documentId,
      name: property.definition.name,
      type: property.definition.type,
      visibility: "always_show",
      options: property.definition.options,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-1 flex h-8 items-center gap-2 rounded px-1 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <IconEyeOff className="size-4" />
          Hidden properties
          <span className="text-xs text-muted-foreground/70">
            {properties.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {properties.map((property) => {
          const Icon = TYPE_ICONS[property.definition.type];
          return (
            <DropdownMenuItem
              key={property.definition.id}
              disabled={configure.isPending}
              onSelect={(event) => {
                event.preventDefault();
                void showProperty(property);
              }}
            >
              <Icon className="mr-2 size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {property.definition.name}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">Show</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PropertyRow({
  property,
  documentId,
  canEdit,
}: {
  property: DocumentProperty;
  documentId: string;
  canEdit: boolean;
}) {
  const Icon = TYPE_ICONS[property.definition.type];
  const value = (
    <div className="min-w-0 flex-1 truncate text-left text-sm">
      {displayValue(property)}
    </div>
  );

  return (
    <div className="grid min-h-8 grid-cols-[160px_minmax(0,1fr)] items-start gap-3 rounded px-1 py-1 text-sm hover:bg-muted/40">
      {canEdit ? (
        <PropertyManagementPopover
          property={property}
          documentId={documentId}
          icon={Icon}
        />
      ) : (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{property.definition.name}</span>
        </div>
      )}
      {canEdit && property.editable ? (
        <PropertyValuePopover property={property} documentId={documentId}>
          {value}
        </PropertyValuePopover>
      ) : (
        value
      )}
    </div>
  );
}

function PropertyManagementPopover({
  property,
  documentId,
  icon: Icon,
}: {
  property: DocumentProperty;
  documentId: string;
  icon: Icon;
}) {
  const configure = useConfigureDocumentProperty(documentId);
  const duplicate = useDuplicateDocumentProperty(documentId);
  const remove = useDeleteDocumentProperty(documentId);
  const [open, setOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [name, setName] = useState(property.definition.name);
  const [newOption, setNewOption] = useState("");
  const typeIsLocked = isComputedPropertyType(property.definition.type);
  const typeNeedsOptions =
    property.definition.type === "select" ||
    property.definition.type === "status" ||
    property.definition.type === "multi_select";

  function resetDraft() {
    setName(property.definition.name);
    setNewOption("");
  }

  async function configureProperty(next: {
    name?: string;
    type?: DocumentPropertyType;
    visibility?: DocumentPropertyVisibility;
    options?: DocumentPropertyOptions;
  }) {
    const nextType = next.type ?? property.definition.type;
    await configure.mutateAsync({
      id: property.definition.id,
      documentId,
      name: next.name?.trim() || property.definition.name,
      type: nextType,
      visibility: next.visibility,
      options: next.options ?? property.definition.options,
    });
  }

  async function renameProperty() {
    const nextName = name.trim();
    if (!nextName || nextName === property.definition.name) return;
    await configureProperty({ name: nextName });
  }

  async function updateType(nextType: DocumentPropertyType) {
    if (nextType === property.definition.type) return;
    await configureProperty({
      type: nextType,
      options: defaultPropertyOptions(nextType),
    });
    setOpen(false);
  }

  async function updateVisibility(nextVisibility: DocumentPropertyVisibility) {
    if (nextVisibility === property.definition.visibility) return;
    await configureProperty({ visibility: nextVisibility });
    setOpen(false);
  }

  async function duplicateProperty() {
    await duplicate.mutateAsync({
      documentId,
      propertyId: property.definition.id,
    });
    setOpen(false);
  }

  async function deleteProperty() {
    await remove.mutateAsync({
      documentId,
      propertyId: property.definition.id,
    });
    setOpen(false);
  }

  async function addOption() {
    const optionName = newOption.trim();
    if (!optionName) return;
    const existing = property.definition.options.options ?? [];
    const option = makeOption(
      optionName,
      existing.length,
      existing.map((item) => item.id),
    );
    await configureProperty({
      options: { options: [...existing, option] },
    });
    setNewOption("");
  }

  async function removeOption(id: string) {
    await configureProperty({
      options: {
        options: (property.definition.options.options ?? []).filter(
          (option) => option.id !== id,
        ),
      },
    });
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) resetDraft();
          setOpen(nextOpen);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Property menu for ${property.definition.name}`}
            className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{property.definition.name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <div
            className="flex items-center gap-2 p-1"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <IconEdit className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={name}
              aria-label="Property name"
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void renameProperty()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="h-8"
            />
          </div>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon className="mr-2 size-4 text-muted-foreground" />
              <span className="flex-1">Type</span>
              <span className="mr-2 text-muted-foreground">
                {DOCUMENT_PROPERTY_TYPE_LABELS[property.definition.type]}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-auto">
              {DOCUMENT_PROPERTY_TYPES.map((propertyType) => {
                const TypeIcon = TYPE_ICONS[propertyType];
                const selected = property.definition.type === propertyType;
                const disabled = typeIsLocked && !selected;
                return (
                  <DropdownMenuItem
                    key={propertyType}
                    disabled={disabled}
                    onSelect={(event) => {
                      event.preventDefault();
                      void updateType(propertyType);
                    }}
                  >
                    <TypeIcon className="mr-2 size-4 text-muted-foreground" />
                    <span className="flex-1">
                      {DOCUMENT_PROPERTY_TYPE_LABELS[propertyType]}
                    </span>
                    {selected ? (
                      <IconCheck className="size-4 text-muted-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconEye className="mr-2 size-4 text-muted-foreground" />
              <span className="flex-1">Visibility</span>
              <span className="mr-2 text-muted-foreground">
                {
                  DOCUMENT_PROPERTY_VISIBILITY_LABELS[
                    property.definition.visibility
                  ]
                }
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {DOCUMENT_PROPERTY_VISIBILITIES.map((visibility) => (
                <DropdownMenuItem
                  key={visibility}
                  onSelect={(event) => {
                    event.preventDefault();
                    void updateVisibility(visibility);
                  }}
                >
                  <span className="flex-1">
                    {DOCUMENT_PROPERTY_VISIBILITY_LABELS[visibility]}
                  </span>
                  {property.definition.visibility === visibility ? (
                    <IconCheck className="size-4 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {typeNeedsOptions ? (
            <div className="grid gap-2 px-1 py-2">
              <div className="px-1 text-xs font-medium text-muted-foreground">
                Options
              </div>
              <div className="grid gap-1">
                {(property.definition.options.options ?? []).map((option) => (
                  <div
                    key={option.id}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <OptionPill option={option} />
                    <button
                      type="button"
                      aria-label={`Remove option ${option.name}`}
                      className="rounded px-1 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => void removeOption(option.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addOption();
                }}
              >
                <Input
                  value={newOption}
                  placeholder="Add option"
                  onChange={(event) => setNewOption(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="h-8"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={!newOption.trim() || configure.isPending}
                >
                  Add
                </Button>
              </form>
            </div>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={duplicate.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void duplicateProperty();
            }}
          >
            <IconCopy className="mr-2 size-4 text-muted-foreground" />
            Duplicate property
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={remove.isPending}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setOpen(false);
              setConfirmDeleteOpen(true);
            }}
          >
            <IconTrash className="mr-2 size-4" />
            Delete property
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete property?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes "{property.definition.name}" and its values from
              every document in this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void deleteProperty()}
            >
              Delete property
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PropertyValuePopover({
  property,
  documentId,
  children,
}: {
  property: DocumentProperty;
  documentId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${property.definition.name}`}
          className="flex min-h-6 min-w-0 items-center rounded px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <PropertyValueEditor
          property={property}
          documentId={documentId}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function PropertyValueEditor({
  property,
  documentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  onDone: () => void;
}) {
  const type = property.definition.type;
  if (type === "select" || type === "status" || type === "multi_select") {
    return (
      <OptionValueEditor
        property={property}
        documentId={documentId}
        onDone={onDone}
      />
    );
  }

  if (type === "checkbox") {
    return (
      <CheckboxValueEditor
        property={property}
        documentId={documentId}
        onDone={onDone}
      />
    );
  }

  return (
    <ScalarValueEditor
      property={property}
      documentId={documentId}
      onDone={onDone}
    />
  );
}

function ScalarValueEditor({
  property,
  documentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  onDone: () => void;
}) {
  const mutation = useSetDocumentProperty(documentId);
  const type = property.definition.type;
  const inputType =
    type === "number"
      ? "number"
      : type === "date"
        ? "date"
        : type === "email"
          ? "email"
          : type === "url"
            ? "url"
            : type === "phone"
              ? "tel"
              : "text";
  const initialValue =
    type === "date" && typeof property.value === "string"
      ? property.value.slice(0, 10)
      : property.value === null || Array.isArray(property.value)
        ? ""
        : String(property.value);
  const [value, setValue] = useState(initialValue);

  async function save(nextValue = value) {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: nextValue,
    });
    onDone();
  }

  async function clear() {
    await mutation.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: null,
    });
    onDone();
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const formValue = formData.get("property-value");
        void save(typeof formValue === "string" ? formValue : value);
      }}
    >
      <Input
        autoFocus
        name="property-value"
        type={inputType}
        value={value}
        placeholder={scalarPlaceholder(type)}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={mutation.isPending}
        >
          Clear
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

function CheckboxValueEditor({
  property,
  documentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  onDone: () => void;
}) {
  const mutation = useSetDocumentProperty(documentId);
  const checked = Boolean(property.value);

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm hover:bg-accent"
      onClick={async () => {
        await mutation.mutateAsync({
          documentId,
          propertyId: property.definition.id,
          value: !checked,
        });
        onDone();
      }}
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded border",
          checked && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {checked ? <IconCheck className="size-3" /> : null}
      </span>
      {checked ? "Uncheck" : "Check"}
    </button>
  );
}

function OptionValueEditor({
  property,
  documentId,
  onDone,
}: {
  property: DocumentProperty;
  documentId: string;
  onDone: () => void;
}) {
  const setValue = useSetDocumentProperty(documentId);
  const configure = useConfigureDocumentProperty(documentId);
  const options = property.definition.options.options ?? [];
  const currentSelectedIds = useMemo(() => {
    if (property.definition.type === "multi_select") {
      return Array.isArray(property.value) ? property.value : [];
    }
    return typeof property.value === "string" ? [property.value] : [];
  }, [property.definition.type, property.value]);
  const [selectedIds, setSelectedIds] = useState(currentSelectedIds);
  const [newOption, setNewOption] = useState("");

  async function setSelected(next: string | string[]) {
    setSelectedIds(Array.isArray(next) ? next : next ? [next] : []);
    await setValue.mutateAsync({
      documentId,
      propertyId: property.definition.id,
      value: next,
    });
    if (property.definition.type !== "multi_select") onDone();
  }

  async function addOption() {
    const name = newOption.trim();
    if (!name) return;
    const option = makeOption(
      name,
      options.length,
      options.map((item) => item.id),
    );
    const nextOptions = [...options, option];
    await configure.mutateAsync({
      id: property.definition.id,
      documentId,
      name: property.definition.name,
      type: property.definition.type,
      options: { options: nextOptions },
    });
    setNewOption("");
    if (property.definition.type === "multi_select") {
      await setSelected([...selectedIds, option.id]);
    } else {
      await setSelected(option.id);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="max-h-52 overflow-auto">
        {options.map((option) => {
          const checked = selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                if (property.definition.type === "multi_select") {
                  const next = checked
                    ? selectedIds.filter((id) => id !== option.id)
                    : [...selectedIds, option.id];
                  void setSelected(next);
                } else {
                  void setSelected(option.id);
                }
              }}
            >
              <OptionPill option={option} />
              {checked ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-start"
        disabled={setValue.isPending}
        onClick={() =>
          void setSelected(
            property.definition.type === "multi_select" ? [] : "",
          )
        }
      >
        Clear value
      </Button>
      <form
        className="flex gap-2 border-t pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void addOption();
        }}
      >
        <Input
          value={newOption}
          placeholder="Add option"
          onChange={(event) => setNewOption(event.target.value)}
          className="h-8"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={
            !newOption.trim() || configure.isPending || setValue.isPending
          }
        >
          Add
        </Button>
      </form>
    </div>
  );
}

function AddProperty({ documentId }: { documentId: string }) {
  const configure = useConfigureDocumentProperty(documentId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function add(type: DocumentPropertyType) {
    const label = DOCUMENT_PROPERTY_TYPE_LABELS[type];
    await configure.mutateAsync({
      documentId,
      name: name.trim() || label,
      type,
      options: defaultPropertyOptions(type),
    });
    setName("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 flex h-8 items-center gap-2 rounded px-1 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <IconPlus className="size-4" />
          Add property
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="grid gap-2">
          <Input
            autoFocus
            value={name}
            placeholder="Property name"
            onChange={(event) => setName(event.target.value)}
          />
          <div className="max-h-80 overflow-auto rounded border p-1">
            {DOCUMENT_PROPERTY_TYPES.map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  aria-label={`Add ${DOCUMENT_PROPERTY_TYPE_LABELS[type]} property`}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  disabled={configure.isPending}
                  onClick={() => void add(type)}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">
                    {DOCUMENT_PROPERTY_TYPE_LABELS[type]}
                  </span>
                  {isComputedPropertyType(type) ? (
                    <span className="text-xs text-muted-foreground">
                      Computed
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
