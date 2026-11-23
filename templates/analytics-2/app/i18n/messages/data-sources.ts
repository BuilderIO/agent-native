export const dataSourceMessages = {
  sources: {
    searchConnections: "Search connections",
    noMatchingConnections: "No connections match your search.",
    agentDiscovery: {
      label: "Include in AI discovery",
      updated: "AI discovery preference saved.",
      updateFailed: "Could not update AI discovery preference.",
    },
    defaultConnection: {
      marker: "Workspace default",
      set: "Set as default",
      clear: "Clear default",
      updated: "Default data connection saved.",
      cleared: "Default data connection cleared.",
      updateFailed: "Could not update the default data connection.",
    },
    row: {
      actions: "Connection actions",
      // The default-connection row's own Edit control (source: the connection
      // row menu opens the same edit dialog).
      edit: "Edit",
      query: "Query with this connection",
      queryPrompt:
        "Using the {{connection}} {{provider}} connection, answer this question: ",
      refreshStatus: "Refresh status",
      refreshing: "Refreshing status",
      refreshDisabled:
        "Refresh is unavailable while the connection is not ready",
      refreshed: "Connection status refreshed.",
      refreshFailed: "Could not refresh connection status.",
      copyId: "Copy connection ID",
      idCopied: "Connection ID copied.",
      idCopyFailed: "Could not copy the connection ID.",
      manage: "Manage in integrations",
    },
    // The organization dbt edit dialog (source: the connection edit path opens
    // the same dbt section the create form shows under Advanced > Integrations).
    editConnection: {
      title: "Edit connection",
      // The source names this control "Update connection" when it edits an
      // existing connection (AddDataConnection.tsx:2027).
      update: "Update connection",
      cancel: "Cancel",
    },
    schemaRefresh: {
      pending: "Schema refresh in progress.",
      savedRefreshFailed:
        "Connection saved, but its schema could not be refreshed. Try refreshing it from Data.",
      savedReadFailed:
        "Connection saved, but the updated data could not be loaded. Try refreshing the page.",
      failed:
        "The last schema refresh failed, so data may be out-of-date. Try refreshing again.",
      unreadable: "The schema refresh state could not be read.",
      unverified: "The schema for {{table}} could not be verified.",
      validEmpty: "{{table}} was read and has no columns.",
      complete: "Schema read for {{count}} tables.",
    },
    errorIndicator: {
      label: "Connection problems",
      notConfigured: "This connection is not ready to query.",
    },
    reauth: {
      title: "Authentication required",
      bodyOwner:
        "Your {{provider}} authorization for {{connection}} has expired or was rejected. Reconnect it to keep querying.",
      bodyViewer:
        "The {{provider}} authorization for {{connection}} has expired or was rejected. Ask a workspace admin to reconnect it.",
      action: "Reconnect {{provider}}",
    },
    workspaceSettings: {
      // Source labels: the Settings page is "Data sources" and the connections
      // section inside it is "Data connections"
      // (settingsCommandPaletteEntries.ts:118-121, OrgDataConnectionsPanel.tsx).
      label: "Data sources",
      groupTitle: "Data connections",
      loading: "Loading workspace connections",
      loadError: "Could not load workspace connections.",
      empty: "No workspace data connections are configured.",
      scope: "Workspace",
      sshKeyTitle: "Workspace SSH key",
      sshKeyDescription:
        "Use this public SSH key to authenticate tunneled database connections from this workspace.",
      sshKeyShow: "Show SSH key",
      sshKeyHide: "Hide SSH key",
      sshKeyCopy: "Copy SSH key",
      sshKeyCopied: "Key copied to clipboard.",
      sshKeyCopyError:
        "An error occurred copying the public ssh key. Please try again.",
      sshKeyLoading: "Loading workspace SSH key...",
      sshKeyLoadError: "Could not load workspace SSH key.",
      sshKeyRetry: "Retry",
    },
    addConnection: {
      // The add-a-data-connection dialog's own copy. Title, subtitle and the
      // footer's structure follow the source's dialog; the footer's support
      // address and product name are ours (copy-rewrites.json).
      title: "Add a data connection",
      subtitle: "The following connection templates are currently supported.",
      unsupported:
        "{{name}} connections are not available in this build yet. Nothing was created or changed.",
      tileHint: "Add a {{name}} connection",
      back: "Back to connection types",
      close: "Close dialog",
      action: "Add connection",
      provider: "Add a {{provider}} connection",
      footerBefore: "Have questions? Read our",
      footerSecurity: "security page",
      footerMiddle: "and",
      footerDocumentation: "documentation",
      optional: "Optional",
      basic: "Basic",
      advanced: "Advanced",
      access: "Access",
      schemaBrowsing: "Schema browsing",
      name: "Name",
      description: "Description",
      learnMore: "Learn more.",
      adminOnly: "Only workspace admins can view or edit this configuration.",
      select: "Select",
      saveDraft: "Save draft",
      create: "Create connection",
      creating: "Creating…",
      test: {
        button: "Test connection",
        pending: "Testing BigQuery access…",
        verified: "BigQuery dataset access verified.",
        missingProject: "Enter the BigQuery project ID first.",
        invalidInput: "Check the project ID and service account JSON.",
        datasetInvalid:
          "Enter a comma-separated list of distinct dataset names.",
        datasetUnverified:
          "Dataset {{dataset}} could not be verified. Check its name and access.",
        credentialRejected:
          "Google rejected the service account key. Check that it is valid and active.",
        accessDenied:
          "BigQuery denied access to the project’s datasets. Check the service account’s permissions.",
        projectMissing:
          "BigQuery could not find the project. Check the project ID and the service account’s access.",
        rateLimited:
          "BigQuery reported a quota or rate limit. Try again later.",
        timedOut: "The BigQuery connection test timed out. Try again.",
        sessionUnavailable: "Sign in to a workspace to test the connection.",
        scopeChanged:
          "The workspace session could not be confirmed. Reopen the form and try again.",
        forbidden:
          "Open the form as a signed-in workspace admin to test the connection.",
        unavailable: "BigQuery access could not be verified. Try again.",
      },
      warehouse: {
        databaseGroup: "Database",
        authentication: "Authentication",
        host: "Host",
        port: "Port",
        database: "Database",
        username: "Username",
        password: "Password",
        awsGroup: "AWS",
        region: "Region",
        outputLocation: "S3 output location",
        workgroup: "Workgroup",
        catalog: "Data catalog",
        accessKeyId: "Access key ID",
        secretAccessKey: "Secret access key",
        invalidPort: "Enter a port from 1 to 65535.",
      },
      postgres: {
        name: "Postgres",
        databaseGroup: "Database",
        hostAndPort: "Host & port",
        port: "Port",
        authentication: "Authentication",
        type: "Type",
        username: "Username",
        password: "Password",
        caCertificate: "SSL CA certificate",
        caCertificateSaved: "Leave blank to keep the saved certificate.",
        invalidPort: "Enter a port from 1 to 65535.",
        testPending: "Testing connection…",
        testVerified: "PostgreSQL connection verified.",
        creating: "Creating connection…",
        updating: "Updating connection…",
        endpointDenied: "The PostgreSQL host or port is not allowed.",
        tlsUnverified:
          "The PostgreSQL server certificate could not be verified.",
        credentialsDenied: "PostgreSQL rejected the username or password.",
        passwordRequired:
          "Re-enter the password when changing connection details.",
        readOnlyRequired: "Connect with a read-only PostgreSQL user.",
        timedOut: "The PostgreSQL connection test timed out. Try again.",
        unavailable: "PostgreSQL access could not be verified. Try again.",
      },
      bigquery: {
        additionalResources: "Additional resources",
        setupGuide: "BigQuery setup guide",
        trustPage: "Trust page",
        projectId: "Project ID",
        additionalProjectIds: "Additional Project IDs",
        commaSeparated: "COMMA SEPARATED",
        driveAccess: "Enable Google Drive Access",
        storageApi: "Use BigQuery Storage API",
        storageApiHelp: "Speeds up large queries.",
        serviceAccount: "Service account configuration (JSON)",
        serviceAccountHelp:
          "Paste the whole key file or attach it. The key is stored encrypted and never shown again.",
        chooseKey: "Attach key file",
        customSqlFormatting: "Custom SQL formatting",
        includeSchemaForAi: "Include schema data for AI",
        version: "Version",
        select: "Select",
        created: "BigQuery connection created.",
        failed:
          "The BigQuery connection was not created. The message above names the field to fix.",
        configured: "The workspace already has BigQuery credentials on file.",

        // The dbt metadata block's own labels. Without these the section renders
        // the key names, which is what the connection form showed.
        integrations: "INTEGRATIONS",
        dbt: "dbt",
        // The edit dialog reports these when the dbt section cannot be read or
        // the save did not come back confirmed.
        dbtLoadError:
          "The saved dbt settings could not be loaded, so this form cannot save yet.",
        saveNotConfirmed:
          "The change was sent but could not be confirmed. Reopen this connection to check it.",
        accessUrl: "Access URL",
        accountId: "Account ID",
        environmentId: "Environment ID",
        environmentIdOptional: "Environment ID (optional)",
        serviceToken: "Service token",
        versionCurrent: "1.6+",
        versionLegacy: "1.5 and below",
      },
    },
    connectionStatus: {
      connected: "Connected",
      configured: "Connection configured",
      unknown: "Unknown",
    },
    scope: {
      personal: "Personal connection",
      org: "Organization connection",
      unknown: "Scope unknown",
    },
    workspaceAccess: {
      granted: "Workspace access granted",
      notGranted: "Workspace access not granted",
    },
    bigqueryWorkspaceSource: {
      ready: "Workspace source ready",
      needsSetup: "Workspace source needs setup",
      noConnections: "No workspace connection is available to Analytics 2.",
    },
    organizationBigQuery: {
      status: {
        missing: "Organization credentials not configured",
        partial: "Organization credential setup incomplete",
        configured: "Organization credentials configured",
        unavailable: "Organization credential status unavailable",
      },
      queryAvailability: "Available for bounded org-scoped queries",
      liveQueryNotChecked: "Live query not checked",
      check: "Check connection",
      checking: "Checking connection…",
      checkPassed:
        "The connection answered a test query and read the project's datasets.",
      checkFailed:
        "The connection check did not pass. The message above names what to fix.",
      setup: {
        configure: "Configure BigQuery",
        change: "Change BigQuery credentials",
        title: "Workspace BigQuery connection",
        description:
          "Every member queries through this one service account. Its BigQuery roles decide what they can read, so grant the narrowest role that answers their questions.",
        projectIdLabel: "Project ID",
        projectIdPlaceholder: "my-data-project",
        projectIdHelp:
          "The Google Cloud project ID shown in the project picker, not the project name.",
        keyLabel: "Service account key (JSON)",
        keyHelp:
          "Paste the whole key file, or choose it here. The key is stored encrypted and never shown again.",
        chooseKey: "Choose key file",
        save: "Save connection",
        saving: "Saving…",
        saved: "Workspace BigQuery credentials saved.",
        remove: "Remove connection",
        removing: "Removing…",
        removed: "Workspace BigQuery credentials removed.",
        cancel: "Cancel",
        configuredFor: "Connected to project",
        failed:
          "The BigQuery credentials were not saved. The message above names the field to fix.",
      },
    },
    queryable: "Query access configured",
    notQueryable: "Query access unavailable",
    gongCredentials: {
      status: {
        missing: "Credentials not configured",
        partial: "Credential setup incomplete",
        configured: "Credentials saved",
        unavailable: "Credential status unavailable",
      },
      setup: "Set up credentials",
      manage: "Manage credentials",
      adminRequired: "Ask an organization admin to set these up",
    },
    access: {
      otherConnections: "Other workspace connections",
      request: "Request access",
      requestAgain: "Request access again",
      requesting: "Requesting…",
      pending: "Request pending",
      approvedStatus: "Access approved",
      declinedStatus: "Request declined",
      retryNotice: "Retry notice",
      requestSaved: "Access request saved.",
      adminNoticesIncomplete:
        "Your request is saved, but not every workspace admin received a notice.",
      requestFailed: "Could not request access.",
      loadAccessFailed: "Could not load workspace access status.",
      requestUnavailable:
        "In-app access requests are unavailable. Manage permissions in workspace settings.",
      requests: "Access requests",
      requestScope:
        "Granting access makes this connection available to this app for everyone allowed to use the connection.",
      noRequests: "No pending access requests.",
      requestedBy: "Requested by",
      approve: "Grant access",
      decline: "Decline",
      reviewing: "Saving…",
      approved: "Access approved.",
      declined: "Access declined.",
      requesterNoticeFailed:
        "The access decision was saved, but the requester did not receive an inbox notice.",
      requesterNoticeUnconfirmed:
        "The access decision was saved, but inbox delivery to the requester could not be confirmed. Check with them before retrying.",
      reviewFailed: "Could not review this request.",
      loadRequestsFailed: "Could not load access requests.",
    },
    csv: {
      stagedDatasets: "Staged datasets",
      importFiles: "Import CSV or XLSX",
      importing: "Importing…",
      chooseFile: "Choose a CSV or XLSX file to import",
      limits:
        "256 KiB max · 5,000 rows · 100 columns · 100,000 cells · XLSX reads the first sheet; missing or error formula results are blank, so recalculate before upload · expires after 14 days",
      imported: "File imported as a complete staged dataset.",
      importedEmpty:
        "The file has no data rows; an empty staged dataset was created.",
      importedPartial:
        "The staged dataset is marked incomplete: {{rowCount}} rows are staged; {{expectedRowCount}} were parsed from the file.",
      rows: "rows",
      columns: "columns",
      dropzone: {
        idle: "Drop a CSV or XLSX file here",
        active: "Drop to import",
      },
      row: {
        imported: "Imported {{date}}",
        preview: "Preview rows",
        previewFailed: "Could not load a preview of this dataset.",
        previewEmpty: "This dataset has no rows.",
        previewTruncated: "Showing the first {{shown}} of {{total}} rows.",
        previewAll: "Showing all {{shown}} rows.",
        query: "Ask the agent about this dataset",
        queryPrompt:
          "Query the staged dataset {{name}} (id {{id}}) and answer this question: ",
        delete: "Delete dataset",
        deleteTitle: "Delete staged dataset?",
        deleteBody:
          "{{name}} and its staged rows will be removed. Dashboards or analyses that depend on it will stop working.",
        deleteCancel: "Cancel",
        deleteConfirm: "Delete",
        deleting: "Deleting…",
        deleted: "Staged dataset deleted.",
        deleteUnconfirmed:
          "The delete could not be confirmed. Reload to check.",
        deleteFailed: "Could not delete the staged dataset.",
      },
      complete: "Source complete",
      incomplete: "Incomplete",
      completenessUnknown: "Completeness unknown",
      noDatasets: "No staged datasets are available.",
      loadFailed: "Could not load staged datasets.",
      unscopedNotice:
        "Some older staged datasets are hidden because their workspace scope cannot be verified. Restage that data to use it.",
      errors: {
        fileType: "Choose a .csv or .xlsx file.",
        tooLarge: "CSV and XLSX files must be 256 KiB or smaller.",
        invalidUtf8: "The CSV file is not valid UTF-8 text.",
        empty: "Choose a CSV or XLSX file with a header row.",
        invalidFormat:
          "The uploaded file has invalid quoting or row formatting.",
        headerRequired: "The first row must contain column names.",
        headerTooLong: "A column name exceeds 120 characters.",
        invalidRow: "A data row has more fields than its header.",
        tooManyRows: "The file exceeds the 5,000-row import limit.",
        tooManyColumns: "The file exceeds the 100-column import limit.",
        tooManyCells: "The file exceeds the 100,000-cell import limit.",
        cellTooLarge: "A cell exceeds the 16,384-character limit.",
        workspaceRequired: "Sign in to a workspace before importing a file.",
        stageFailed:
          "The file was parsed but could not be staged. Retry the import or remove an older staged dataset to free space.",
        stageMismatch:
          "The staged dataset did not match the uploaded file. Retry the import.",
        xlsxInvalid:
          "Could not read this XLSX file. Check that it is a valid workbook, then try again.",
        importResultUnconfirmed:
          "Analytics could not confirm whether the file import completed. Check staged datasets before retrying.",
        failed: "Could not import this file.",
      },
    },
    health: {
      label: "Live query status",
      status: {
        untested: "Not checked",
        verified: "Query succeeded",
        error: "Error",
        timeout: "Timed out",
        quota_cooldown: "Quota limited",
        unknown: "Unknown",
      },
      lastChecked: "Last checked",
      notChecked: "Not checked",
      lastSuccessfulCheck: "Last successful check",
      noneSuccessful: "None recorded",
      accessRequired:
        "Request access to let Analytics 2 check this connection.",
      lastError: "Last error",
      errors: {
        timeout: "The provider did not respond before the check timed out.",
        quota: "The provider's rate limit was reached.",
        authorization: "The connection needs renewed authorization.",
        permission:
          "The connected account does not have permission to read this source.",
        provider: "The provider returned an error on the latest check.",
        query:
          "BigQuery rejected the latest query. Review its SQL and semantic model, then retry.",
        response_too_large:
          "The BigQuery response exceeded Analytics 2's safe read limit. Narrow the query and retry.",
        invalid_result:
          "BigQuery returned a result Analytics 2 could not read. Retry the query, then review the connection if it persists.",
        incomplete_result:
          "BigQuery did not return a complete result. Narrow the query or retry.",
        unknown: "The latest check failed for an unrecognized reason.",
      },
      unavailable: "Unavailable",
      reviewConnection: "Review connection",
      quotaNextStep: "Wait for the provider limit to reset, then retry.",
    },
  },
} as const;
