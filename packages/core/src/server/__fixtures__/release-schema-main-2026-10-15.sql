CREATE SEQUENCE IF NOT EXISTS "app_resource_change_seq";

CREATE SEQUENCE IF NOT EXISTS "automation_trigger_event_queue_sequence_id_seq";

CREATE TABLE "_agent_harness_session_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_agent_harness_session_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_agent_run_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_agent_run_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_agent_tool_approval_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_agent_tool_approval_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_automation_run_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_automation_run_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_automation_scheduler_health_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_automation_scheduler_health_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_automation_trigger_event_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_automation_trigger_event_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_better_auth_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_better_auth_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_chat_thread_schema_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_chat_thread_schema_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_collab_awareness" (
  "doc_id" text NOT NULL,
  "client_id" bigint NOT NULL,
  "state" text NOT NULL,
  "last_seen" bigint NOT NULL
);

CREATE TABLE "_collab_docs" (
  "doc_id" text NOT NULL,
  "yjs_state" text NOT NULL,
  "text_snapshot" text DEFAULT ''::text NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "updated_at" text DEFAULT (now())::text NOT NULL
);

CREATE TABLE "_context_xray_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_context_xray_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_identity_sso_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_identity_sso_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_oauth_token_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_oauth_token_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_observability_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_observability_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_observational_memory_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_observational_memory_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_org_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_org_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_remote_device_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_remote_device_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_usage_alert_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_usage_alert_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "_workspace_connections_migrations" (
  "version" bigint NOT NULL
);

CREATE TABLE "_workspace_connections_migrations_named" (
  "name" text NOT NULL,
  "version" bigint,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "a2a_approvals" (
  "id" text NOT NULL,
  "task_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "tool_name" text NOT NULL,
  "tool_input" text NOT NULL,
  "approval_key" text NOT NULL,
  "call_id" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "result" text,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "a2a_tasks" (
  "id" text NOT NULL,
  "context_id" text,
  "status_state" text DEFAULT 'submitted'::text NOT NULL,
  "status_message" text,
  "status_timestamp" text NOT NULL,
  "history" text DEFAULT '[]'::text NOT NULL,
  "artifacts" text DEFAULT '[]'::text NOT NULL,
  "metadata" text,
  "owner_email" text,
  "owner_scope" text DEFAULT ''::text NOT NULL,
  "idempotency_key" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "account" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "agent_audit_log" (
  "id" text NOT NULL,
  "created_at" bigint NOT NULL,
  "action" text NOT NULL,
  "caller" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_email" text,
  "org_id" text,
  "thread_id" text,
  "turn_id" text,
  "target_type" text,
  "target_id" text,
  "status" text DEFAULT 'success'::text NOT NULL,
  "summary" text,
  "input" text,
  "error_code" text,
  "owner_email" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "run_id" text,
  "task_id" text,
  "parent_task_id" text,
  "source_kind" text,
  "source_platform" text,
  "source_id" text,
  "source_url" text,
  "network_protocol" text,
  "network_id" text,
  "network_peer" text,
  "app" text
);

CREATE TABLE "agent_checkpoints" (
  "id" text NOT NULL,
  "thread_id" text NOT NULL,
  "run_id" text,
  "commit_sha" text NOT NULL,
  "message" text DEFAULT ''::text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE TABLE "agent_eval_datasets" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "entries" text DEFAULT '[]'::text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "user_id" text,
  "idempotency_key" text
);

CREATE TABLE "agent_evals" (
  "id" text NOT NULL,
  "run_id" text NOT NULL,
  "thread_id" text,
  "user_id" text,
  "eval_type" text NOT NULL,
  "criteria" text NOT NULL,
  "score" real DEFAULT 0 NOT NULL,
  "reasoning" text,
  "metadata" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "agent_experiment_assignments" (
  "experiment_id" text NOT NULL,
  "user_id" text NOT NULL,
  "variant_id" text NOT NULL,
  "assigned_at" bigint NOT NULL
);

CREATE TABLE "agent_experiment_results" (
  "id" text NOT NULL,
  "experiment_id" text NOT NULL,
  "variant_id" text NOT NULL,
  "metric" text NOT NULL,
  "value" real DEFAULT 0 NOT NULL,
  "sample_size" bigint DEFAULT 0 NOT NULL,
  "confidence_low" real DEFAULT 0 NOT NULL,
  "confidence_high" real DEFAULT 0 NOT NULL,
  "computed_at" bigint NOT NULL
);

CREATE TABLE "agent_experiments" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "variants" text DEFAULT '[]'::text NOT NULL,
  "metrics" text DEFAULT '[]'::text NOT NULL,
  "assignment_level" text DEFAULT 'user'::text NOT NULL,
  "started_at" bigint,
  "ended_at" bigint,
  "created_at" bigint NOT NULL,
  "owner_email" text
);

CREATE TABLE "agent_feedback" (
  "id" text NOT NULL,
  "run_id" text,
  "thread_id" text,
  "message_seq" bigint,
  "feedback_type" text NOT NULL,
  "value" text DEFAULT ''::text NOT NULL,
  "idempotency_key" text,
  "user_id" text,
  "org_id" text,
  "source" text DEFAULT 'chat'::text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE TABLE "agent_harness_sessions" (
  "id" text NOT NULL,
  "harness_name" text NOT NULL,
  "thread_id" text NOT NULL,
  "run_id" text,
  "provider_session_id" text,
  "status" text DEFAULT 'idle'::text NOT NULL,
  "resume_state" text,
  "workspace_ref" text,
  "pending_approval" text,
  "resolved_approval_ids" text,
  "owner_email" text,
  "org_id" text,
  "generation" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "stopped_at" bigint
);

CREATE TABLE "agent_human_review_summaries" (
  "run_id" text NOT NULL,
  "org_id" text NOT NULL,
  "ask" text NOT NULL,
  "outcome" text NOT NULL,
  "artifacts" text DEFAULT '[]'::text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "agent_instruction_updates" (
  "id" text NOT NULL,
  "run_id" text NOT NULL,
  "thread_id" text,
  "target" text NOT NULL,
  "instruction" text NOT NULL,
  "feedback" text DEFAULT ''::text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "user_id" text NOT NULL,
  "org_id" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "agent_native_browser_session_requests" (
  "owner_email" text NOT NULL,
  "session_id" text NOT NULL,
  "request_id" text NOT NULL,
  "type" text NOT NULL,
  "name" text,
  "command" text,
  "payload_json" text,
  "status" text NOT NULL,
  "created_at" bigint NOT NULL,
  "claimed_at" bigint,
  "completed_at" bigint,
  "expires_at" bigint NOT NULL,
  "result_json" text,
  "error" text
);

CREATE TABLE "agent_native_browser_sessions" (
  "owner_email" text NOT NULL,
  "session_id" text NOT NULL,
  "label" text,
  "url" text,
  "session_json" text NOT NULL,
  "context_json" text,
  "actions_json" text,
  "connected_at" bigint NOT NULL,
  "last_seen_at" bigint NOT NULL,
  "expires_at" bigint NOT NULL
);

CREATE TABLE "agent_native_embed_session_revocations" (
  "owner_hash" text NOT NULL,
  "revoked_before" bigint NOT NULL
);

CREATE TABLE "agent_native_embed_tickets" (
  "ticket_hash" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "target_path" text NOT NULL,
  "scope" text,
  "created_at" bigint NOT NULL,
  "expires_at" bigint NOT NULL,
  "consumed_at" bigint,
  "renewal_expires_at" bigint,
  "session_active_until" bigint
);

CREATE TABLE "agent_resource_versions" (
  "id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "version_number" bigint NOT NULL,
  "created_at" text NOT NULL,
  "created_by" text,
  "actor_kind" text DEFAULT 'human'::text NOT NULL,
  "owner_email" text,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "title" text,
  "summary" text,
  "snapshot_json" text NOT NULL,
  "metadata_json" text
);

CREATE TABLE "agent_review_comment_reactions" (
  "comment_id" text NOT NULL,
  "actor_email" text NOT NULL,
  "reaction" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "agent_review_comments" (
  "id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "thread_id" text NOT NULL,
  "parent_comment_id" text,
  "target_id" text,
  "kind" text DEFAULT 'comment'::text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "anchor_json" text,
  "body" text NOT NULL,
  "author_email" text,
  "author_name" text,
  "created_by" text DEFAULT 'human'::text NOT NULL,
  "resolution_target" text,
  "reply_route_target" text DEFAULT 'legacy'::text,
  "notification_completed_at" text,
  "mentions_json" text,
  "owner_email" text,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "resolved_by" text,
  "resolved_at" text,
  "consumed_at" text,
  "deleted_by" text,
  "deleted_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "metadata_json" text
);

CREATE TABLE "agent_review_notification_deliveries" (
  "comment_id" text NOT NULL,
  "recipient_email" text NOT NULL,
  "claim_token" text NOT NULL,
  "claimed_at" text NOT NULL,
  "sent_at" text
);

CREATE TABLE "agent_review_statuses" (
  "id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "status" text NOT NULL,
  "note" text,
  "updated_by" text,
  "updated_at" text NOT NULL,
  "owner_email" text,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "metadata_json" text
);

CREATE TABLE "agent_review_suggestion_amendments" (
  "idempotency_key" text NOT NULL,
  "suggestion_id" text NOT NULL,
  "revision" integer NOT NULL,
  "author_email" text NOT NULL,
  "owner_email" text,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "request_json" text NOT NULL,
  "before_json" text NOT NULL,
  "after_json" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "agent_review_suggestion_creations" (
  "idempotency_key" text NOT NULL,
  "suggestion_id" text NOT NULL,
  "author_email" text,
  "actor_kind" text,
  "request_hash" text,
  "created_at" text NOT NULL,
  "receipt_version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "agent_review_suggestion_decisions" (
  "id" text NOT NULL,
  "suggestion_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "reviewer" text,
  "decision" text NOT NULL,
  "observed_base" text,
  "outcome" text NOT NULL,
  "detail" text,
  "created_at" text NOT NULL
);

CREATE TABLE "agent_review_suggestion_operations" (
  "id" text NOT NULL,
  "suggestion_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "operation_kind" text NOT NULL,
  "target_id" text,
  "before_json" text,
  "after_json" text,
  "anchor_json" text,
  "dependencies_json" text,
  "schema_version" integer NOT NULL
);

CREATE TABLE "agent_review_suggestion_proposal_creations" (
  "idempotency_key" text NOT NULL,
  "proposal_id" text NOT NULL,
  "author_email" text,
  "actor_kind" text NOT NULL,
  "request_hash" text NOT NULL,
  "suggestion_ids_json" text NOT NULL
);

CREATE TABLE "agent_review_suggestion_proposal_decisions" (
  "idempotency_key" text NOT NULL,
  "proposal_id" text NOT NULL,
  "reviewer" text,
  "decision" text NOT NULL,
  "request_json" text NOT NULL,
  "suggestion_ids_json" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "agent_review_suggestion_proposals" (
  "id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "adapter_kind" text NOT NULL,
  "summary" text NOT NULL,
  "author_email" text,
  "actor_kind" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "agent_review_suggestions" (
  "id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "adapter_kind" text NOT NULL,
  "adapter_version" integer NOT NULL,
  "thread_id" text NOT NULL,
  "author_email" text,
  "actor_kind" text NOT NULL,
  "base_revision" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "summary" text NOT NULL,
  "owner_email" text,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "metadata_json" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "proposal_id" text
);

CREATE TABLE "agent_review_thread_preferences" (
  "thread_id" text NOT NULL,
  "user_email" text NOT NULL,
  "muted" integer DEFAULT 0 NOT NULL,
  "unread" integer DEFAULT 0 NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "agent_run_events" (
  "run_id" text NOT NULL,
  "seq" bigint NOT NULL,
  "event_at" bigint,
  "event_data" text NOT NULL
);

CREATE TABLE "agent_run_outcome_daily" (
  "day" text NOT NULL,
  "status" text NOT NULL,
  "terminal_reason" text DEFAULT ''::text NOT NULL,
  "run_count" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE "agent_runs" (
  "id" text NOT NULL,
  "thread_id" text NOT NULL,
  "status" text DEFAULT 'running'::text NOT NULL,
  "abort_reason" text,
  "started_at" bigint NOT NULL,
  "completed_at" bigint,
  "heartbeat_at" bigint,
  "last_progress_at" bigint,
  "turn_id" text,
  "error_code" text,
  "error_detail" text,
  "terminal_reason" text,
  "dispatch_mode" text,
  "diag_stage" text,
  "dispatch_payload" text,
  "peak_rss_mb" bigint,
  "continuation_order" bigint,
  "worker_stage" text,
  "in_flight_since" bigint,
  "auto_continue_of" text
);

CREATE TABLE "agent_satisfaction_scores" (
  "id" text NOT NULL,
  "thread_id" text NOT NULL,
  "user_id" text,
  "frustration_score" real DEFAULT 0 NOT NULL,
  "rephrasing_score" real DEFAULT 0 NOT NULL,
  "abandonment_score" real DEFAULT 0 NOT NULL,
  "sentiment_score" real DEFAULT 0 NOT NULL,
  "length_trend_score" real DEFAULT 0 NOT NULL,
  "computed_at" bigint NOT NULL
);

CREATE TABLE "agent_team_run_queue" (
  "task_id" text NOT NULL,
  "thread_id" text NOT NULL,
  "run_id" text NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "owner_email" text,
  "org_id" text,
  "payload" text NOT NULL,
  "continuation_count" bigint DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "reconciliation_attempted_at" bigint
);

CREATE TABLE "agent_tool_approval_policies" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "tool_name" text NOT NULL,
  "enabled" boolean NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "agent_tool_approvals" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "thread_id" text,
  "turn_id" text,
  "tool_name" text NOT NULL,
  "call_id" text NOT NULL,
  "approval_key_hash" text NOT NULL,
  "status" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "consumed_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "agent_tool_ledger" (
  "thread_id" text NOT NULL,
  "tool_key" text NOT NULL,
  "result_summary" text NOT NULL,
  "result_is_string" boolean,
  "artifacts_json" text,
  "chat_ui_result_json" text,
  "completed_at" bigint NOT NULL
);

CREATE TABLE "agent_trace_spans" (
  "id" text NOT NULL,
  "run_id" text NOT NULL,
  "thread_id" text,
  "user_id" text,
  "org_id" text,
  "parent_span_id" text,
  "span_type" text NOT NULL,
  "name" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_write_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_cents_x100" bigint DEFAULT 0 NOT NULL,
  "duration_ms" bigint DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'success'::text NOT NULL,
  "error_message" text,
  "metadata" text,
  "created_at" bigint NOT NULL,
  "ended_at" bigint
);

CREATE TABLE "agent_trace_summaries" (
  "run_id" text NOT NULL,
  "thread_id" text,
  "user_id" text,
  "org_id" text,
  "total_spans" bigint DEFAULT 0 NOT NULL,
  "llm_calls" bigint DEFAULT 0 NOT NULL,
  "tool_calls" bigint DEFAULT 0 NOT NULL,
  "successful_tools" bigint DEFAULT 0 NOT NULL,
  "failed_tools" bigint DEFAULT 0 NOT NULL,
  "total_duration_ms" bigint DEFAULT 0 NOT NULL,
  "total_cost_cents_x100" bigint DEFAULT 0 NOT NULL,
  "total_input_tokens" bigint DEFAULT 0 NOT NULL,
  "total_output_tokens" bigint DEFAULT 0 NOT NULL,
  "model" text DEFAULT ''::text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE TABLE "agent_turn_initiators" (
  "thread_id" text NOT NULL,
  "turn_id" text NOT NULL,
  "principal_email" text NOT NULL,
  "auth_user_id" text,
  "org_id" text,
  "org_scope" text,
  "is_anonymous" boolean DEFAULT false NOT NULL,
  "first_run_id" text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE TABLE "app_member_roles" (
  "id" text NOT NULL,
  "org_id" text NOT NULL,
  "app_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "app_permission_overrides" (
  "org_id" text NOT NULL,
  "app_id" text NOT NULL,
  "permission" text NOT NULL,
  "roles_json" text NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "app_resource_change_consumers" (
  "app" text NOT NULL,
  "resource_type" text NOT NULL,
  "consumer" text NOT NULL,
  "registered_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app_resource_changes" (
  "consumer" text NOT NULL,
  "app" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "reason" text NOT NULL,
  "seq" bigint NOT NULL,
  "changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "failed_at" timestamp with time zone
);

CREATE TABLE "app_secrets" (
  "id" text NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text NOT NULL,
  "key" text NOT NULL,
  "encrypted_value" text NOT NULL,
  "shared_encrypted_value" text,
  "description" text,
  "url_allowlist" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "application_state" (
  "session_id" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "automation_runs" (
  "id" text NOT NULL,
  "owner" text NOT NULL,
  "automation" text NOT NULL,
  "path" text NOT NULL,
  "scope" text,
  "org_id" text,
  "app_id" text,
  "run_id" text,
  "thread_id" text,
  "status" text DEFAULT 'running'::text NOT NULL,
  "started_at" bigint NOT NULL,
  "finished_at" bigint,
  "error" text,
  "error_code" text,
  "notification_email" text,
  "failure_alerted" bigint DEFAULT 0 NOT NULL,
  "failure_alert_state" text,
  "failure_alert_attempts" bigint DEFAULT 0 NOT NULL,
  "failure_alert_next_attempt_at" bigint,
  "failure_alert_claimed_at" bigint,
  "failure_alert_provider" text,
  "failure_alert_first_attempt_at" bigint,
  "failure_alert_unsubscribe_token" text,
  "claimed_at" bigint,
  "dispatch_pending" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE "automation_scheduler_health" (
  "id" text NOT NULL,
  "app_id" text DEFAULT 'default'::text NOT NULL,
  "org_id" text,
  "last_checked_at" bigint,
  "last_dispatched_at" bigint,
  "last_error" text,
  "runtime" text,
  "updated_at" bigint NOT NULL,
  "lease_owner" text,
  "lease_expires_at" bigint
);

CREATE TABLE "automation_trigger_event_queue" (
  "id" text NOT NULL,
  "sequence_id" bigint DEFAULT nextval('automation_trigger_event_queue_sequence_id_seq'::regclass) NOT NULL,
  "trigger_id" text NOT NULL,
  "trigger_owner" text NOT NULL,
  "trigger_path" text NOT NULL,
  "app_id" text,
  "event_name" text NOT NULL,
  "event_id" text NOT NULL,
  "payload" text NOT NULL,
  "event_owner" text,
  "emitted_at" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "failure_attempts" bigint DEFAULT 0 NOT NULL,
  "available_at" bigint NOT NULL,
  "claimed_at" bigint,
  "created_at" bigint NOT NULL,
  "completed_at" bigint,
  "last_error" text
);

CREATE TABLE "automation_trigger_event_queue_sweep_state" (
  "scope_key" text NOT NULL,
  "last_trigger_id" text,
  "purge_after" bigint DEFAULT 0 NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "automation_webhook_tokens" (
  "token_hash" text NOT NULL,
  "automation_id" text NOT NULL,
  "owner" text NOT NULL,
  "path" text NOT NULL,
  "secret_scope" text NOT NULL,
  "secret_scope_id" text NOT NULL,
  "secret_key" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "chat_thread_shares" (
  "id" text NOT NULL,
  "resource_id" text NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "role" text DEFAULT 'viewer'::text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "notified_at" text
);

CREATE TABLE "chat_threads" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "title" text DEFAULT ''::text NOT NULL,
  "preview" text DEFAULT ''::text NOT NULL,
  "thread_data" text DEFAULT '{}'::text NOT NULL,
  "message_count" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "scope_type" text,
  "scope_id" text,
  "scope_label" text,
  "pinned_at" bigint,
  "archived_at" bigint,
  "share_token_hash" text,
  "source_platform" text,
  "source_app_id" text,
  "source_url" text,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL
);

CREATE TABLE "context_directives" (
  "id" text NOT NULL,
  "thread_id" text NOT NULL,
  "segment_id" text NOT NULL,
  "action" text NOT NULL,
  "summary_text" text,
  "created_by" text DEFAULT 'user'::text NOT NULL,
  "active" integer DEFAULT 1 NOT NULL,
  "origin_turn" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  "owner_email" text DEFAULT 'local@localhost'::text NOT NULL,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL
);

CREATE TABLE "custom_api_providers" (
  "id" text NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text NOT NULL,
  "label" text NOT NULL,
  "base_url" text NOT NULL,
  "auth_json" text NOT NULL,
  "docs_urls_json" text NOT NULL,
  "allowed_host_suffixes_json" text NOT NULL,
  "default_headers_json" text NOT NULL,
  "notes" text DEFAULT ''::text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "data_program_runs" (
  "id" text NOT NULL,
  "program_id" text NOT NULL,
  "params_hash" text NOT NULL,
  "params_json" text NOT NULL,
  "status" text NOT NULL,
  "rows_json" text,
  "schema_json" text,
  "truncated" integer DEFAULT 0 NOT NULL,
  "row_count" bigint DEFAULT 0 NOT NULL,
  "byte_size" bigint DEFAULT 0 NOT NULL,
  "error_code" text,
  "error_message" text,
  "logs_tail" text,
  "execution_id" text,
  "triggered_by" text NOT NULL,
  "started_at" bigint NOT NULL,
  "finished_at" bigint,
  "duration_ms" bigint
);

CREATE TABLE "data_program_shares" (
  "id" text NOT NULL,
  "resource_id" text NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "role" text DEFAULT 'viewer'::text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "notified_at" text
);

CREATE TABLE "data_programs" (
  "id" text NOT NULL,
  "app_id" text NOT NULL,
  "name" text NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "code" text NOT NULL,
  "params_schema" text,
  "default_params" text,
  "output_columns" text,
  "refresh_mode" text DEFAULT 'ttl'::text NOT NULL,
  "refresh_ttl_ms" integer DEFAULT 300000 NOT NULL,
  "background" integer DEFAULT 0 NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "updated_at" text DEFAULT now() NOT NULL,
  "archived_at" text,
  "owner_email" text DEFAULT 'local@localhost'::text NOT NULL,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL
);

CREATE TABLE "email_log" (
  "id" text NOT NULL,
  "org_id" text,
  "template_id" text,
  "app" text,
  "recipient" text NOT NULL,
  "sender" text NOT NULL,
  "subject" text NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "provider" text NOT NULL,
  "request_payload" text,
  "response_status" bigint,
  "response_body" text,
  "html_body" text,
  "text_body" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "identity_rekeys" (
  "id" text NOT NULL,
  "old_email" text NOT NULL,
  "new_email" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "error" text,
  "actor_email" text,
  "counts_json" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "completed_at" bigint
);

CREATE TABLE "identity_retired_emails" (
  "email" text NOT NULL,
  "retired_at" bigint NOT NULL
);

CREATE TABLE "identity_sso_flow_state" (
  "state" text NOT NULL,
  "return_path" text,
  "app_id" text NOT NULL,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "authority" text NOT NULL,
  "code_challenge" text NOT NULL,
  "created_at" bigint,
  "expires_at" bigint,
  "consumed_at" bigint
);

CREATE TABLE "identity_sso_jti" (
  "jti" text NOT NULL,
  "seen_at" bigint
);

CREATE TABLE "integration_a2a_continuations" (
  "id" text NOT NULL,
  "integration_task_id" text NOT NULL,
  "platform" text NOT NULL,
  "external_thread_id" text NOT NULL,
  "incoming_payload" text NOT NULL,
  "placeholder_ref" text,
  "progress_ref" text,
  "progress_ref_claimed" bigint DEFAULT 0 NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "agent_name" text NOT NULL,
  "agent_url" text NOT NULL,
  "dedupe_key" text,
  "a2a_task_id" text NOT NULL,
  "a2a_auth_token" text,
  "verified_artifact_checkpoint" text,
  "terminal_delivery_kind" text,
  "terminal_delivery_confirmed_at" bigint,
  "terminal_history_payload" text,
  "status" text NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "next_check_at" bigint NOT NULL,
  "error_message" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "completed_at" bigint
);

CREATE TABLE "integration_awaiting_inputs" (
  "platform" text NOT NULL,
  "external_thread_id" text NOT NULL,
  "requester_id" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_campaigns" (
  "id" text NOT NULL,
  "integration_task_id" text NOT NULL,
  "thread_id" text NOT NULL,
  "turn_id" text NOT NULL,
  "status" text NOT NULL,
  "chunk_count" bigint DEFAULT 0 NOT NULL,
  "current_run_id" text,
  "lease_token" text,
  "lease_expires_at" bigint,
  "next_run_at" bigint NOT NULL,
  "progress_ref" text,
  "checkpoint" text,
  "error_message" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "completed_at" bigint
);

CREATE TABLE "integration_computer_approvals" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "device_id" text NOT NULL,
  "task_id" text NOT NULL,
  "run_id" text NOT NULL,
  "operation_class" text NOT NULL,
  "approval_scope" text NOT NULL,
  "action_hash" text NOT NULL,
  "status" text NOT NULL,
  "decision_result_json" text,
  "decided_by" text,
  "decided_at" bigint,
  "expires_at" bigint NOT NULL,
  "consumed_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_configs" (
  "platform" text NOT NULL,
  "config_key" text NOT NULL,
  "config_data" text NOT NULL,
  "owner" text,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_controls" (
  "id" text NOT NULL,
  "action" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "requester_id" text NOT NULL,
  "team_id" text NOT NULL,
  "api_app_id" text,
  "channel_id" text NOT NULL,
  "message_ts" text NOT NULL,
  "run_id" text,
  "approval_key" text,
  "incoming_json" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  "claimed_at" bigint
);

CREATE TABLE "integration_conversation_scopes" (
  "id" text NOT NULL,
  "platform" text NOT NULL,
  "tenant_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "conversation_type" text NOT NULL,
  "trust_level" text DEFAULT 'unknown'::text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "installation_id" text,
  "service_owner_email" text NOT NULL,
  "default_model" text,
  "require_mention" bigint DEFAULT 1 NOT NULL,
  "allow_direct_messages" bigint DEFAULT 0 NOT NULL,
  "allow_guests" bigint DEFAULT 0 NOT NULL,
  "allow_external_shared" bigint DEFAULT 0 NOT NULL,
  "allow_unknown_trust" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_identity_links" (
  "id" text NOT NULL,
  "platform" text NOT NULL,
  "tenant_id" text NOT NULL,
  "external_user_id" text NOT NULL,
  "user_email" text NOT NULL,
  "org_id" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_installations" (
  "id" text NOT NULL,
  "platform" text NOT NULL,
  "installation_key" text NOT NULL,
  "team_id" text,
  "team_name" text,
  "enterprise_id" text,
  "enterprise_name" text,
  "is_enterprise_install" bigint DEFAULT 0 NOT NULL,
  "api_app_id" text,
  "bot_user_id" text,
  "scopes_json" text DEFAULT '[]'::text NOT NULL,
  "installed_by_external_user_id" text,
  "owner_email" text NOT NULL,
  "org_id" text,
  "token_secret_key" text NOT NULL,
  "secret_scope" text NOT NULL,
  "secret_scope_id" text NOT NULL,
  "status" text DEFAULT 'connected'::text NOT NULL,
  "health" text DEFAULT 'unknown'::text NOT NULL,
  "last_error" text,
  "health_checked_at" bigint,
  "last_healthy_at" bigint,
  "token_expires_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "disconnected_at" bigint
);

CREATE TABLE "integration_pending_tasks" (
  "id" text NOT NULL,
  "platform" text NOT NULL,
  "external_thread_id" text NOT NULL,
  "payload" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "status" text NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "dispatch_attempts" bigint DEFAULT 0 NOT NULL,
  "last_dispatch_at" bigint,
  "last_dispatch_outcome" text,
  "dispatch_scope" text,
  "error_message" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "completed_at" bigint,
  "external_event_key" text
);

CREATE TABLE "integration_remote_commands" (
  "id" text NOT NULL,
  "device_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "kind" text NOT NULL,
  "params_json" text NOT NULL,
  "status" text NOT NULL,
  "result_json" text,
  "platform" text,
  "external_thread_id" text,
  "computer_task_id" text,
  "computer_run_id" text,
  "computer_sequence" bigint,
  "idempotency_key" text,
  "operation_class" text,
  "approval_scope" text,
  "action_hash" text,
  "lease_expires_at" bigint,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "next_check_at" bigint NOT NULL,
  "claimed_at" bigint,
  "completed_at" bigint,
  "error_message" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_remote_devices" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "label" text NOT NULL,
  "platform" text,
  "app_version" text,
  "host_name" text,
  "metadata_json" text,
  "device_token_hash" text NOT NULL,
  "last_seen_at" bigint,
  "status" text NOT NULL,
  "revoked_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_remote_push_notifications" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "registration_id" text NOT NULL,
  "payload_json" text NOT NULL,
  "status" text NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "provider_ticket_id" text,
  "next_attempt_at" bigint DEFAULT 0 NOT NULL,
  "last_error" text,
  "delivered_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_remote_push_registrations" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "provider" text NOT NULL,
  "platform" text,
  "client_device_id" text,
  "label" text,
  "token" text NOT NULL,
  "token_hash" text NOT NULL,
  "status" text NOT NULL,
  "last_seen_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_remote_run_events" (
  "device_id" text NOT NULL,
  "remote_run_id" text NOT NULL,
  "seq" bigint NOT NULL,
  "event_json" text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE TABLE "integration_thread_mappings" (
  "platform" text NOT NULL,
  "external_thread_id" text NOT NULL,
  "internal_thread_id" text NOT NULL,
  "platform_context" text DEFAULT '{}'::text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_usage_budget_events" (
  "id" text NOT NULL,
  "budget_id" text NOT NULL,
  "window_start" bigint NOT NULL,
  "threshold_bps" bigint NOT NULL,
  "observed_micros" bigint NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE TABLE "integration_usage_budget_windows" (
  "budget_id" text NOT NULL,
  "window_start" bigint NOT NULL,
  "used_micros" bigint DEFAULT 0 NOT NULL,
  "reserved_micros" bigint DEFAULT 0 NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_usage_budgets" (
  "id" text NOT NULL,
  "partition_key" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "period" text NOT NULL,
  "limit_micros" bigint NOT NULL,
  "threshold_bps" bigint DEFAULT 8000 NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "integration_usage_reservations" (
  "id" text NOT NULL,
  "reservation_key" text NOT NULL,
  "budget_id" text NOT NULL,
  "window_start" bigint NOT NULL,
  "estimated_cost_micros" bigint NOT NULL,
  "settled_cost_micros" bigint,
  "status" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "invitation" (
  "id" text NOT NULL,
  "organization_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "inviter_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "jwks" (
  "id" text NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone,
  "alg" text,
  "crv" text
);

CREATE TABLE "mcp_action_approvals" (
  "nonce" text NOT NULL,
  "caller_key" text NOT NULL,
  "action_name" text NOT NULL,
  "arguments_hash" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "consumed_at" bigint
);

CREATE TABLE "mcp_connect_tokens" (
  "id" text NOT NULL,
  "jti" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "label" text,
  "kind" text DEFAULT 'personal'::text NOT NULL,
  "service_name" text,
  "created_by" text,
  "created_at" bigint,
  "last_used_at" bigint,
  "revoked_at" bigint
);

CREATE TABLE "mcp_device_codes" (
  "device_code" text NOT NULL,
  "user_code" text NOT NULL,
  "owner_email" text,
  "org_id" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "token_jti" text,
  "catalog_scope" text,
  "created_at" bigint,
  "expires_at" bigint,
  "consumed_at" bigint,
  "client" text,
  "purpose" text
);

CREATE TABLE "mcp_oauth_clients" (
  "client_id" text NOT NULL,
  "client_name" text,
  "redirect_uris" text NOT NULL,
  "grant_types" text,
  "response_types" text,
  "token_endpoint_auth_method" text,
  "application_type" text,
  "created_at" bigint
);

CREATE TABLE "mcp_oauth_codes" (
  "code" text NOT NULL,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL,
  "owner_email" text NOT NULL,
  "issued_for_email" text,
  "org_id" text,
  "org_domain" text,
  "scope" text NOT NULL,
  "resource" text NOT NULL,
  "created_at" bigint,
  "expires_at" bigint,
  "consumed_at" bigint,
  "client_name" text
);

CREATE TABLE "mcp_oauth_refresh_tokens" (
  "id" text NOT NULL,
  "token_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "issued_for_email" text,
  "org_id" text,
  "org_domain" text,
  "scope" text NOT NULL,
  "resource" text NOT NULL,
  "created_at" bigint,
  "expires_at" bigint,
  "last_used_at" bigint,
  "revoked_at" bigint,
  "replaced_by_hash" text
);

CREATE TABLE "member" (
  "id" text NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "notification_delivery_state" (
  "notification_id" text NOT NULL,
  "delivery_key" text NOT NULL,
  "state" text NOT NULL,
  "claim_token" text,
  "lease_expires_at" bigint NOT NULL,
  "completed_at" bigint
);

CREATE TABLE "notifications" (
  "id" text NOT NULL,
  "owner" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "metadata" text,
  "delivered_channels" text DEFAULT '[]'::text NOT NULL,
  "created_at" bigint NOT NULL,
  "read_at" bigint
);

CREATE TABLE "oauth_tokens" (
  "provider" text NOT NULL,
  "account_id" text NOT NULL,
  "owner" text,
  "tokens" text NOT NULL,
  "updated_at" bigint NOT NULL,
  "revision" bigint NOT NULL,
  "display_name" text
);

CREATE TABLE "observational_memory" (
  "id" text NOT NULL,
  "thread_id" text NOT NULL,
  "tier" text NOT NULL,
  "text" text NOT NULL,
  "token_estimate" bigint DEFAULT 0 NOT NULL,
  "source_start_index" bigint,
  "source_end_index" bigint,
  "source_message_count" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL
);

CREATE TABLE "org_invitations" (
  "id" text NOT NULL,
  "org_id" text NOT NULL,
  "email" text NOT NULL,
  "invited_by" text NOT NULL,
  "created_at" bigint NOT NULL,
  "status" text NOT NULL,
  "role" text,
  "app_roles_json" text
);

CREATE TABLE "org_members" (
  "id" text NOT NULL,
  "org_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "joined_at" bigint NOT NULL,
  "federation_removal_pending_at" bigint
);

CREATE TABLE "org_scim_memberships" (
  "id" text NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "created_membership" boolean DEFAULT false NOT NULL,
  "created_at" bigint NOT NULL,
  "member_id" text
);

CREATE TABLE "organization" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "metadata" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "organizations" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" bigint NOT NULL,
  "allowed_domain" text,
  "a2a_secret" text,
  "workspace_url" text,
  "required_auth_provider" text,
  "identity_authority" text,
  "identity_id" text,
  "federation_roster_initialized_at" bigint,
  "icon_json" text,
  "icon_revision" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE "private_icon_assets" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "mime_type" text NOT NULL,
  "filename" text,
  "alt" text,
  "size" bigint NOT NULL,
  "sha256" text NOT NULL,
  "blob_handle_json" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "progress_runs" (
  "id" text NOT NULL,
  "owner" text NOT NULL,
  "title" text NOT NULL,
  "step" text,
  "percent" bigint,
  "status" text DEFAULT 'running'::text NOT NULL,
  "metadata" text,
  "started_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "completed_at" bigint
);

CREATE TABLE "provider_api_cooldowns" (
  "quota_key" text NOT NULL,
  "provider_id" text NOT NULL,
  "scope_key" text NOT NULL,
  "cooldown_until" bigint NOT NULL,
  "status" bigint,
  "reason" text,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "provider_corpus_job_hits" (
  "job_id" text NOT NULL,
  "hit_index" bigint NOT NULL,
  "hit_data" text NOT NULL
);

CREATE TABLE "provider_corpus_jobs" (
  "id" text NOT NULL,
  "app_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "name" text NOT NULL,
  "mode" text NOT NULL,
  "status" text NOT NULL,
  "provider" text NOT NULL,
  "request_json" text NOT NULL,
  "pagination_json" text,
  "batch_json" text,
  "search_json" text NOT NULL,
  "limits_json" text NOT NULL,
  "checkpoint_json" text NOT NULL,
  "pages_processed" bigint DEFAULT 0 NOT NULL,
  "batches_processed" bigint DEFAULT 0 NOT NULL,
  "items_processed" bigint DEFAULT 0 NOT NULL,
  "matched_items" bigint DEFAULT 0 NOT NULL,
  "total_hits" bigint DEFAULT 0 NOT NULL,
  "stored_hits" bigint DEFAULT 0 NOT NULL,
  "error" text,
  "next_resume_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "recap_images" (
  "token" text NOT NULL,
  "png_base64" text NOT NULL,
  "content_type" text DEFAULT 'image/png'::text NOT NULL,
  "byte_length" bigint DEFAULT 0 NOT NULL,
  "owner_email" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "resource_access_requests" (
  "id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "requester_email" text NOT NULL,
  "requester_name" text,
  "owner_email" text NOT NULL,
  "note" text,
  "state" text NOT NULL,
  "generation" integer DEFAULT 1 NOT NULL,
  "requested_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  "decided_by" text,
  "decided_at" bigint,
  "granted_role" text,
  "delivery" text
);

CREATE TABLE "resources" (
  "id" text NOT NULL,
  "path" text NOT NULL,
  "owner" text NOT NULL,
  "content" text DEFAULT ''::text NOT NULL,
  "mime_type" text DEFAULT 'text/markdown'::text NOT NULL,
  "size" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "created_by" text DEFAULT 'user'::text NOT NULL,
  "visibility" text DEFAULT 'workspace'::text NOT NULL,
  "thread_id" text,
  "run_id" text,
  "expires_at" bigint,
  "metadata" text
);

CREATE TABLE "sandbox_executions" (
  "id" text NOT NULL,
  "owner" text NOT NULL,
  "org_id" text,
  "thread_id" text,
  "runtime" text DEFAULT 'node'::text NOT NULL,
  "code" text NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "timeout_ms" bigint NOT NULL,
  "max_output_chars" bigint NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "max_attempts" bigint DEFAULT 2 NOT NULL,
  "claim_token" text,
  "lease_expires_at" bigint,
  "stdout" text DEFAULT ''::text NOT NULL,
  "stderr" text DEFAULT ''::text NOT NULL,
  "stdout_truncated" bigint DEFAULT 0 NOT NULL,
  "stderr_truncated" bigint DEFAULT 0 NOT NULL,
  "exit_code" bigint,
  "timed_out" bigint DEFAULT 0 NOT NULL,
  "error" text,
  "bridge_tools_used" text,
  "allowed_action_names" text,
  "created_at" bigint NOT NULL,
  "started_at" bigint,
  "finished_at" bigint,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "scim_connection_binding" (
  "id" text NOT NULL,
  "connection_id" text NOT NULL,
  "connection_key" text NOT NULL,
  "provisioning_domain_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "decommissioned_at" timestamp with time zone,
  "decommission_status" text DEFAULT 'active'::text NOT NULL,
  "decommission_cursor_user_id" text,
  "decommission_reconciled_user_count" bigint DEFAULT 0 NOT NULL,
  "decommission_batch_count" bigint DEFAULT 0 NOT NULL,
  "decommission_revision" bigint DEFAULT 0 NOT NULL,
  "decommission_completed_at" timestamp with time zone,
  "decommission_lease_id" text,
  "decommission_lease_expires_at" timestamp with time zone
);

CREATE TABLE "scim_group" (
  "id" text NOT NULL,
  "connection_id" text NOT NULL,
  "provisioning_domain_id" text NOT NULL,
  "revision" bigint DEFAULT 0 NOT NULL,
  "display_name" text NOT NULL,
  "display_name_key" text NOT NULL,
  "external_id" text,
  "external_id_key" text,
  "order_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "scim_group_member" (
  "id" text NOT NULL,
  "connection_id" text NOT NULL,
  "group_id" text NOT NULL,
  "scim_user_id" text NOT NULL,
  "membership_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE "scim_identity_tombstone" (
  "id" text NOT NULL,
  "connection_id" text NOT NULL,
  "provisioning_domain_id" text NOT NULL,
  "external_id" text NOT NULL,
  "external_id_key" text NOT NULL,
  "user_id" text NOT NULL,
  "profile" text NOT NULL,
  "deleted_at" timestamp with time zone NOT NULL
);

CREATE TABLE "scim_managed_connection" (
  "id" text NOT NULL,
  "creation_request_id" text NOT NULL,
  "connection_id" text NOT NULL,
  "provisioning_domain_id" text NOT NULL,
  "status" text NOT NULL,
  "revision" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL,
  "decommission_started_at" timestamp with time zone,
  "decommission_started_by" text,
  "decommissioned_at" timestamp with time zone,
  "decommissioned_by" text
);

CREATE TABLE "scim_managed_connection_event" (
  "id" text NOT NULL,
  "connection_record_id" text NOT NULL,
  "event_key" text NOT NULL,
  "sequence" bigint NOT NULL,
  "type" text NOT NULL,
  "actor_id" text NOT NULL,
  "credential_id" text,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE "scim_managed_credential" (
  "id" text NOT NULL,
  "connection_record_id" text NOT NULL,
  "credential_id" text NOT NULL,
  "token_digest" text NOT NULL,
  "hash_version" text NOT NULL,
  "active_slot_key" text NOT NULL,
  "status" text NOT NULL,
  "serialized_scopes" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "decommissioned_at" timestamp with time zone
);

CREATE TABLE "scim_projection_grant" (
  "id" text NOT NULL,
  "connection_id" text NOT NULL,
  "provisioning_domain_id" text NOT NULL,
  "scim_user_id" text NOT NULL,
  "user_id" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "source_value" text,
  "role" text NOT NULL,
  "grant_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "scim_subject" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "profile_source_id" text,
  "revision" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "scim_user" (
  "id" text NOT NULL,
  "connection_id" text NOT NULL,
  "provisioning_domain_id" text NOT NULL,
  "user_id" text NOT NULL,
  "connection_user_key" text NOT NULL,
  "user_name" text NOT NULL,
  "user_name_key" text NOT NULL,
  "primary_email" text NOT NULL,
  "work_email_value_index" text NOT NULL,
  "email_value_index" text NOT NULL,
  "display_name" text NOT NULL,
  "formatted_name" text NOT NULL,
  "given_name" text,
  "family_name" text,
  "serialized_emails" text NOT NULL,
  "serialized_attributes" text,
  "external_id" text,
  "external_id_key" text,
  "active" boolean NOT NULL,
  "order_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "search_index_state" (
  "app" text NOT NULL,
  "resource_type" text NOT NULL,
  "target_version" integer NOT NULL,
  "index_version" integer,
  "rebuild_high_seq" bigint,
  "rebuild_started_at" timestamp with time zone,
  "rebuild_completed_at" timestamp with time zone
);

CREATE TABLE "search_resources" (
  "app" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "title" text DEFAULT ''::text NOT NULL,
  "title_norm" text DEFAULT ''::text NOT NULL,
  "summary_norm" text DEFAULT ''::text NOT NULL,
  "doc_vector" tsvector DEFAULT ''::tsvector NOT NULL,
  "positions_complete" boolean DEFAULT true NOT NULL,
  "modified_at" timestamp with time zone,
  "content_hash" text NOT NULL,
  "index_version" integer NOT NULL,
  "indexed_seq" bigint NOT NULL,
  "indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "service_principal_policies" (
  "org_id" text NOT NULL,
  "service_name" text NOT NULL,
  "owner_email" text,
  "team" text,
  "risk_tier" text DEFAULT 'medium'::text NOT NULL,
  "purpose" text,
  "lifecycle" text DEFAULT 'active'::text NOT NULL,
  "allowed_actions" text,
  "lifecycle_reason" text,
  "lifecycle_changed_by" text,
  "lifecycle_changed_at" bigint,
  "created_at" bigint,
  "updated_at" bigint
);

CREATE TABLE "session" (
  "id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL,
  "active_organization_id" text
);

CREATE TABLE "sessions" (
  "token" text NOT NULL,
  "email" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "settings" (
  "key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "sso_provider" (
  "id" text NOT NULL,
  "issuer" text NOT NULL,
  "oidc_config" text,
  "saml_config" text,
  "user_id" text,
  "provider_id" text NOT NULL,
  "organization_id" text,
  "domain" text NOT NULL,
  "domain_verified" boolean
);

CREATE TABLE "staged_dataset_rows" (
  "dataset_id" text NOT NULL,
  "row_index" bigint NOT NULL,
  "row_data" text NOT NULL
);

CREATE TABLE "staged_datasets" (
  "id" text NOT NULL,
  "app_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "name" text NOT NULL,
  "columns" text NOT NULL,
  "row_count" bigint DEFAULT 0 NOT NULL,
  "byte_size" bigint DEFAULT 0 NOT NULL,
  "byte_size_utf8_updated_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "sync_events" (
  "id" text NOT NULL,
  "version" bigint NOT NULL,
  "event_json" text NOT NULL,
  "source" text NOT NULL,
  "type" text NOT NULL,
  "event_key" text,
  "owner" text,
  "org_id" text,
  "resource_type" text,
  "resource_id" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "sync_events_prune_state" (
  "id" integer NOT NULL,
  "cursor_version" bigint DEFAULT 0 NOT NULL,
  "lease_owner" text,
  "lease_expires_at" bigint,
  "last_run_at" bigint,
  "last_checked_at" bigint,
  "last_success_at" bigint,
  "last_deleted" bigint DEFAULT 0 NOT NULL,
  "total_deleted" bigint DEFAULT 0 NOT NULL,
  "backlog" boolean DEFAULT false NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "last_error_at" bigint
);

CREATE TABLE "token_usage" (
  "id" bigint NOT NULL,
  "owner_email" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_write_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_cents_x100" bigint DEFAULT 0 NOT NULL,
  "builder_credits_used" numeric,
  "engine_name" text,
  "cost_source" text DEFAULT 'estimated'::text NOT NULL,
  "model" text DEFAULT ''::text NOT NULL,
  "label" text DEFAULT 'chat'::text NOT NULL,
  "app" text DEFAULT ''::text NOT NULL,
  "ref_id" text DEFAULT ''::text NOT NULL,
  "org_id" text,
  "run_id" text,
  "thread_id" text,
  "task_id" text,
  "integration_scope_id" text,
  "source_platform" text,
  "source_id" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "tool_consents" (
  "viewer_email" text NOT NULL,
  "tool_id" text NOT NULL,
  "content_hash" text NOT NULL,
  "granted_at" text DEFAULT now() NOT NULL
);

CREATE TABLE "tool_data" (
  "id" text NOT NULL,
  "tool_id" text NOT NULL,
  "collection" text NOT NULL,
  "item_id" text,
  "data" text NOT NULL,
  "owner_email" text DEFAULT 'local@localhost'::text NOT NULL,
  "scope" text DEFAULT 'user'::text NOT NULL,
  "org_id" text,
  "scope_key" text DEFAULT 'local@localhost'::text NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "updated_at" text DEFAULT now() NOT NULL
);

CREATE TABLE "tool_hidden_extensions" (
  "id" text NOT NULL,
  "tool_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "created_at" text DEFAULT now() NOT NULL
);

CREATE TABLE "tool_history" (
  "id" text NOT NULL,
  "tool_id" text NOT NULL,
  "version" integer NOT NULL,
  "operation" text NOT NULL,
  "summary" text DEFAULT ''::text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "content" text DEFAULT ''::text NOT NULL,
  "icon" text,
  "actor_email" text,
  "owner_email" text DEFAULT 'local@localhost'::text NOT NULL,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "created_at" text DEFAULT now() NOT NULL
);

CREATE TABLE "tool_shares" (
  "id" text NOT NULL,
  "resource_id" text NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "role" text DEFAULT 'viewer'::text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "notified_at" text
);

CREATE TABLE "tool_slot_installs" (
  "id" text NOT NULL,
  "tool_id" text NOT NULL,
  "slot_id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "position" integer DEFAULT 0 NOT NULL,
  "config" text,
  "created_at" text DEFAULT now() NOT NULL,
  "updated_at" text DEFAULT now() NOT NULL
);

CREATE TABLE "tool_slots" (
  "id" text NOT NULL,
  "tool_id" text NOT NULL,
  "slot_id" text NOT NULL,
  "config" text,
  "created_at" text DEFAULT now() NOT NULL
);

CREATE TABLE "tools" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "content" text DEFAULT ''::text NOT NULL,
  "icon" text,
  "created_at" text DEFAULT now() NOT NULL,
  "updated_at" text DEFAULT now() NOT NULL,
  "archived_at" text,
  "hidden_at" text,
  "hidden_by" text,
  "owner_email" text DEFAULT 'local@localhost'::text NOT NULL,
  "org_id" text,
  "visibility" text DEFAULT 'private'::text NOT NULL
);

CREATE TABLE "twoFactor" (
  "id" text NOT NULL,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "user_id" text NOT NULL,
  "verified" boolean DEFAULT true NOT NULL,
  "failed_verification_count" bigint DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone
);

CREATE TABLE "usage_alert_events" (
  "id" text NOT NULL,
  "rule_id" text NOT NULL,
  "window_start" bigint NOT NULL,
  "notification_id" text,
  "created_at" bigint NOT NULL
);

CREATE TABLE "usage_alert_rules" (
  "id" text NOT NULL,
  "scope" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "app_id" text,
  "unit" text NOT NULL,
  "period" text NOT NULL,
  "limit_value" bigint NOT NULL,
  "channels" text NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "is_default" bigint DEFAULT 0 NOT NULL,
  "dismissed_window_start" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "user" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "onboarding_role" text,
  "two_factor_enabled" boolean DEFAULT false NOT NULL,
  "first_touch_utm_source" text,
  "first_touch_utm_medium" text,
  "first_touch_utm_campaign" text,
  "first_touch_utm_term" text,
  "first_touch_gclid" text,
  "first_touch_msclkid" text,
  "first_touch_vector_source" text,
  "first_touch_referrer" text
);

CREATE TABLE "verification" (
  "id" text NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "workspace_app_shares" (
  "id" text NOT NULL,
  "resource_id" text NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "role" text DEFAULT 'viewer'::text NOT NULL,
  "created_at" text NOT NULL,
  "created_by" text DEFAULT ''::text NOT NULL,
  "notified_at" text
);

CREATE TABLE "workspace_apps" (
  "id" text NOT NULL,
  "owner_email" text NOT NULL,
  "org_id" text,
  "visibility" text DEFAULT 'org'::text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "path" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "org_enabled" boolean DEFAULT true NOT NULL
);

CREATE TABLE "workspace_connection_grants" (
  "id" text NOT NULL,
  "connection_id" text DEFAULT ''::text NOT NULL,
  "provider" text DEFAULT ''::text NOT NULL,
  "app_id" text DEFAULT ''::text NOT NULL,
  "scopes_json" text DEFAULT '[]'::text NOT NULL,
  "config_json" text DEFAULT '{}'::text NOT NULL,
  "credential_refs_json" text DEFAULT '[]'::text NOT NULL,
  "granted_by_email" text DEFAULT ''::text NOT NULL,
  "owner_email" text DEFAULT ''::text NOT NULL,
  "org_id" text,
  "created_at" bigint DEFAULT 0 NOT NULL,
  "updated_at" bigint DEFAULT 0 NOT NULL,
  "last_used_at" bigint
);

CREATE TABLE "workspace_connections" (
  "id" text NOT NULL,
  "provider" text DEFAULT ''::text NOT NULL,
  "label" text DEFAULT ''::text NOT NULL,
  "account_id" text,
  "account_label" text,
  "status" text DEFAULT 'connected'::text NOT NULL,
  "scopes_json" text DEFAULT '[]'::text NOT NULL,
  "config_json" text DEFAULT '{}'::text NOT NULL,
  "allowed_apps_json" text DEFAULT '[]'::text NOT NULL,
  "allowed_users_json" text DEFAULT '[]'::text NOT NULL,
  "allowed_user_groups_json" text DEFAULT '[]'::text NOT NULL,
  "credential_refs_json" text DEFAULT '[]'::text NOT NULL,
  "owner_email" text DEFAULT ''::text NOT NULL,
  "org_id" text,
  "created_at" bigint DEFAULT 0 NOT NULL,
  "updated_at" bigint DEFAULT 0 NOT NULL,
  "last_used_at" bigint,
  "last_checked_at" bigint,
  "last_error" text
);

CREATE TABLE "workspace_user_groups" (
  "id" text NOT NULL,
  "org_id" text DEFAULT ''::text NOT NULL,
  "name" text DEFAULT ''::text NOT NULL,
  "normalized_name" text,
  "member_emails_json" text DEFAULT '[]'::text NOT NULL,
  "created_by_email" text DEFAULT ''::text NOT NULL,
  "created_at" bigint DEFAULT 0 NOT NULL,
  "updated_at" bigint DEFAULT 0 NOT NULL
);

ALTER TABLE "_agent_harness_session_migrations" ADD CONSTRAINT "_agent_harness_session_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_agent_harness_session_migrations_named" ADD CONSTRAINT "_agent_harness_session_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_agent_run_migrations" ADD CONSTRAINT "_agent_run_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_agent_run_migrations_named" ADD CONSTRAINT "_agent_run_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_agent_tool_approval_migrations" ADD CONSTRAINT "_agent_tool_approval_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_agent_tool_approval_migrations_named" ADD CONSTRAINT "_agent_tool_approval_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_automation_run_migrations" ADD CONSTRAINT "_automation_run_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_automation_run_migrations_named" ADD CONSTRAINT "_automation_run_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_automation_scheduler_health_migrations" ADD CONSTRAINT "_automation_scheduler_health_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_automation_scheduler_health_migrations_named" ADD CONSTRAINT "_automation_scheduler_health_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_automation_trigger_event_migrations" ADD CONSTRAINT "_automation_trigger_event_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_automation_trigger_event_migrations_named" ADD CONSTRAINT "_automation_trigger_event_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_better_auth_migrations" ADD CONSTRAINT "_better_auth_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_better_auth_migrations_named" ADD CONSTRAINT "_better_auth_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_chat_thread_schema_migrations" ADD CONSTRAINT "_chat_thread_schema_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_chat_thread_schema_migrations_named" ADD CONSTRAINT "_chat_thread_schema_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_collab_awareness" ADD CONSTRAINT "_collab_awareness_pkey" PRIMARY KEY (doc_id, client_id);

ALTER TABLE "_collab_docs" ADD CONSTRAINT "_collab_docs_pkey" PRIMARY KEY (doc_id);

ALTER TABLE "_context_xray_migrations" ADD CONSTRAINT "_context_xray_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_context_xray_migrations_named" ADD CONSTRAINT "_context_xray_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_identity_sso_migrations" ADD CONSTRAINT "_identity_sso_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_identity_sso_migrations_named" ADD CONSTRAINT "_identity_sso_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_oauth_token_migrations" ADD CONSTRAINT "_oauth_token_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_oauth_token_migrations_named" ADD CONSTRAINT "_oauth_token_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_observability_migrations" ADD CONSTRAINT "_observability_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_observability_migrations_named" ADD CONSTRAINT "_observability_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_observational_memory_migrations" ADD CONSTRAINT "_observational_memory_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_observational_memory_migrations_named" ADD CONSTRAINT "_observational_memory_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_org_migrations" ADD CONSTRAINT "_org_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_org_migrations_named" ADD CONSTRAINT "_org_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_remote_device_migrations" ADD CONSTRAINT "_remote_device_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_remote_device_migrations_named" ADD CONSTRAINT "_remote_device_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_usage_alert_migrations" ADD CONSTRAINT "_usage_alert_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_usage_alert_migrations_named" ADD CONSTRAINT "_usage_alert_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "_workspace_connections_migrations" ADD CONSTRAINT "_workspace_connections_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE "_workspace_connections_migrations_named" ADD CONSTRAINT "_workspace_connections_migrations_named_pkey" PRIMARY KEY (name);

ALTER TABLE "a2a_approvals" ADD CONSTRAINT "a2a_approvals_pkey" PRIMARY KEY (id);

ALTER TABLE "a2a_approvals" ADD CONSTRAINT "a2a_approvals_task_id_key" UNIQUE (task_id);

ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_pkey" PRIMARY KEY (id);

ALTER TABLE "account" ADD CONSTRAINT "account_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_checkpoints" ADD CONSTRAINT "agent_checkpoints_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_evals" ADD CONSTRAINT "agent_evals_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_experiment_assignments" ADD CONSTRAINT "agent_experiment_assignments_pkey" PRIMARY KEY (experiment_id, user_id);

ALTER TABLE "agent_experiment_results" ADD CONSTRAINT "agent_experiment_results_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_experiments" ADD CONSTRAINT "agent_experiments_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_harness_sessions" ADD CONSTRAINT "agent_harness_sessions_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_human_review_summaries" ADD CONSTRAINT "agent_human_review_summaries_pkey" PRIMARY KEY (run_id);

ALTER TABLE "agent_instruction_updates" ADD CONSTRAINT "agent_instruction_updates_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_native_browser_session_requests" ADD CONSTRAINT "agent_native_browser_session_requests_pkey" PRIMARY KEY (owner_email, request_id);

ALTER TABLE "agent_native_browser_sessions" ADD CONSTRAINT "agent_native_browser_sessions_pkey" PRIMARY KEY (owner_email, session_id);

ALTER TABLE "agent_native_embed_session_revocations" ADD CONSTRAINT "agent_native_embed_session_revocations_pkey" PRIMARY KEY (owner_hash);

ALTER TABLE "agent_native_embed_tickets" ADD CONSTRAINT "agent_native_embed_tickets_pkey" PRIMARY KEY (ticket_hash);

ALTER TABLE "agent_resource_versions" ADD CONSTRAINT "agent_resource_versions_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_comment_reactions" ADD CONSTRAINT "agent_review_comment_reactions_pkey" PRIMARY KEY (comment_id, actor_email, reaction);

ALTER TABLE "agent_review_comments" ADD CONSTRAINT "agent_review_comments_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_notification_deliveries" ADD CONSTRAINT "agent_review_notification_deliveries_pkey" PRIMARY KEY (comment_id, recipient_email);

ALTER TABLE "agent_review_statuses" ADD CONSTRAINT "agent_review_statuses_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_suggestion_amendments" ADD CONSTRAINT "agent_review_suggestion_amendments_pkey" PRIMARY KEY (idempotency_key);

ALTER TABLE "agent_review_suggestion_amendments" ADD CONSTRAINT "agent_review_suggestion_amendments_suggestion_id_revision_key" UNIQUE (suggestion_id, revision);

ALTER TABLE "agent_review_suggestion_creations" ADD CONSTRAINT "agent_review_suggestion_creations_pkey" PRIMARY KEY (idempotency_key);

ALTER TABLE "agent_review_suggestion_creations" ADD CONSTRAINT "agent_review_suggestion_creations_suggestion_id_key" UNIQUE (suggestion_id);

ALTER TABLE "agent_review_suggestion_decisions" ADD CONSTRAINT "agent_review_suggestion_decisions_idempotency_key_key" UNIQUE (idempotency_key);

ALTER TABLE "agent_review_suggestion_decisions" ADD CONSTRAINT "agent_review_suggestion_decisions_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_suggestion_operations" ADD CONSTRAINT "agent_review_suggestion_operations_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_suggestion_proposal_creations" ADD CONSTRAINT "agent_review_suggestion_proposal_creations_pkey" PRIMARY KEY (idempotency_key);

ALTER TABLE "agent_review_suggestion_proposal_decisions" ADD CONSTRAINT "agent_review_suggestion_proposal_decisions_pkey" PRIMARY KEY (idempotency_key);

ALTER TABLE "agent_review_suggestion_proposals" ADD CONSTRAINT "agent_review_suggestion_proposals_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_suggestions" ADD CONSTRAINT "agent_review_suggestions_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_review_thread_preferences" ADD CONSTRAINT "agent_review_thread_preferences_pkey" PRIMARY KEY (thread_id, user_email);

ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_pkey" PRIMARY KEY (run_id, seq);

ALTER TABLE "agent_run_outcome_daily" ADD CONSTRAINT "agent_run_outcome_daily_pkey" PRIMARY KEY (day, status, terminal_reason);

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_satisfaction_scores" ADD CONSTRAINT "agent_satisfaction_scores_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_team_run_queue" ADD CONSTRAINT "agent_team_run_queue_pkey" PRIMARY KEY (task_id);

ALTER TABLE "agent_tool_approval_policies" ADD CONSTRAINT "agent_tool_approval_policies_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_tool_approvals" ADD CONSTRAINT "agent_tool_approvals_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_tool_ledger" ADD CONSTRAINT "agent_tool_ledger_pkey" PRIMARY KEY (thread_id, tool_key);

ALTER TABLE "agent_trace_spans" ADD CONSTRAINT "agent_trace_spans_pkey" PRIMARY KEY (id);

ALTER TABLE "agent_trace_summaries" ADD CONSTRAINT "agent_trace_summaries_pkey" PRIMARY KEY (run_id);

ALTER TABLE "agent_turn_initiators" ADD CONSTRAINT "agent_turn_initiators_pkey" PRIMARY KEY (thread_id, turn_id);

ALTER TABLE "app_member_roles" ADD CONSTRAINT "app_member_roles_pkey" PRIMARY KEY (id);

ALTER TABLE "app_permission_overrides" ADD CONSTRAINT "app_permission_overrides_org_id_app_id_permission_key" UNIQUE (org_id, app_id, permission);

ALTER TABLE "app_resource_change_consumers" ADD CONSTRAINT "app_resource_change_consumers_pkey" PRIMARY KEY (app, resource_type, consumer);

ALTER TABLE "app_resource_changes" ADD CONSTRAINT "app_resource_changes_pkey" PRIMARY KEY (consumer, app, resource_type, resource_id);

ALTER TABLE "app_secrets" ADD CONSTRAINT "app_secrets_pkey" PRIMARY KEY (id);

ALTER TABLE "app_secrets" ADD CONSTRAINT "app_secrets_scope_scope_id_key_key" UNIQUE (scope, scope_id, key);

ALTER TABLE "application_state" ADD CONSTRAINT "application_state_pkey" PRIMARY KEY (session_id, key);

ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_pkey" PRIMARY KEY (id);

ALTER TABLE "automation_scheduler_health" ADD CONSTRAINT "automation_scheduler_health_pkey" PRIMARY KEY (id);

ALTER TABLE "automation_trigger_event_queue" ADD CONSTRAINT "automation_trigger_event_queue_pkey" PRIMARY KEY (id);

ALTER TABLE "automation_trigger_event_queue" ADD CONSTRAINT "automation_trigger_event_queue_sequence_id_key" UNIQUE (sequence_id);

ALTER TABLE "automation_trigger_event_queue_sweep_state" ADD CONSTRAINT "automation_trigger_event_queue_sweep_state_pkey" PRIMARY KEY (scope_key);

ALTER TABLE "automation_webhook_tokens" ADD CONSTRAINT "automation_webhook_tokens_automation_id_key" UNIQUE (automation_id);

ALTER TABLE "automation_webhook_tokens" ADD CONSTRAINT "automation_webhook_tokens_pkey" PRIMARY KEY (token_hash);

ALTER TABLE "chat_thread_shares" ADD CONSTRAINT "chat_thread_shares_pkey" PRIMARY KEY (id);

ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_pkey" PRIMARY KEY (id);

ALTER TABLE "context_directives" ADD CONSTRAINT "context_directives_pkey" PRIMARY KEY (id);

ALTER TABLE "custom_api_providers" ADD CONSTRAINT "custom_api_providers_pkey" PRIMARY KEY (scope, scope_id, id);

ALTER TABLE "data_program_runs" ADD CONSTRAINT "data_program_runs_pkey" PRIMARY KEY (id);

ALTER TABLE "data_program_shares" ADD CONSTRAINT "data_program_shares_pkey" PRIMARY KEY (id);

ALTER TABLE "data_programs" ADD CONSTRAINT "data_programs_pkey" PRIMARY KEY (id);

ALTER TABLE "email_log" ADD CONSTRAINT "email_log_pkey" PRIMARY KEY (id);

ALTER TABLE "identity_rekeys" ADD CONSTRAINT "identity_rekeys_pkey" PRIMARY KEY (id);

ALTER TABLE "identity_retired_emails" ADD CONSTRAINT "identity_retired_emails_pkey" PRIMARY KEY (email);

ALTER TABLE "identity_sso_flow_state" ADD CONSTRAINT "identity_sso_flow_state_pkey" PRIMARY KEY (state);

ALTER TABLE "identity_sso_jti" ADD CONSTRAINT "identity_sso_jti_pkey" PRIMARY KEY (jti);

ALTER TABLE "integration_a2a_continuations" ADD CONSTRAINT "integration_a2a_continuations_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_awaiting_inputs" ADD CONSTRAINT "integration_awaiting_inputs_pkey" PRIMARY KEY (platform, external_thread_id);

ALTER TABLE "integration_campaigns" ADD CONSTRAINT "integration_campaigns_integration_task_id_key" UNIQUE (integration_task_id);

ALTER TABLE "integration_campaigns" ADD CONSTRAINT "integration_campaigns_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_computer_approvals" ADD CONSTRAINT "integration_computer_approvals_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_pkey" PRIMARY KEY (platform, config_key);

ALTER TABLE "integration_controls" ADD CONSTRAINT "integration_controls_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_conversation_scopes" ADD CONSTRAINT "integration_conversation_scopes_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_identity_links" ADD CONSTRAINT "integration_identity_links_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_installations" ADD CONSTRAINT "integration_installations_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_pending_tasks" ADD CONSTRAINT "integration_pending_tasks_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_remote_commands" ADD CONSTRAINT "integration_remote_commands_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_remote_devices" ADD CONSTRAINT "integration_remote_devices_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_remote_push_notifications" ADD CONSTRAINT "integration_remote_push_notifications_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_remote_push_registrations" ADD CONSTRAINT "integration_remote_push_registrations_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_thread_mappings" ADD CONSTRAINT "integration_thread_mappings_pkey" PRIMARY KEY (platform, external_thread_id);

ALTER TABLE "integration_usage_budget_events" ADD CONSTRAINT "integration_usage_budget_events_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_usage_budget_windows" ADD CONSTRAINT "integration_usage_budget_windows_pkey" PRIMARY KEY (budget_id, window_start);

ALTER TABLE "integration_usage_budgets" ADD CONSTRAINT "integration_usage_budgets_pkey" PRIMARY KEY (id);

ALTER TABLE "integration_usage_reservations" ADD CONSTRAINT "integration_usage_reservations_pkey" PRIMARY KEY (id);

ALTER TABLE "invitation" ADD CONSTRAINT "invitation_pkey" PRIMARY KEY (id);

ALTER TABLE "jwks" ADD CONSTRAINT "jwks_pkey" PRIMARY KEY (id);

ALTER TABLE "mcp_action_approvals" ADD CONSTRAINT "mcp_action_approvals_pkey" PRIMARY KEY (nonce);

ALTER TABLE "mcp_connect_tokens" ADD CONSTRAINT "mcp_connect_tokens_jti_key" UNIQUE (jti);

ALTER TABLE "mcp_connect_tokens" ADD CONSTRAINT "mcp_connect_tokens_pkey" PRIMARY KEY (id);

ALTER TABLE "mcp_device_codes" ADD CONSTRAINT "mcp_device_codes_pkey" PRIMARY KEY (device_code);

ALTER TABLE "mcp_oauth_clients" ADD CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY (client_id);

ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_pkey" PRIMARY KEY (code);

ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_pkey" PRIMARY KEY (id);

ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_token_hash_key" UNIQUE (token_hash);

ALTER TABLE "member" ADD CONSTRAINT "member_pkey" PRIMARY KEY (id);

ALTER TABLE "notification_delivery_state" ADD CONSTRAINT "notification_delivery_state_pkey" PRIMARY KEY (notification_id, delivery_key);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);

ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY (provider, account_id);

ALTER TABLE "observational_memory" ADD CONSTRAINT "observational_memory_pkey" PRIMARY KEY (id);

ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_pkey" PRIMARY KEY (id);

ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_email_key" UNIQUE (org_id, email);

ALTER TABLE "org_members" ADD CONSTRAINT "org_members_pkey" PRIMARY KEY (id);

ALTER TABLE "org_scim_memberships" ADD CONSTRAINT "org_scim_memberships_org_id_user_id_key" UNIQUE (org_id, user_id);

ALTER TABLE "org_scim_memberships" ADD CONSTRAINT "org_scim_memberships_pkey" PRIMARY KEY (id);

ALTER TABLE "organization" ADD CONSTRAINT "organization_pkey" PRIMARY KEY (id);

ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_key" UNIQUE (slug);

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id);

ALTER TABLE "private_icon_assets" ADD CONSTRAINT "private_icon_assets_pkey" PRIMARY KEY (id);

ALTER TABLE "progress_runs" ADD CONSTRAINT "progress_runs_pkey" PRIMARY KEY (id);

ALTER TABLE "provider_api_cooldowns" ADD CONSTRAINT "provider_api_cooldowns_pkey" PRIMARY KEY (quota_key);

ALTER TABLE "provider_corpus_job_hits" ADD CONSTRAINT "provider_corpus_job_hits_pkey" PRIMARY KEY (job_id, hit_index);

ALTER TABLE "provider_corpus_jobs" ADD CONSTRAINT "provider_corpus_jobs_pkey" PRIMARY KEY (id);

ALTER TABLE "recap_images" ADD CONSTRAINT "recap_images_pkey" PRIMARY KEY (token);

ALTER TABLE "resource_access_requests" ADD CONSTRAINT "resource_access_requests_pkey" PRIMARY KEY (id);

ALTER TABLE "resources" ADD CONSTRAINT "resources_path_owner_key" UNIQUE (path, owner);

ALTER TABLE "resources" ADD CONSTRAINT "resources_pkey" PRIMARY KEY (id);

ALTER TABLE "sandbox_executions" ADD CONSTRAINT "sandbox_executions_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_connection_binding" ADD CONSTRAINT "scim_connection_binding_connection_key_key" UNIQUE (connection_key);

ALTER TABLE "scim_connection_binding" ADD CONSTRAINT "scim_connection_binding_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_display_name_key_key" UNIQUE (display_name_key);

ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_external_id_key_key" UNIQUE (external_id_key);

ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_order_key_key" UNIQUE (order_key);

ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_membership_key_key" UNIQUE (membership_key);

ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_identity_tombstone" ADD CONSTRAINT "scim_identity_tombstone_external_id_key_key" UNIQUE (external_id_key);

ALTER TABLE "scim_identity_tombstone" ADD CONSTRAINT "scim_identity_tombstone_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_managed_connection" ADD CONSTRAINT "scim_managed_connection_connection_id_key" UNIQUE (connection_id);

ALTER TABLE "scim_managed_connection" ADD CONSTRAINT "scim_managed_connection_creation_request_id_key" UNIQUE (creation_request_id);

ALTER TABLE "scim_managed_connection" ADD CONSTRAINT "scim_managed_connection_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_managed_connection_event" ADD CONSTRAINT "scim_managed_connection_event_event_key_key" UNIQUE (event_key);

ALTER TABLE "scim_managed_connection_event" ADD CONSTRAINT "scim_managed_connection_event_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_managed_credential" ADD CONSTRAINT "scim_managed_credential_active_slot_key_key" UNIQUE (active_slot_key);

ALTER TABLE "scim_managed_credential" ADD CONSTRAINT "scim_managed_credential_credential_id_key" UNIQUE (credential_id);

ALTER TABLE "scim_managed_credential" ADD CONSTRAINT "scim_managed_credential_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_projection_grant" ADD CONSTRAINT "scim_projection_grant_grant_key_key" UNIQUE (grant_key);

ALTER TABLE "scim_projection_grant" ADD CONSTRAINT "scim_projection_grant_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_subject" ADD CONSTRAINT "scim_subject_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_subject" ADD CONSTRAINT "scim_subject_user_id_key" UNIQUE (user_id);

ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_connection_user_key_key" UNIQUE (connection_user_key);

ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_external_id_key_key" UNIQUE (external_id_key);

ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_order_key_key" UNIQUE (order_key);

ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_pkey" PRIMARY KEY (id);

ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_user_name_key_key" UNIQUE (user_name_key);

ALTER TABLE "search_index_state" ADD CONSTRAINT "search_index_state_pkey" PRIMARY KEY (app, resource_type);

ALTER TABLE "search_resources" ADD CONSTRAINT "search_resources_pkey" PRIMARY KEY (app, resource_type, resource_id);

ALTER TABLE "service_principal_policies" ADD CONSTRAINT "service_principal_policies_pkey" PRIMARY KEY (org_id, service_name);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY (id);

ALTER TABLE "session" ADD CONSTRAINT "session_token_key" UNIQUE (token);

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_pkey" PRIMARY KEY (token);

ALTER TABLE "settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY (key);

ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_pkey" PRIMARY KEY (id);

ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_provider_id_key" UNIQUE (provider_id);

ALTER TABLE "staged_dataset_rows" ADD CONSTRAINT "staged_dataset_rows_pkey" PRIMARY KEY (dataset_id, row_index);

ALTER TABLE "staged_datasets" ADD CONSTRAINT "staged_datasets_pkey" PRIMARY KEY (id);

ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_pkey" PRIMARY KEY (id);

ALTER TABLE "sync_events_prune_state" ADD CONSTRAINT "sync_events_prune_state_pkey" PRIMARY KEY (id);

ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_pkey" PRIMARY KEY (id);

ALTER TABLE "tool_consents" ADD CONSTRAINT "tool_consents_pkey" PRIMARY KEY (viewer_email, tool_id, content_hash);

ALTER TABLE "tool_data" ADD CONSTRAINT "tool_data_pkey" PRIMARY KEY (id);

ALTER TABLE "tool_hidden_extensions" ADD CONSTRAINT "tool_hidden_extensions_pkey" PRIMARY KEY (id);

ALTER TABLE "tool_history" ADD CONSTRAINT "tool_history_pkey" PRIMARY KEY (id);

ALTER TABLE "tool_shares" ADD CONSTRAINT "tool_shares_pkey" PRIMARY KEY (id);

ALTER TABLE "tool_slot_installs" ADD CONSTRAINT "tool_slot_installs_pkey" PRIMARY KEY (id);

ALTER TABLE "tool_slots" ADD CONSTRAINT "tool_slots_pkey" PRIMARY KEY (id);

ALTER TABLE "tools" ADD CONSTRAINT "tools_pkey" PRIMARY KEY (id);

ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_pkey" PRIMARY KEY (id);

ALTER TABLE "usage_alert_events" ADD CONSTRAINT "usage_alert_events_pkey" PRIMARY KEY (id);

ALTER TABLE "usage_alert_rules" ADD CONSTRAINT "usage_alert_rules_pkey" PRIMARY KEY (id);

ALTER TABLE "user" ADD CONSTRAINT "user_email_key" UNIQUE (email);

ALTER TABLE "user" ADD CONSTRAINT "user_pkey" PRIMARY KEY (id);

ALTER TABLE "verification" ADD CONSTRAINT "verification_pkey" PRIMARY KEY (id);

ALTER TABLE "workspace_app_shares" ADD CONSTRAINT "workspace_app_shares_pkey" PRIMARY KEY (id);

ALTER TABLE "workspace_app_shares" ADD CONSTRAINT "workspace_app_shares_resource_id_principal_type_principal_i_key" UNIQUE (resource_id, principal_type, principal_id);

ALTER TABLE "workspace_apps" ADD CONSTRAINT "workspace_apps_pkey" PRIMARY KEY (id);

ALTER TABLE "workspace_connection_grants" ADD CONSTRAINT "workspace_connection_grants_pkey" PRIMARY KEY (id);

ALTER TABLE "workspace_connections" ADD CONSTRAINT "workspace_connections_pkey" PRIMARY KEY (id);

ALTER TABLE "workspace_user_groups" ADD CONSTRAINT "workspace_user_groups_pkey" PRIMARY KEY (id);

CREATE UNIQUE INDEX idx_a2a_tasks_org_scope_idempotency ON public.a2a_tasks USING btree (owner_scope, idempotency_key) WHERE ((owner_email IS NULL) AND (idempotency_key IS NOT NULL));

CREATE UNIQUE INDEX idx_a2a_tasks_owner_scope_idempotency ON public.a2a_tasks USING btree (owner_email, owner_scope, idempotency_key);

CREATE INDEX idx_a2a_tasks_recovery_created ON public.a2a_tasks USING btree (created_at) WHERE (status_state = ANY (ARRAY['submitted'::text, 'working'::text, 'processing'::text]));

CREATE INDEX agent_audit_log_access_owner_lower_idx ON public.agent_audit_log USING btree (lower(owner_email));

CREATE INDEX idx_audit_actor ON public.agent_audit_log USING btree (actor_email, created_at);

CREATE INDEX idx_audit_created ON public.agent_audit_log USING btree (created_at);

CREATE INDEX idx_audit_org ON public.agent_audit_log USING btree (org_id, created_at);

CREATE INDEX idx_audit_org_app ON public.agent_audit_log USING btree (org_id, app, created_at);

CREATE INDEX idx_audit_owner ON public.agent_audit_log USING btree (owner_email, created_at);

CREATE INDEX idx_audit_target ON public.agent_audit_log USING btree (target_type, target_id, created_at);

CREATE INDEX idx_audit_turn ON public.agent_audit_log USING btree (turn_id);

CREATE INDEX agent_checkpoints_run_idx ON public.agent_checkpoints USING btree (run_id);

CREATE INDEX agent_checkpoints_thread_created_idx ON public.agent_checkpoints USING btree (thread_id, created_at);

CREATE UNIQUE INDEX idx_eval_datasets_idempotency ON public.agent_eval_datasets USING btree (idempotency_key);

CREATE INDEX idx_evals_created ON public.agent_evals USING btree (created_at);

CREATE INDEX idx_evals_run ON public.agent_evals USING btree (run_id);

CREATE INDEX idx_evals_user ON public.agent_evals USING btree (user_id, created_at);

CREATE INDEX idx_experiment_results_exp ON public.agent_experiment_results USING btree (experiment_id);

CREATE INDEX idx_feedback_created ON public.agent_feedback USING btree (created_at);

CREATE UNIQUE INDEX idx_feedback_idempotency ON public.agent_feedback USING btree (user_id, idempotency_key);

CREATE INDEX idx_feedback_org_run_created ON public.agent_feedback USING btree (org_id, run_id, created_at DESC);

CREATE INDEX idx_feedback_org_source_created ON public.agent_feedback USING btree (org_id, source, created_at DESC);

CREATE INDEX idx_feedback_thread ON public.agent_feedback USING btree (thread_id);

CREATE INDEX idx_feedback_type_created ON public.agent_feedback USING btree (feedback_type, created_at);

CREATE INDEX idx_feedback_user ON public.agent_feedback USING btree (user_id, created_at);

CREATE INDEX idx_agent_harness_sessions_owner ON public.agent_harness_sessions USING btree (owner_email, updated_at);

CREATE INDEX idx_agent_harness_sessions_status ON public.agent_harness_sessions USING btree (status, updated_at);

CREATE INDEX idx_agent_harness_sessions_thread ON public.agent_harness_sessions USING btree (thread_id, updated_at);

CREATE INDEX idx_instruction_updates_run_user ON public.agent_instruction_updates USING btree (run_id, user_id, updated_at);

CREATE INDEX agent_native_browser_session_requests_pending_idx ON public.agent_native_browser_session_requests USING btree (owner_email, session_id, status, created_at);

CREATE INDEX agent_native_browser_sessions_owner_seen_idx ON public.agent_native_browser_sessions USING btree (owner_email, last_seen_at);

CREATE INDEX agent_resource_versions_access_owner_lower_idx ON public.agent_resource_versions USING btree (lower(owner_email));

CREATE INDEX idx_agent_resource_versions_org ON public.agent_resource_versions USING btree (org_id, created_at);

CREATE INDEX idx_agent_resource_versions_owner ON public.agent_resource_versions USING btree (owner_email, created_at);

CREATE UNIQUE INDEX idx_agent_resource_versions_resource_number ON public.agent_resource_versions USING btree (resource_type, resource_id, version_number);

CREATE INDEX agent_review_comments_access_owner_lower_idx ON public.agent_review_comments USING btree (lower(owner_email));

CREATE INDEX idx_agent_review_comments_org ON public.agent_review_comments USING btree (org_id, created_at);

CREATE INDEX idx_agent_review_comments_owner ON public.agent_review_comments USING btree (owner_email, created_at);

CREATE INDEX idx_agent_review_comments_queue ON public.agent_review_comments USING btree (resource_type, resource_id, parent_comment_id, resolution_target, consumed_at, created_at);

CREATE INDEX idx_agent_review_comments_resource ON public.agent_review_comments USING btree (resource_type, resource_id, created_at);

CREATE INDEX idx_agent_review_comments_thread ON public.agent_review_comments USING btree (thread_id, created_at);

CREATE INDEX agent_review_statuses_access_owner_lower_idx ON public.agent_review_statuses USING btree (lower(owner_email));

CREATE INDEX idx_agent_review_statuses_resource ON public.agent_review_statuses USING btree (resource_type, resource_id);

CREATE INDEX agent_review_suggestion_amendments_access_owner_lower_idx ON public.agent_review_suggestion_amendments USING btree (lower(owner_email));

CREATE INDEX idx_review_suggestion_operations ON public.agent_review_suggestion_operations USING btree (suggestion_id, ordinal);

CREATE INDEX agent_review_suggestions_access_owner_lower_idx ON public.agent_review_suggestions USING btree (lower(owner_email));

CREATE INDEX idx_review_suggestion_proposal_members ON public.agent_review_suggestions USING btree (proposal_id, created_at);

CREATE INDEX idx_review_suggestions_resource ON public.agent_review_suggestions USING btree (resource_type, resource_id, created_at);

CREATE INDEX idx_satisfaction_thread ON public.agent_satisfaction_scores USING btree (thread_id);

CREATE INDEX idx_satisfaction_user ON public.agent_satisfaction_scores USING btree (user_id, computed_at);

CREATE INDEX idx_agent_team_run_queue_reconciliation ON public.agent_team_run_queue USING btree (status, reconciliation_attempted_at, updated_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX idx_agent_team_run_queue_status ON public.agent_team_run_queue USING btree (status, updated_at);

CREATE INDEX idx_agent_tool_approval_policies_scope ON public.agent_tool_approval_policies USING btree (owner_email, org_id, tool_name, enabled);

CREATE INDEX idx_agent_tool_approvals_binding ON public.agent_tool_approvals USING btree (owner_email, org_id, thread_id, tool_name, call_id, status);

CREATE INDEX idx_agent_tool_approvals_logical ON public.agent_tool_approvals USING btree (owner_email, org_id, thread_id, turn_id, tool_name, approval_key_hash, status);

CREATE INDEX idx_agent_tool_approvals_recovery ON public.agent_tool_approvals USING btree (owner_email, org_id, thread_id, approval_key_hash, status, turn_id);

CREATE INDEX idx_trace_spans_created ON public.agent_trace_spans USING btree (created_at);

CREATE INDEX idx_trace_spans_org_run_type_status_created ON public.agent_trace_spans USING btree (org_id, run_id, span_type, status, created_at);

CREATE INDEX idx_trace_spans_org_type_name_run_id ON public.agent_trace_spans USING btree (org_id, span_type, name, run_id);

CREATE INDEX idx_trace_spans_run ON public.agent_trace_spans USING btree (run_id);

CREATE INDEX idx_trace_spans_thread ON public.agent_trace_spans USING btree (thread_id);

CREATE INDEX idx_trace_spans_type_name_run_id ON public.agent_trace_spans USING btree (span_type, name, run_id);

CREATE INDEX idx_trace_spans_user ON public.agent_trace_spans USING btree (user_id);

CREATE INDEX idx_trace_summaries_created ON public.agent_trace_summaries USING btree (created_at);

CREATE INDEX idx_trace_summaries_org_created ON public.agent_trace_summaries USING btree (org_id, created_at DESC);

CREATE INDEX idx_trace_summaries_thread_user_created ON public.agent_trace_summaries USING btree (thread_id, user_id, created_at);

CREATE INDEX idx_trace_summaries_user ON public.agent_trace_summaries USING btree (user_id, created_at);

CREATE UNIQUE INDEX app_member_roles_org_app_lower_email_role_uidx ON public.app_member_roles USING btree (org_id, app_id, lower(email), role);

CREATE INDEX app_resource_changes_failed_idx ON public.app_resource_changes USING btree (consumer, app, resource_type) WHERE (failed_at IS NOT NULL);

CREATE INDEX app_resource_changes_seq_idx ON public.app_resource_changes USING btree (consumer, app, resource_type, seq);

CREATE INDEX app_state_key_updated_idx ON public.application_state USING btree (key, updated_at);

CREATE INDEX app_state_updated_at_idx ON public.application_state USING btree (updated_at);

CREATE INDEX idx_automation_runs_owner_automation ON public.automation_runs USING btree (owner, automation, started_at);

CREATE INDEX idx_automation_scheduler_health_updated ON public.automation_scheduler_health USING btree (updated_at);

CREATE INDEX idx_automation_trigger_event_queue_active_head ON public.automation_trigger_event_queue USING btree (app_id, trigger_id, sequence_id) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));

CREATE INDEX idx_automation_trigger_event_queue_completed ON public.automation_trigger_event_queue USING btree (completed_at) WHERE (status = 'completed'::text);

CREATE UNIQUE INDEX idx_automation_trigger_event_queue_dedupe ON public.automation_trigger_event_queue USING btree (trigger_id, event_id);

CREATE INDEX idx_automation_trigger_event_queue_failed ON public.automation_trigger_event_queue USING btree (completed_at) WHERE (status = 'failed'::text);

CREATE INDEX idx_automation_trigger_event_queue_order ON public.automation_trigger_event_queue USING btree (trigger_id, sequence_id, status);

CREATE INDEX idx_automation_trigger_event_queue_ready ON public.automation_trigger_event_queue USING btree (app_id, status, available_at, claimed_at);

CREATE INDEX idx_automation_trigger_event_queue_stale_event ON public.automation_trigger_event_queue USING btree (app_id, event_name, emitted_at) WHERE (status = 'pending'::text);

CREATE INDEX chat_thread_shares_access_principal_idx ON public.chat_thread_shares USING btree (principal_type, principal_id);

CREATE INDEX chat_thread_shares_access_principal_lower_idx ON public.chat_thread_shares USING btree (principal_type, lower(principal_id));

CREATE INDEX chat_thread_shares_access_resource_idx ON public.chat_thread_shares USING btree (resource_id);

CREATE INDEX chat_thread_shares_principal_lower_idx ON public.chat_thread_shares USING btree (resource_id, principal_type, lower(principal_id));

CREATE INDEX chat_thread_shares_resource_idx ON public.chat_thread_shares USING btree (resource_id);

CREATE INDEX chat_threads_access_owner_lower_idx ON public.chat_threads USING btree (lower(owner_email));

CREATE INDEX chat_threads_owner_lower_updated_idx ON public.chat_threads USING btree (lower(owner_email), updated_at);

CREATE INDEX chat_threads_owner_updated_idx ON public.chat_threads USING btree (owner_email, updated_at);

CREATE INDEX chat_threads_scope_updated_idx ON public.chat_threads USING btree (scope_type, scope_id, updated_at);

CREATE INDEX chat_threads_share_token_idx ON public.chat_threads USING btree (share_token_hash);

CREATE INDEX chat_threads_source_updated_idx ON public.chat_threads USING btree (owner_email, source_app_id, updated_at);

CREATE INDEX context_directives_access_owner_lower_idx ON public.context_directives USING btree (lower(owner_email));

CREATE INDEX context_directives_thread_active_idx ON public.context_directives USING btree (thread_id, active);

CREATE INDEX context_directives_thread_segment_idx ON public.context_directives USING btree (thread_id, segment_id);

CREATE INDEX data_program_runs_lookup_idx ON public.data_program_runs USING btree (program_id, params_hash, finished_at);

CREATE INDEX data_program_shares_access_principal_idx ON public.data_program_shares USING btree (principal_type, principal_id);

CREATE INDEX data_program_shares_access_principal_lower_idx ON public.data_program_shares USING btree (principal_type, lower(principal_id));

CREATE INDEX data_program_shares_access_resource_idx ON public.data_program_shares USING btree (resource_id);

CREATE INDEX data_program_shares_resource_idx ON public.data_program_shares USING btree (resource_id);

CREATE INDEX data_programs_access_owner_lower_idx ON public.data_programs USING btree (lower(owner_email));

CREATE INDEX data_programs_app_name_idx ON public.data_programs USING btree (app_id, name);

CREATE INDEX data_programs_app_owner_idx ON public.data_programs USING btree (app_id, owner_email);

CREATE INDEX email_log_org_app_created_idx ON public.email_log USING btree (org_id, app, created_at);

CREATE INDEX email_log_org_provider_created_idx ON public.email_log USING btree (org_id, provider, created_at);

CREATE INDEX email_log_org_status_created_idx ON public.email_log USING btree (org_id, status, created_at);

CREATE INDEX email_log_template_created_idx ON public.email_log USING btree (template_id, created_at);

CREATE UNIQUE INDEX identity_rekeys_old_new_idx ON public.identity_rekeys USING btree (lower(old_email), lower(new_email));

CREATE INDEX identity_sso_flow_state_expires_idx ON public.identity_sso_flow_state USING btree (expires_at);

CREATE INDEX identity_sso_jti_seen_idx ON public.identity_sso_jti USING btree (seen_at);

CREATE INDEX idx_a2a_continuations_dedupe_key ON public.integration_a2a_continuations USING btree (integration_task_id, agent_url, dedupe_key);

CREATE INDEX idx_a2a_continuations_integration_task ON public.integration_a2a_continuations USING btree (integration_task_id);

CREATE UNIQUE INDEX idx_a2a_continuations_one_progress_owner ON public.integration_a2a_continuations USING btree (integration_task_id) WHERE (progress_ref_claimed = 1);

CREATE UNIQUE INDEX idx_a2a_continuations_remote_task ON public.integration_a2a_continuations USING btree (integration_task_id, agent_url, a2a_task_id);

CREATE INDEX idx_a2a_continuations_status_next ON public.integration_a2a_continuations USING btree (status, next_check_at);

CREATE INDEX idx_integration_campaigns_due ON public.integration_campaigns USING btree (status, next_run_at);

CREATE INDEX idx_integration_campaigns_lease ON public.integration_campaigns USING btree (status, lease_expires_at);

CREATE INDEX idx_computer_approvals_binding ON public.integration_computer_approvals USING btree (device_id, task_id, run_id, action_hash);

CREATE INDEX idx_computer_approvals_owner ON public.integration_computer_approvals USING btree (owner_email, org_id, updated_at);

CREATE INDEX idx_integration_controls_expiry ON public.integration_controls USING btree (status, expires_at);

CREATE UNIQUE INDEX idx_integration_scope_external_key ON public.integration_conversation_scopes USING btree (platform, tenant_id, conversation_id);

CREATE INDEX idx_integration_scope_org ON public.integration_conversation_scopes USING btree (org_id, platform, tenant_id);

CREATE INDEX idx_integration_scope_owner ON public.integration_conversation_scopes USING btree (owner_email, platform, tenant_id);

CREATE INDEX idx_integration_identity_links_account ON public.integration_identity_links USING btree (org_id, user_email);

CREATE UNIQUE INDEX idx_integration_identity_links_external ON public.integration_identity_links USING btree (platform, tenant_id, external_user_id);

CREATE UNIQUE INDEX idx_integration_installations_key ON public.integration_installations USING btree (platform, installation_key);

CREATE INDEX idx_integration_installations_org ON public.integration_installations USING btree (org_id, updated_at);

CREATE INDEX idx_integration_installations_owner ON public.integration_installations USING btree (owner_email, updated_at);

CREATE INDEX idx_integration_installations_team ON public.integration_installations USING btree (platform, team_id, status);

CREATE INDEX idx_pending_tasks_dispatch_scope ON public.integration_pending_tasks USING btree (platform, dispatch_scope);

CREATE UNIQUE INDEX idx_pending_tasks_event_key ON public.integration_pending_tasks USING btree (platform, external_event_key);

CREATE INDEX idx_pending_tasks_status_created ON public.integration_pending_tasks USING btree (status, created_at);

CREATE UNIQUE INDEX idx_remote_commands_computer_sequence ON public.integration_remote_commands USING btree (device_id, computer_task_id, computer_run_id, computer_sequence);

CREATE INDEX idx_remote_commands_device_status_next ON public.integration_remote_commands USING btree (device_id, status, next_check_at);

CREATE UNIQUE INDEX idx_remote_commands_idempotency ON public.integration_remote_commands USING btree (device_id, idempotency_key);

CREATE INDEX idx_remote_commands_owner ON public.integration_remote_commands USING btree (owner_email, org_id);

CREATE INDEX idx_remote_devices_owner ON public.integration_remote_devices USING btree (owner_email, org_id);

CREATE UNIQUE INDEX idx_remote_devices_token_hash ON public.integration_remote_devices USING btree (device_token_hash);

CREATE INDEX idx_remote_push_notifications_delivery ON public.integration_remote_push_notifications USING btree (status, next_attempt_at, updated_at);

CREATE INDEX idx_remote_push_notifications_owner ON public.integration_remote_push_notifications USING btree (owner_email, org_id, status, created_at);

CREATE INDEX idx_remote_push_owner ON public.integration_remote_push_registrations USING btree (owner_email, org_id, status);

CREATE UNIQUE INDEX idx_remote_push_token_hash ON public.integration_remote_push_registrations USING btree (token_hash);

CREATE INDEX idx_remote_run_events_run ON public.integration_remote_run_events USING btree (device_id, remote_run_id, seq);

CREATE UNIQUE INDEX idx_remote_run_events_unique ON public.integration_remote_run_events USING btree (device_id, remote_run_id, seq);

CREATE UNIQUE INDEX idx_integration_budget_event_window ON public.integration_usage_budget_events USING btree (budget_id, window_start, threshold_bps);

CREATE INDEX idx_integration_budget_org ON public.integration_usage_budgets USING btree (org_id, subject_type);

CREATE INDEX idx_integration_budget_owner ON public.integration_usage_budgets USING btree (owner_email, subject_type);

CREATE UNIQUE INDEX idx_integration_budget_subject ON public.integration_usage_budgets USING btree (partition_key, subject_type, subject_id, period);

CREATE INDEX idx_integration_reservation_budget ON public.integration_usage_reservations USING btree (budget_id, window_start, status);

CREATE INDEX idx_notifications_owner_unread ON public.notifications USING btree (owner, read_at);

CREATE INDEX observational_memory_access_owner_lower_idx ON public.observational_memory USING btree (lower(owner_email));

CREATE INDEX observational_memory_thread_owner_idx ON public.observational_memory USING btree (thread_id, owner_email);

CREATE INDEX observational_memory_thread_tier_idx ON public.observational_memory USING btree (thread_id, tier, created_at);

CREATE INDEX org_members_lower_email_idx ON public.org_members USING btree (lower(email));

CREATE UNIQUE INDEX org_members_org_lower_email_uidx ON public.org_members USING btree (org_id, lower(email));

CREATE UNIQUE INDEX organizations_identity_uidx ON public.organizations USING btree (identity_authority, identity_id);

CREATE INDEX organizations_lower_allowed_domain_idx ON public.organizations USING btree (lower(allowed_domain));

CREATE INDEX private_icon_assets_owner_org_created_idx ON public.private_icon_assets USING btree (owner_email, org_id, created_at);

CREATE INDEX idx_progress_runs_owner_status ON public.progress_runs USING btree (owner, status, started_at);

CREATE INDEX provider_api_cooldowns_provider_idx ON public.provider_api_cooldowns USING btree (provider_id, cooldown_until);

CREATE INDEX provider_corpus_job_hits_job_idx ON public.provider_corpus_job_hits USING btree (job_id);

CREATE INDEX provider_corpus_jobs_scope_idx ON public.provider_corpus_jobs USING btree (app_id, owner_email, updated_at);

CREATE INDEX provider_corpus_jobs_status_idx ON public.provider_corpus_jobs USING btree (app_id, owner_email, status);

CREATE INDEX idx_resource_access_requests_owner_recent ON public.resource_access_requests USING btree (owner_email, requested_at);

CREATE UNIQUE INDEX idx_resource_access_requests_requester ON public.resource_access_requests USING btree (resource_type, resource_id, requester_email);

CREATE INDEX idx_resource_access_requests_requester_recent ON public.resource_access_requests USING btree (requester_email, requested_at);

CREATE INDEX resources_path_pattern_idx ON public.resources USING btree (path text_pattern_ops);

CREATE INDEX resources_visibility_expires_idx ON public.resources USING btree (visibility, expires_at);

CREATE INDEX sandbox_executions_due_idx ON public.sandbox_executions USING btree (status, lease_expires_at);

CREATE INDEX sandbox_executions_owner_created_idx ON public.sandbox_executions USING btree (owner, created_at);

CREATE INDEX scim_connection_binding_connection_idx ON public.scim_connection_binding USING btree (connection_id);

CREATE INDEX scim_group_connection_idx ON public.scim_group USING btree (connection_id);

CREATE INDEX scim_group_domain_idx ON public.scim_group USING btree (provisioning_domain_id);

CREATE INDEX scim_group_member_connection_idx ON public.scim_group_member USING btree (connection_id);

CREATE INDEX scim_group_member_group_idx ON public.scim_group_member USING btree (group_id);

CREATE INDEX scim_group_member_user_idx ON public.scim_group_member USING btree (scim_user_id);

CREATE INDEX scim_identity_tombstone_connection_idx ON public.scim_identity_tombstone USING btree (connection_id);

CREATE INDEX scim_identity_tombstone_domain_idx ON public.scim_identity_tombstone USING btree (provisioning_domain_id);

CREATE INDEX scim_identity_tombstone_user_idx ON public.scim_identity_tombstone USING btree (user_id);

CREATE INDEX scim_managed_connection_domain_idx ON public.scim_managed_connection USING btree (provisioning_domain_id);

CREATE INDEX scim_managed_connection_event_connection_idx ON public.scim_managed_connection_event USING btree (connection_record_id);

CREATE INDEX scim_managed_credential_connection_idx ON public.scim_managed_credential USING btree (connection_record_id);

CREATE INDEX scim_projection_grant_connection_idx ON public.scim_projection_grant USING btree (connection_id);

CREATE INDEX scim_projection_grant_domain_idx ON public.scim_projection_grant USING btree (provisioning_domain_id);

CREATE INDEX scim_projection_grant_scim_user_idx ON public.scim_projection_grant USING btree (scim_user_id);

CREATE INDEX scim_projection_grant_user_idx ON public.scim_projection_grant USING btree (user_id);

CREATE INDEX scim_subject_profile_source_idx ON public.scim_subject USING btree (profile_source_id);

CREATE INDEX scim_user_better_auth_user_idx ON public.scim_user USING btree (user_id);

CREATE INDEX scim_user_connection_idx ON public.scim_user USING btree (connection_id);

CREATE INDEX scim_user_domain_idx ON public.scim_user USING btree (provisioning_domain_id);

CREATE INDEX search_resources_doc_vector_gin ON public.search_resources USING gin (doc_vector);

CREATE INDEX settings_updated_at_idx ON public.settings USING btree (updated_at);

CREATE INDEX staged_dataset_rows_dataset_idx ON public.staged_dataset_rows USING btree (dataset_id);

CREATE INDEX staged_datasets_scope_idx ON public.staged_datasets USING btree (app_id, owner_email);

CREATE INDEX sync_events_version_idx ON public.sync_events USING btree (version);

CREATE INDEX idx_token_usage_lower_owner_created ON public.token_usage USING btree (lower(owner_email), created_at);

CREATE INDEX idx_token_usage_org_app_created ON public.token_usage USING btree (org_id, lower(app), created_at);

CREATE INDEX idx_token_usage_owner_created ON public.token_usage USING btree (owner_email, created_at);

CREATE INDEX idx_token_usage_run_id ON public.token_usage USING btree (run_id) WHERE (run_id IS NOT NULL);

CREATE INDEX tool_consents_viewer_idx ON public.tool_consents USING btree (viewer_email, tool_id);

CREATE UNIQUE INDEX tool_data_scoped_item_idx ON public.tool_data USING btree (tool_id, collection, scope_key, item_id);

CREATE INDEX tool_hidden_extensions_owner_idx ON public.tool_hidden_extensions USING btree (owner_email);

CREATE UNIQUE INDEX tool_hidden_extensions_user_tool_idx ON public.tool_hidden_extensions USING btree (owner_email, tool_id);

CREATE INDEX tool_history_access_owner_lower_idx ON public.tool_history USING btree (lower(owner_email));

CREATE INDEX tool_history_tool_created_idx ON public.tool_history USING btree (tool_id, created_at);

CREATE UNIQUE INDEX tool_history_tool_version_idx ON public.tool_history USING btree (tool_id, version);

CREATE INDEX tool_shares_access_principal_idx ON public.tool_shares USING btree (principal_type, principal_id);

CREATE INDEX tool_shares_access_principal_lower_idx ON public.tool_shares USING btree (principal_type, lower(principal_id));

CREATE INDEX tool_shares_access_resource_idx ON public.tool_shares USING btree (resource_id);

CREATE INDEX tool_shares_resource_idx ON public.tool_shares USING btree (resource_id);

CREATE INDEX tool_slot_installs_by_user_slot_idx ON public.tool_slot_installs USING btree (owner_email, slot_id);

CREATE UNIQUE INDEX tool_slot_installs_unique_idx ON public.tool_slot_installs USING btree (owner_email, tool_id, slot_id);

CREATE INDEX tool_slots_by_slot_idx ON public.tool_slots USING btree (slot_id);

CREATE INDEX tool_slots_by_tool_idx ON public.tool_slots USING btree (tool_id);

CREATE UNIQUE INDEX tool_slots_unique_idx ON public.tool_slots USING btree (tool_id, slot_id);

CREATE INDEX tools_access_owner_lower_idx ON public.tools USING btree (lower(owner_email));

CREATE INDEX tools_archived_at_idx ON public.tools USING btree (archived_at);

CREATE INDEX tools_hidden_at_idx ON public.tools USING btree (hidden_at);

CREATE INDEX tools_org_idx ON public.tools USING btree (org_id);

CREATE INDEX tools_owner_idx ON public.tools USING btree (owner_email);

CREATE INDEX tools_updated_at_idx ON public.tools USING btree (updated_at);

CREATE INDEX "twoFactor_secret_idx" ON public."twoFactor" USING btree (secret);

CREATE INDEX "twoFactor_user_id_idx" ON public."twoFactor" USING btree (user_id);

CREATE UNIQUE INDEX idx_usage_alert_events_rule_window ON public.usage_alert_events USING btree (rule_id, window_start);

CREATE INDEX idx_usage_alert_rules_owner ON public.usage_alert_rules USING btree (owner_email, org_id, scope);

CREATE INDEX better_auth_user_lower_email_idx ON public."user" USING btree (lower(email));

CREATE INDEX workspace_app_shares_access_principal_idx ON public.workspace_app_shares USING btree (principal_type, principal_id);

CREATE INDEX workspace_app_shares_access_principal_lower_idx ON public.workspace_app_shares USING btree (principal_type, lower(principal_id));

CREATE INDEX workspace_app_shares_access_resource_idx ON public.workspace_app_shares USING btree (resource_id);

CREATE INDEX workspace_apps_access_owner_lower_idx ON public.workspace_apps USING btree (lower(owner_email));

CREATE INDEX workspace_apps_org_visibility_idx ON public.workspace_apps USING btree (org_id, visibility);

CREATE UNIQUE INDEX idx_workspace_connection_grants_connection_app ON public.workspace_connection_grants USING btree (connection_id, app_id);

CREATE INDEX idx_workspace_connection_grants_scope_app ON public.workspace_connection_grants USING btree (org_id, owner_email, app_id);

CREATE INDEX idx_workspace_connection_grants_updated_at ON public.workspace_connection_grants USING btree (updated_at);

CREATE INDEX idx_workspace_connections_scope_provider ON public.workspace_connections USING btree (org_id, owner_email, provider);

CREATE INDEX idx_workspace_connections_updated_at ON public.workspace_connections USING btree (updated_at);

CREATE UNIQUE INDEX idx_workspace_user_groups_org_normalized_name ON public.workspace_user_groups USING btree (org_id, normalized_name) WHERE (normalized_name IS NOT NULL);

CREATE INDEX idx_workspace_user_groups_org_updated ON public.workspace_user_groups USING btree (org_id, updated_at);

CREATE OR REPLACE FUNCTION public.agent_native_app_resource_changed(p_app text, p_resource_type text, p_resource_id text, p_reason text)
 RETURNS void
 LANGUAGE sql
AS $function$
    INSERT INTO app_resource_changes AS existing
      (consumer, app, resource_type, resource_id, reason, seq, changed_at, available_at, attempts, failed_at)
    SELECT consumer, p_app, p_resource_type, p_resource_id, p_reason,
      nextval('app_resource_change_seq'), clock_timestamp(), clock_timestamp(), 0, NULL
    FROM app_resource_change_consumers
    WHERE app = p_app AND resource_type = p_resource_type
    ON CONFLICT (consumer, app, resource_type, resource_id) DO UPDATE SET
      reason = EXCLUDED.reason,
      seq = nextval('app_resource_change_seq'),
      changed_at = EXCLUDED.changed_at,
      available_at = EXCLUDED.available_at,
      attempts = 0,
      failed_at = NULL
  $function$;

CREATE OR REPLACE FUNCTION public.workspace_user_groups_set_normalized_name()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$BEGIN
        NEW.normalized_name := LOWER(BTRIM(NEW.name));
        RETURN NEW;
      END;$function$;

CREATE TRIGGER trg_workspace_user_groups_normalized_name BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups FOR EACH ROW EXECUTE FUNCTION workspace_user_groups_set_normalized_name();

INSERT INTO "_agent_harness_session_migrations" ("version") VALUES (1);

INSERT INTO "_agent_harness_session_migrations" ("version") VALUES (2);

INSERT INTO "_agent_harness_session_migrations" ("version") VALUES (3);

INSERT INTO "_agent_harness_session_migrations" ("version") VALUES (4);

INSERT INTO "_agent_run_migrations" ("version") VALUES (1);

INSERT INTO "_agent_run_migrations" ("version") VALUES (2);

INSERT INTO "_agent_run_migrations" ("version") VALUES (3);

INSERT INTO "_agent_run_migrations" ("version") VALUES (4);

INSERT INTO "_agent_run_migrations" ("version") VALUES (5);

INSERT INTO "_agent_run_migrations" ("version") VALUES (6);

INSERT INTO "_agent_tool_approval_migrations" ("version") VALUES (1);

INSERT INTO "_agent_tool_approval_migrations" ("version") VALUES (2);

INSERT INTO "_agent_tool_approval_migrations" ("version") VALUES (3);

INSERT INTO "_agent_tool_approval_migrations" ("version") VALUES (4);

INSERT INTO "_automation_run_migrations" ("version") VALUES (1);

INSERT INTO "_automation_run_migrations" ("version") VALUES (2);

INSERT INTO "_automation_run_migrations" ("version") VALUES (3);

INSERT INTO "_automation_run_migrations" ("version") VALUES (4);

INSERT INTO "_automation_run_migrations" ("version") VALUES (5);

INSERT INTO "_automation_run_migrations" ("version") VALUES (6);

INSERT INTO "_automation_run_migrations" ("version") VALUES (7);

INSERT INTO "_automation_run_migrations" ("version") VALUES (8);

INSERT INTO "_automation_scheduler_health_migrations" ("version") VALUES (1);

INSERT INTO "_automation_scheduler_health_migrations" ("version") VALUES (2);

INSERT INTO "_automation_trigger_event_migrations" ("version") VALUES (1);

INSERT INTO "_automation_trigger_event_migrations" ("version") VALUES (2);

INSERT INTO "_automation_trigger_event_migrations" ("version") VALUES (3);

INSERT INTO "_automation_trigger_event_migrations" ("version") VALUES (4);

INSERT INTO "_automation_trigger_event_migrations" ("version") VALUES (5);

INSERT INTO "_better_auth_migrations" ("version") VALUES (1);

INSERT INTO "_better_auth_migrations" ("version") VALUES (2);

INSERT INTO "_better_auth_migrations" ("version") VALUES (3);

INSERT INTO "_better_auth_migrations" ("version") VALUES (4);

INSERT INTO "_better_auth_migrations" ("version") VALUES (5);

INSERT INTO "_better_auth_migrations" ("version") VALUES (6);

INSERT INTO "_better_auth_migrations" ("version") VALUES (7);

INSERT INTO "_better_auth_migrations" ("version") VALUES (8);

INSERT INTO "_better_auth_migrations" ("version") VALUES (9);

INSERT INTO "_better_auth_migrations" ("version") VALUES (10);

INSERT INTO "_chat_thread_schema_migrations" ("version") VALUES (1);

INSERT INTO "_chat_thread_schema_migrations" ("version") VALUES (2);

INSERT INTO "_chat_thread_schema_migrations" ("version") VALUES (3);

INSERT INTO "_chat_thread_schema_migrations" ("version") VALUES (4);

INSERT INTO "_context_xray_migrations" ("version") VALUES (1201);

INSERT INTO "_context_xray_migrations" ("version") VALUES (1202);

INSERT INTO "_context_xray_migrations" ("version") VALUES (1203);

INSERT INTO "_identity_sso_migrations" ("version") VALUES (1);

INSERT INTO "_identity_sso_migrations" ("version") VALUES (2);

INSERT INTO "_oauth_token_migrations" ("version") VALUES (1);

INSERT INTO "_oauth_token_migrations" ("version") VALUES (2);

INSERT INTO "_oauth_token_migrations" ("version") VALUES (3);

INSERT INTO "_oauth_token_migrations" ("version") VALUES (4);

INSERT INTO "_oauth_token_migrations" ("version") VALUES (5);

INSERT INTO "_oauth_token_migrations" ("version") VALUES (6);

INSERT INTO "_observability_migrations" ("version") VALUES (1);

INSERT INTO "_observability_migrations" ("version") VALUES (2);

INSERT INTO "_observability_migrations" ("version") VALUES (3);

INSERT INTO "_observational_memory_migrations" ("version") VALUES (1);

INSERT INTO "_observational_memory_migrations" ("version") VALUES (2);

INSERT INTO "_observational_memory_migrations" ("version") VALUES (3);

INSERT INTO "_org_migrations" ("version") VALUES (1001);

INSERT INTO "_org_migrations" ("version") VALUES (1002);

INSERT INTO "_org_migrations" ("version") VALUES (1003);

INSERT INTO "_org_migrations" ("version") VALUES (1004);

INSERT INTO "_org_migrations" ("version") VALUES (1005);

INSERT INTO "_org_migrations" ("version") VALUES (1006);

INSERT INTO "_org_migrations" ("version") VALUES (1007);

INSERT INTO "_org_migrations" ("version") VALUES (1008);

INSERT INTO "_org_migrations" ("version") VALUES (1009);

INSERT INTO "_org_migrations" ("version") VALUES (1010);

INSERT INTO "_org_migrations" ("version") VALUES (1011);

INSERT INTO "_org_migrations" ("version") VALUES (1012);

INSERT INTO "_org_migrations" ("version") VALUES (1013);

INSERT INTO "_org_migrations" ("version") VALUES (1014);

INSERT INTO "_org_migrations" ("version") VALUES (1015);

INSERT INTO "_org_migrations" ("version") VALUES (1016);

INSERT INTO "_org_migrations" ("version") VALUES (1017);

INSERT INTO "_org_migrations" ("version") VALUES (1018);

INSERT INTO "_org_migrations" ("version") VALUES (1019);

INSERT INTO "_org_migrations" ("version") VALUES (1020);

INSERT INTO "_org_migrations" ("version") VALUES (1021);

INSERT INTO "_org_migrations" ("version") VALUES (1022);

INSERT INTO "_org_migrations" ("version") VALUES (1023);

INSERT INTO "_org_migrations" ("version") VALUES (1024);

INSERT INTO "_org_migrations" ("version") VALUES (1025);

INSERT INTO "_org_migrations" ("version") VALUES (1026);

INSERT INTO "_org_migrations" ("version") VALUES (1027);

INSERT INTO "_org_migrations" ("version") VALUES (1028);

INSERT INTO "_org_migrations" ("version") VALUES (1029);

INSERT INTO "_org_migrations" ("version") VALUES (1030);

INSERT INTO "_org_migrations" ("version") VALUES (1031);

INSERT INTO "_org_migrations" ("version") VALUES (1032);

INSERT INTO "_org_migrations" ("version") VALUES (1033);

INSERT INTO "_org_migrations" ("version") VALUES (1034);

INSERT INTO "_remote_device_migrations" ("version") VALUES (1);

INSERT INTO "_usage_alert_migrations" ("version") VALUES (1);

INSERT INTO "_usage_alert_migrations" ("version") VALUES (2);

INSERT INTO "_usage_alert_migrations" ("version") VALUES (3);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (1);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (2);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (3);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (4);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (5);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (6);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (7);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (8);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (9);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (10);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (11);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (12);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (13);

INSERT INTO "_workspace_connections_migrations" ("version") VALUES (14);
