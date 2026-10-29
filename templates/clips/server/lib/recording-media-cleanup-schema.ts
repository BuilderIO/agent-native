// guard:allow-unscoped — integrity triggers enforce cross-owner deletion/reference fences and return no recording data.
const cleanupDdl = `
CREATE TABLE IF NOT EXISTS recording_media_cleanups (
  id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT, storage_mode TEXT,
  allowance_user_id TEXT, manifest TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  lease_token TEXT, lease_until TEXT, accounting_settled BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recording_media_cleanup_due_idx ON recording_media_cleanups(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS recording_media_cleanup_owner_idx ON recording_media_cleanups(owner_email,created_at);
CREATE TABLE IF NOT EXISTS recording_media_cleanup_objects (
  recording_id TEXT NOT NULL, object_key TEXT NOT NULL, owner_email TEXT NOT NULL,
  provider TEXT NOT NULL, payload TEXT, phase TEXT NOT NULL DEFAULT 'pending', last_provider_phase TEXT, reason TEXT,
  http_status INTEGER, serving_status INTEGER, deletion_claimed BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (recording_id,object_key)
);
CREATE INDEX IF NOT EXISTS recording_media_cleanup_object_idx ON recording_media_cleanup_objects(object_key,deletion_claimed);
CREATE TABLE IF NOT EXISTS recording_media_producers (
  id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, owner_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', payload TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recording_media_producer_recording_idx ON recording_media_producers(recording_id,status);

CREATE OR REPLACE FUNCTION clips_media_url_path(raw TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE path TEXT; segment TEXT; segments TEXT[] := '{}'; decoded BYTEA := ''::bytea; position INTEGER := 1; octet TEXT;
BEGIN
  path := regexp_replace(split_part(split_part(raw,'?',1),'#',1),'^https?:/*[^/]*','');
  FOREACH segment IN ARRAY string_to_array(path,'/') LOOP
    IF regexp_replace(segment,'%2[eE]','.','g') = '.' THEN CONTINUE;
    ELSIF regexp_replace(segment,'%2[eE]','.','g') = '..' THEN
      segments := segments[1:greatest(coalesce(array_length(segments,1),0)-1,1)];
    ELSE segments := array_append(segments,segment);
    END IF;
  END LOOP;
  path := array_to_string(segments,'/');
  WHILE position <= length(path) LOOP
    IF substr(path,position,1) = '%' THEN
      octet := substr(path,position+1,2);
      IF octet !~ '^[0-9A-Fa-f]{2}$' THEN RAISE EXCEPTION 'Media path encoding is unreadable'; END IF;
      decoded := decoded || decode(octet,'hex');
      position := position+3;
    ELSE
      decoded := decoded || convert_to(substr(path,position,1),'UTF8');
      position := position+1;
    END IF;
  END LOOP;
  RETURN convert_from(decoded,'UTF8');
END $$;

CREATE OR REPLACE FUNCTION clips_media_object_key(raw TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE path TEXT; parts TEXT[];
BEGIN
  raw := replace(regexp_replace(translate(raw,chr(9)||chr(10)||chr(13),''),'^[[:cntrl:] ]+|[[:cntrl:] ]+$','','g'),E'\\\\','/');
  IF lower(left(raw,6)) = 'https:' THEN raw := 'https:' || substr(raw,7);
  ELSIF lower(left(raw,5)) = 'http:' THEN raw := 'http:' || substr(raw,6);
  ELSE RETURN NULL;
  END IF;
  path := regexp_replace(split_part(split_part(raw,'?',1),'#',1),'%2[fF]','/','g');
  IF path ~ '^https://cdn\\.builder\\.io/' THEN
    parts := regexp_match(path,'/assets/([A-Za-z0-9_-]{8,128})/([a-f0-9]{32})(/compressed|-original)?$');
    IF parts IS NOT NULL THEN RETURN 'builder:' || parts[1] || ':' || parts[2]; END IF;
  END IF;
  parts := regexp_match(clips_media_url_path(raw),'/(clips/[^/]+(?:/[^/]+)?)$');
  IF parts IS NOT NULL THEN RETURN 's3:' || parts[1]; END IF;
  RETURN regexp_replace(path,'^https?://','url:');
END $$;

CREATE OR REPLACE FUNCTION clips_media_keys(document JSONB) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; result TEXT[] := '{}'; key TEXT; edits JSONB;
BEGIN
  FOR item IN SELECT jsonb_path_query(document, '$.** ? (@.type() == "string")') LOOP
    key := clips_media_object_key(item #>> '{}');
    IF key IS NOT NULL THEN result := array_append(result,key); END IF;
  END LOOP;
  IF document ? 'edits_json' THEN
    edits := (document->>'edits_json')::jsonb;
    result := result || clips_media_keys(edits);
  END IF;
  RETURN ARRAY(SELECT DISTINCT value FROM unnest(result) AS value ORDER BY value);
END $$;

CREATE OR REPLACE FUNCTION clips_fence_deleted_media() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE key TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM recording_media_cleanups WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'Recording permanently deleted';
  END IF;
  FOR key IN SELECT unnest(clips_media_keys(to_jsonb(NEW))) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('clips-media:' || key,0));
    IF EXISTS (SELECT 1 FROM recording_media_cleanup_objects WHERE object_key=key AND deletion_claimed) THEN
      RAISE EXCEPTION 'Recording media is being deleted';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER clips_recording_media_fence BEFORE INSERT OR UPDATE OF video_url,thumbnail_url,animated_thumbnail_url,filmstrip_url,image_url,base_image_url,edits_json ON recordings FOR EACH ROW EXECUTE FUNCTION clips_fence_deleted_media();

CREATE OR REPLACE FUNCTION clips_fence_deleted_frame_media() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE key TEXT;
BEGIN
  PERFORM id FROM recordings WHERE id=NEW.recording_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recording permanently deleted'; END IF;
  key := clips_media_object_key(NEW.storage_url);
  IF key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('clips-media:' || key,0));
    IF EXISTS (SELECT 1 FROM recording_media_cleanup_objects WHERE object_key=key AND deletion_claimed) THEN
      RAISE EXCEPTION 'Recording media is being deleted';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER clips_recording_frame_media_fence BEFORE INSERT OR UPDATE OF storage_url ON recording_agent_frames FOR EACH ROW EXECUTE FUNCTION clips_fence_deleted_frame_media();

CREATE OR REPLACE FUNCTION clips_fence_deleted_activity_media() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE key TEXT; handle JSONB;
BEGIN
  PERFORM id FROM recordings WHERE id=NEW.recording_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recording permanently deleted'; END IF;
  IF NEW.app_activity_blob_json IS NOT NULL THEN
    handle := NEW.app_activity_blob_json::jsonb;
    key := 'private-blob:' || encode(sha256(convert_to((handle->>'provider') || E'\\n' || (handle->>'id'),'UTF8')),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended('clips-media:' || key,0));
    IF EXISTS (SELECT 1 FROM recording_media_cleanup_objects WHERE object_key=key AND deletion_claimed) THEN
      RAISE EXCEPTION 'Recording media is being deleted';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER clips_recording_activity_media_fence BEFORE INSERT OR UPDATE OF app_activity_blob_json ON recording_browser_diagnostics FOR EACH ROW EXECUTE FUNCTION clips_fence_deleted_activity_media();
`;

// The migration runner preserves single-quoted bodies but splits dollar-quoted bodies at internal semicolons.
export const recordingMediaCleanupMigration = cleanupDdl.replace(
  /\$\$([\s\S]*?)\$\$/g,
  (_delimiter, body: string) => "'" + body.replace(/'/g, "''") + "'",
);
