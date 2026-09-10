/// <reference types="vite/client" />
/// <reference types="@vgpu/wgsl/wgsl-types" />

declare module "react-dom/server.browser" {
  export * from "react-dom/server";
  export { default } from "react-dom/server";
}
