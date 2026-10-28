/// <reference types="@webgpu/types" />

declare module "*.wgsl?raw" {
  const source: string;
  export default source;
}
