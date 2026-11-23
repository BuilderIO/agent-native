export const contextMessages = {
  context: {
    rail: {
      label: "Context sections",
      setupGroup: "Setup",
      setupItem: "Set up context",
      endorseGroup: "Endorse",
      endorseItem: "Endorsed models",
      connectionsItem: "Connections",
      referenceGroup: "Reference",
      referenceItem: "Semantic models",
      managementGroup: "Management",
      managementEndorseItem: "Endorsements",
      managementModelsItem: "Semantic models",
      relatedGroup: "Related settings",
      relatedSourcesItem: "Data sources",
      relatedOrganizationItem: "Organization",
      relatedAgentsItem: "AI & agents",
      relatedIntegrationsItem: "Integrations",
      relatedSettingsItem: "Settings",
      governGroup: "Govern",
      governItem: "Workspace settings",
    },
    setup: {
      title: "Context setup",
      heading: "Building context",
      intro:
        "The Agent learns from your data, and structuring context in your workspace can help it answer questions the way your business expects.",
      dismiss: "Dismiss this page",
      helpHint: "You can always review these steps again in the Help menu.",
      apps: {
        title: "Apps",
        description: "Use MCP servers to connect to external apps.",
      },
      checklist: "Setup steps",
      status: {
        complete: "Done",
        upcoming: "Not started",
      },
      sections: {
        connect: {
          rest: "the Agent to your data",
          description:
            "Every workspace needs at least one data connection, but most have a couple. The Agent will automatically select the most relevant available data connection for a user's request.",
        },
        endorse: {
          rest: "your data to set agent boundaries",
          description:
            "Endorsements are the Agent's primary way of understanding what data to use. By endorsing your most trusted tables, columns, and dashboards, you can ensure the agent is using the best data to answer questions.",
        },
        improve: {
          rest: "accuracy with guides",
          description:
            "The easiest way to add important business knowledge to your workspace is with guides. The Agent will read guides to learn about your company, objectives, data structures and more.",
        },
        reference: {
          rest: "repos to ground the agent in your code",
          description:
            "Reference repositories let the Agent read from your existing code. Connecting a repository can give the agent access to models or source code as a source of truth.",
        },
        extend: {
          rest: "the agent with MCP connections",
          description:
            "MCP connections let the Agent reach external tools and data. The agent can use MCP connections to run searches, access external databases, or even trigger actions in other tools.",
        },
        govern: {
          rest: "with semantic models",
          description:
            "Semantic models are the most rigorous governance tool available for the Agent. Semantic models can deterministically produce the same SQL queries in response to user questions.",
        },
      },
      tasks: {
        chooseDefaultConnection: {
          title: "Choose a default data connection",
          addConnection: "Add a data connection",
          description:
            "The default data connection is the one accessed by the agent first. There can only be one default data connection in a workspace.",
        },
        documentData: {
          title: "Document your data",
          editDescriptions: "Edit descriptions in {{brand}}",
          description:
            "The Agent reads table and column descriptions when choosing data. Descriptions are synced automatically from your database, and you can also add descriptions directly in the app.",
        },
        endorseAssets: {
          title: "Endorse at least 10 assets",
          addEndorsements: "Add endorsements",
          description:
            'To get started testing the app for your non technical business users, endorse your 10 most well trusted, or your well modeled schemas (eg. "Gold" level schemas) and any important dashboards you might have built.',
        },
        installSkill: {
          title: "Install the context consultant skill",
          description:
            "Use the context consultant skill with your coding agent to bootstrap guides and keep context up to date from Suggestions.",
        },
        workspaceGuide: {
          title: "Create a workspace guide",
          description:
            "Write guides like you would for a new analyst, like what tables to use, how to query them, and what questions it can and can't answer. Start with a single guide for your most important table or dashboard.",
        },
        referenceRepo: {
          title: "Connect a reference repo",
          description:
            "Link repositories that help the Agent understand the source of your data. This could be a dbt repository that contains your data models, or source code for your applications.",
        },
        mcpServer: {
          title: "Connect an MCP server",
          connectServer: "Connect an MCP server",
          description:
            "Enable MCP for popular services like Notion or Linear, or configure a custom connection.",
        },
        semanticModel: {
          title: "Create or import a semantic model",
          createModels: "Create models",
          description:
            "You can use the Agent to help develop a semantic model, or import existing semantic models from dbt MetricFlow, Cube, or Snowflake Semantic Views.",
        },
        optional: "(optional)",
      },
      steps: {
        connect: {
          title: "Link a data source",
          description: "Point Agent at the warehouse that holds your tables.",
          action: "Open sources",
          tasks: {
            defaultConnection: "Choose a default data connection",
            document: "Document your data (optional)",
          },
        },
        defaultConnection: {
          title: "Pick the default connection",
          description: "New SQL cells open against this connection.",
          placeholder: "Select a connection",
          clear: "Clear default",
          saved: "Default connection saved.",
          cleared: "Default connection cleared.",
          failed: "Could not save the default connection.",
        },
        endorse: {
          title: "Endorse the trusted models",
          description: "Flag the models Agent should reach for first.",
          action: "Review endorsements",
          tasks: {
            endorseAssets: "Endorse at least 10 assets",
          },
        },
        extend: {
          title: "Extend the agent with MCP connections",
          description:
            "Connect workspace tools that Agent can use in its work.",
          action: "Manage connections",
          tasks: {
            connectServer: "Connect an MCP server",
          },
        },
        govern: {
          title: "Govern with semantic models",
          description:
            "Define the semantic models Agent should use when it answers.",
          action: "Open semantic models",
          tasks: {
            semanticModel: "Create or import a semantic model",
          },
        },
      },
      noneEligible:
        "No workspace connection is ready to become the default yet.",
      loading: "Loading setup steps…",
      loadError: "Could not load setup steps.",
      retry: "Retry",
    },
    endorse: {
      title: "Endorsed models",
      intro:
        "Endorsed models are the ones Agent prefers when it plans a query.",
      empty: "No semantic models have been defined yet.",
      loading: "Loading semantic models…",
      loadError: "Could not load semantic models.",
      retry: "Retry",
      endorsedState: "Endorsed",
      notEndorsedState: "Not endorsed",
      endorseAction: "Endorse",
      removeAction: "Remove endorsement",
      saved: "Model endorsed.",
      removed: "Endorsement removed.",
      failed: "Could not update the endorsement.",
      readOnlyNote: "Only workspace admins and owners can change endorsements.",
    },
    reference: {
      title: "Semantic models",
    },
    connections: {
      title: "Connections",
      description:
        "Agent integrations for this workspace and for you. Add an MCP server to let the agent reach an external tool.",
    },
  },
};
