export const dashboardSheetsExportMessages = {
  dashboardSheets: {
    connectionLabel: "Google Sheets connection",
    connectionPlaceholder: "Choose a Google connection",
    connectionLoadFailed: "Google Sheets connections could not be loaded.",
    noConnection: "No Google Sheets connection is granted to Analytics 2.",
    connect: "Connect Google Sheets",
    export: "Send to Google Sheets",
    checking: "Checking Google Sheets…",
    creating: "Creating spreadsheet…",
    created: "Spreadsheet created with the complete panel result.",
    open: "Open spreadsheet",
    openUnpopulated: "Open spreadsheet to check results",
    exportFailed:
      "Analytics 2 could not export this panel. Check its data source and Google Sheets connection, then try again.",
    writeFailed:
      "The spreadsheet was created, but Google Sheets did not confirm that all results were written.",
    scopeRequired:
      "This Google Sheets connection needs file-level access. Reconnect it before exporting.",
    scopeRequiredAfterCreate:
      "The spreadsheet was created, but this Google Sheets connection needs file-level access to write results. Reconnect it and try again.",
    authRequired:
      "The Google Sheets authorization is invalid or expired. Reconnect the account, then try again.",
    authRequiredAfterCreate:
      "The spreadsheet was created, but Google Sheets could not authorize the result write. Reconnect the account and check the spreadsheet.",
    filePermissionRequired:
      "Google Sheets reports that this account does not have write access to the spreadsheet. Check its Drive permissions.",
    filePermissionAfterCreate:
      "The spreadsheet was created, but Google Sheets reports that this account cannot write to it. Check Drive permissions and inspect the spreadsheet.",
    quotaExceeded:
      "Google Sheets rejected the export because a usage or storage limit was reached. Review the account's limits before trying again.",
    quotaExceededAfterCreate:
      "The spreadsheet was created, but a Google Sheets usage or storage limit prevented writing the result. Check the spreadsheet and review the account's limits.",
    providerForbidden:
      "Google Sheets blocked the export because of a permission or workspace policy. Review the connection or contact your administrator.",
    providerForbiddenAfterCreate:
      "The spreadsheet was created, but Google Sheets blocked the result write because of a permission or workspace policy. Check the spreadsheet or contact your administrator.",
    connectionRequired:
      "This Google Sheets connection is no longer available. Choose another connection or reconnect it.",
    writeConnectionRequired:
      "The spreadsheet was created, but the selected Google Sheets connection is no longer available.",
    budgetExhausted:
      "The panel result exceeds the export row limit. Narrow its filters and try again.",
    resultNotExportable:
      "The current panel result could not be verified against its visualization. No spreadsheet was created.",
    resultTooLarge:
      "This complete panel result is too large for one spreadsheet update. Narrow its filters and try again.",
    sourceChanged:
      "The staged data changed while the panel was running. Try the export again.",
    dashboardChanged: "The dashboard changed. Reload it before exporting.",
    apiFailed:
      "Google Sheets could not confirm whether it created this spreadsheet. Check Drive before retrying to avoid creating a duplicate.",
  },
} as const;
