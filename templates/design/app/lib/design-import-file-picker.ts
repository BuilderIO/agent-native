export interface ImportFileFormat {
  label: string;
  mime: string;
  extensions: readonly string[];
}

export const FIGMA_IMPORT_FORMAT: ImportFileFormat = {
  label: "Figma",
  mime: "application/x-figma",
  extensions: [".fig"],
};

export const HTML_IMPORT_FORMAT: ImportFileFormat = {
  label: "HTML",
  mime: "text/html",
  extensions: [".html", ".htm"],
};

/** Every format the editor's File > Import accepts. Keep in step with the
 * extension checks in `DesignImportPanel`'s `importFile`. */
export const DESIGN_IMPORT_FORMATS: readonly ImportFileFormat[] = [
  FIGMA_IMPORT_FORMAT,
  HTML_IMPORT_FORMAT,
];

interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface ShowOpenFilePickerOptions {
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  types?: FilePickerAcceptType[];
}

interface PickedFileHandle {
  getFile(): Promise<File>;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (
    options?: ShowOpenFilePickerOptions,
  ) => Promise<PickedFileHandle[]>;
};

export type ImportFilePick =
  | { status: "picked"; file: File }
  | { status: "cancelled" };

export function importFormatsAccept(
  formats: readonly ImportFileFormat[],
): string {
  return formats.flatMap((format) => format.extensions).join(",");
}

export function importFilePickerTypes(
  formats: readonly ImportFileFormat[],
  allSupportedLabel: string,
): FilePickerAcceptType[] {
  const types = formats.map((format) => ({
    description: `${format.label} (${format.extensions.join(", ")})`,
    accept: { [format.mime]: [...format.extensions] },
  }));
  if (types.length < 2) return types;
  const everything: Record<string, string[]> = {};
  for (const format of formats) {
    everything[format.mime] = [
      ...(everything[format.mime] ?? []),
      ...format.extensions,
    ];
  }
  return [{ description: allSupportedLabel, accept: everything }, ...types];
}

// Chromium refuses the picker in cross-origin subframes; the <input> path
// still works there.
export function supportsNativeImportPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as PickerWindow).showOpenFilePicker === "function" &&
    window.self === window.top
  );
}

export async function pickImportFile(
  formats: readonly ImportFileFormat[],
  allSupportedLabel: string,
): Promise<ImportFilePick> {
  const host = window as PickerWindow;
  if (!supportsNativeImportPicker() || !host.showOpenFilePicker) {
    throw new Error("The native file picker is unavailable in this context.");
  }
  let handles: PickedFileHandle[];
  try {
    handles = await host.showOpenFilePicker({
      types: importFilePickerTypes(formats, allSupportedLabel),
      // The importers reject any other extension, so an "All files" format
      // would only lead to an error.
      excludeAcceptAllOption: true,
      multiple: false,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "cancelled" };
    }
    throw error;
  }
  return { status: "picked", file: await handles[0].getFile() };
}

/** Opens the native picker with named formats where the browser has one.
 * Elsewhere it calls `openFallbackInput` synchronously, so the `<input>`
 * click stays inside the user gesture. A cancelled dialog calls neither
 * `onFile` nor `onError`. */
export function requestImportFile({
  formats,
  allSupportedLabel,
  openFallbackInput,
  onFile,
  onError,
}: {
  formats: readonly ImportFileFormat[];
  allSupportedLabel: string;
  openFallbackInput: () => void;
  onFile: (file: File) => void;
  onError: (error: unknown) => void;
}): void {
  if (!supportsNativeImportPicker()) {
    openFallbackInput();
    return;
  }
  void pickImportFile(formats, allSupportedLabel).then((pick) => {
    if (pick.status === "picked") onFile(pick.file);
  }, onError);
}
