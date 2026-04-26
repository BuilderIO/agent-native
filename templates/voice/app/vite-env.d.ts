/// <reference types="vite/client" />
/// <reference types="react-router/virtual" />

declare module "*.css?url" {
  const href: string;
  export default href;
}
