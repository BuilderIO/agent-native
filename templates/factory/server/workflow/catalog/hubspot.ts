import type { OperationDefinitionInput } from "../operations.js";

export const hubspotOperations: OperationDefinitionInput[] = [
  {
    // A "lead" is a contact in the Lead lifecycle stage. The cursor is the
    // highest contact id seen: ids only grow, which avoids date-format
    // differences. The first run asks newest first and primes on index 0;
    // every run after it asks oldest first, so a page cut at the limit
    // continues from its last row instead of stranding the older ones.
    id: "hubspot.newLeads",
    provider: "hubspot",
    label: "HubSpot: new leads",
    nodeKinds: ["source"],
    effect: "read",
    readsViaPost: true,
    fields: [],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/crm/v3/objects/contacts/search",
      bodyTemplate: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "hs_object_id",
                operator: "GT",
                value: "{since}",
              },
              { propertyName: "lifecyclestage", operator: "EQ", value: "lead" },
            ],
          },
        ],
        sorts: [{ propertyName: "hs_object_id", direction: "{sortDirection}" }],
        properties: [
          "email",
          "firstname",
          "lastname",
          "company",
          "hubspot_owner_id",
          "lifecyclestage",
        ],
        limit: 100,
      },
    },
    cursor: {
      param: "since",
      path: "results[0].id",
      origin: "0",
      forward: {
        itemPath: "id",
        sortParam: "sortDirection",
        newestFirst: "DESCENDING",
        oldestFirst: "ASCENDING",
      },
    },
    itemMapping: {
      kind: "lead",
      itemsPath: "results",
      fields: {
        title: [
          "properties.email",
          "{properties.firstname} {properties.lastname}",
          "properties.company",
          "Lead {id}",
        ],
        occurredAt: "createdAt",
        "extras.ownerId": "properties.hubspot_owner_id",
        "extras.company": "properties.company",
      },
      dedupeKey: "id",
    },
    credential: { provider: "hubspot" },
  },
  {
    id: "hubspot.companyActivity",
    provider: "hubspot",
    label: "HubSpot: a lead's company and recent activity",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [{ name: "leadId", type: "string", required: true, label: "Lead" }],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/crm/v3/objects/contacts/{leadId}",
      query: {
        properties:
          "email,firstname,lastname,company,jobtitle,industry,numemployees,annualrevenue,lifecyclestage,hubspot_owner_id,hs_analytics_source,hs_analytics_num_page_views,hs_analytics_last_visit_timestamp,recent_conversion_event_name,num_notes,notes_last_updated",
        associations: "companies",
      },
    },
    credential: { provider: "hubspot" },
  },
  {
    id: "hubspot.ownerById",
    provider: "hubspot",
    label: "HubSpot: find an owner",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      { name: "ownerId", type: "string", required: true, label: "Owner" },
    ],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/crm/v3/owners/{ownerId}",
    },
    credential: { provider: "hubspot" },
  },
  {
    // A request cannot turn "today" into a timestamp or pick the default
    // owner, so the host action resolves both before it calls HubSpot.
    id: "hubspot.createTask",
    provider: "hubspot",
    label: "HubSpot: create a task",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      { name: "title", type: "string", required: true, label: "Task" },
      { name: "ownerId", type: "string", target: true, label: "Owner" },
      { name: "contactId", type: "string", target: true, label: "Contact" },
      {
        name: "due",
        type: "enum",
        enum: ["today", "tomorrow", "nextWeek"],
        default: "today",
        label: "Due",
      },
      { name: "body", type: "text", label: "Notes" },
    ],
    implementation: {
      type: "action",
      action: "create-hubspot-task",
      argMap: {
        title: "title",
        ownerId: "ownerId",
        contactId: "contactId",
        due: "due",
        body: "body",
      },
    },
    receipt: { externalRef: "id" },
    credential: { provider: "hubspot" },
  },
  {
    id: "hubspot.addToList",
    provider: "hubspot",
    label: "HubSpot: add a contact to a list",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "listId",
        type: "string",
        required: true,
        target: true,
        label: "List",
      },
      {
        name: "leadId",
        type: "string",
        required: true,
        target: true,
        label: "Contact",
      },
    ],
    implementation: {
      type: "provider-request",
      method: "PUT",
      pathTemplate: "/crm/v3/lists/{listId}/memberships/add",
      bodyTemplate: ["{leadId}"],
    },
    receipt: { externalRef: "recordsIdsAdded[0]" },
    credential: { provider: "hubspot" },
  },
];
