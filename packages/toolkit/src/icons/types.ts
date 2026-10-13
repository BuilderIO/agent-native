export type ResourceIconColor =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type ResourceIconValue =
  | { version: 1; kind: "emoji"; emoji: string }
  | {
      version: 1;
      kind: "library";
      library: "tabler";
      name: string;
      variant?: "outline" | "filled";
      color?: ResourceIconColor;
    }
  | {
      version: 1;
      kind: "image";
      assetId: string;
      authority: string;
      alt?: string;
    };

export interface ResourceIconImage extends Extract<
  ResourceIconValue,
  { kind: "image" }
> {
  previewUrl?: string;
}
