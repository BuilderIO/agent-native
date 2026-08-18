import { createContext, useContext, type ReactNode } from "react";

export interface RegistryBlockSideMapBlock {
  id: string;
  title?: string;
  summary?: string;
  data: unknown;
}

export interface RegistryBlockNestedBlock {
  type: string;
  id: string;
  title?: string;
  summary?: string;
  data: unknown;
  [key: string]: unknown;
}

export interface RegistryBlockDataChangeMeta {
  containerRegion?: {
    regionId: string;
    blocks: RegistryBlockNestedBlock[];
  };
}

export interface RegistryBlockEditSurfaceOptions {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  blockType: string;
  blockTitle?: string;
  blockSummary?: string;
  blockData: unknown;
  trigger: ReactNode;
  children: ReactNode;
}

export interface RegistryBlockRenderOptions {
  blockType: string;
  editable: boolean;
  selected: boolean;
  shellHovered: boolean;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  onChange: (nextData: unknown, meta?: RegistryBlockDataChangeMeta) => void;
}

export interface RegistryBlockRenderResult {
  body: ReactNode;
  editSurface?: ReactNode;
}

export interface RegistryBlockDataValue<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
> {
  getBlock: (blockId: string) => TBlock | undefined;
  onBlockDataChange: (
    blockId: string,
    nextData: unknown,
    meta?: RegistryBlockDataChangeMeta,
  ) => void;
  editable: boolean;
  notionSync?: boolean;
  isNotionIncompatibleType?: (blockType: string) => boolean;
  renderLegacyBlock?: (
    block: TBlock,
    options: { editing: boolean },
  ) => ReactNode;
  renderLegacyBlockEditor?: (
    block: TBlock,
    args: { onChange: (nextData: unknown) => void },
  ) => ReactNode;
  legacyBlockSelfEdits?: (blockType: string) => boolean;
  renderRegisteredBlock?: (
    block: TBlock,
    options: RegistryBlockRenderOptions,
  ) => RegistryBlockRenderResult | null;
  renderEditSurface?: (options: RegistryBlockEditSurfaceOptions) => ReactNode;
}

const RegistryBlockDataContext =
  createContext<RegistryBlockDataValue<any> | null>(null);

export function RegistryBlockDataProvider<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>({
  value,
  children,
}: {
  value: RegistryBlockDataValue<TBlock>;
  children: ReactNode;
}) {
  return (
    <RegistryBlockDataContext.Provider value={value}>
      {children}
    </RegistryBlockDataContext.Provider>
  );
}

export function useRegistryBlockData<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>(): RegistryBlockDataValue<TBlock> | null {
  return useContext(
    RegistryBlockDataContext,
  ) as RegistryBlockDataValue<TBlock> | null;
}
