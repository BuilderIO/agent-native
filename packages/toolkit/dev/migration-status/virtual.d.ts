declare module "virtual:migration-status" {
  const status: import("./scan.js").MigrationStatus;
  export default status;
}
