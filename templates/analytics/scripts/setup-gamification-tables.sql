-- Data Dictionary Gamification Tables
-- Run these in BigQuery console to set up tracking infrastructure

-- Track all Notion contributions (edits to data dictionary)
CREATE TABLE IF NOT EXISTS `builder-3b0a2.logs.data_dictionary_contributions` (
  id STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  metric_name STRING,
  metric_id STRING,  -- Notion page ID
  user_email STRING,
  user_id STRING,  -- Firebase UID (if mapped)
  user_persona STRING,  -- 'analytics', 'dept_head', 'regular'
  contribution_type STRING,  -- 'QueryTemplate', 'CommonQuestions', 'Definition', etc.
  old_value STRING,
  new_value STRING,
  points_earned INT64,
  is_stale_update BOOL,  -- was metric >90 days old?
  department STRING
)
PARTITION BY DATE(timestamp)
CLUSTER BY user_email, contribution_type, metric_name;

-- Track quality validations (from regular users)
CREATE TABLE IF NOT EXISTS `builder-3b0a2.logs.metric_validations` (
  id STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  metric_name STRING,
  metric_id STRING,
  user_email STRING,
  user_id STRING,
  rating STRING,  -- 'accurate', 'mostly_accurate', 'needs_review'
  comment STRING,
  tags ARRAY<STRING>,  -- ['data_stale', 'wrong_values', 'missing_data']
  points_earned INT64,
  has_data_preview BOOL  -- did user view data before validating?
)
PARTITION BY DATE(timestamp)
CLUSTER BY user_email, metric_name, rating;

-- Track persona assignments
CREATE TABLE IF NOT EXISTS `builder-3b0a2.logs.persona_assignments` (
  id STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  user_email STRING,
  user_id STRING,
  persona STRING,
  previous_persona STRING,  -- if changed
  department STRING
)
PARTITION BY DATE(timestamp)
CLUSTER BY user_email;

-- User points cache (for fast leaderboard queries)
CREATE TABLE IF NOT EXISTS `builder-3b0a2.logs.user_points` (
  user_email STRING NOT NULL,
  user_id STRING,
  total_points INT64,
  week_points INT64,
  month_points INT64,
  contribution_count INT64,
  validation_count INT64,
  last_contribution_at TIMESTAMP,
  persona STRING,
  department STRING,
  updated_at TIMESTAMP
)
CLUSTER BY user_email;
