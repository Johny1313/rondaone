import { getReliabilitySummary } from "../../reliability/core.js";
import { ADMIN_EMAIL, DEFAULT_SLIDE_COUNT, MAX_ACTIVE_USERS, MAX_CAROUSEL_LEARNING_EXAMPLES, MAX_PROFILE_REFERENCES, MAX_PROFILE_REFERENCE_TOTAL_CHARS, MAX_STYLE_SAMPLES, MAX_STYLE_TOTAL_CHARS, SESSION_IDLE_MINUTES, SESSION_TOUCH_MINUTES, validateSlideCount } from "./profile.js";
const initializedBindings = new WeakSet();
export const MAX_MONITORING_TERMS = 6;
export const DATABASE_SCHEMA_VERSION = "2.9.5.1";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    heartbeat_at TEXT,
    completed_at TEXT,
    items_count INTEGER NOT NULL DEFAULT 0,
    topics_count INTEGER NOT NULL DEFAULT 0,
    sources_count INTEGER NOT NULL DEFAULT 0,
    social_items_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    payload_json TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC)",
  `CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS translation_cache (
    cache_key TEXT PRIMARY KEY,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS intelligent_carousels (
    cache_key TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_expires ON intelligent_carousels(expires_at)",
  `CREATE TABLE IF NOT EXISTS intelligent_jobs (
    cache_key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    payload_json TEXT,
    request_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_jobs_expires ON intelligent_jobs(expires_at)",
  `CREATE TABLE IF NOT EXISTS article_read_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_article_read_cache_expires ON article_read_cache(expires_at)",
  `CREATE TABLE IF NOT EXISTS article_source_stats (
    hostname TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    total_words INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS monitoring_terms (
    id TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    term_key TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_monitoring_terms_active_term ON monitoring_terms(active, term)",
  `CREATE TABLE IF NOT EXISTS source_state (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL,
    route TEXT NOT NULL,
    http_status INTEGER,
    error_code TEXT,
    error_detail TEXT,
    items_json TEXT NOT NULL DEFAULT '[]',
    item_count INTEGER NOT NULL DEFAULT 0,
    last_url TEXT,
    validators_json TEXT NOT NULL DEFAULT '{}',
    last_attempt_at TEXT,
    last_success_at TEXT,
    next_check_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    response_ms INTEGER,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_source_state_next_check ON source_state(next_check_at)",
  "CREATE INDEX IF NOT EXISTS idx_source_state_status ON source_state(status, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    email_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    default_slide_count INTEGER NOT NULL DEFAULT 7,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_users_email_key ON users(email_key)",
  `CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expires_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)",
  `CREATE TABLE IF NOT EXISTS user_access (
    user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'editor',
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_user_access_role ON user_access(role, disabled)",
  `CREATE TABLE IF NOT EXISTS editorial_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS editorial_group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(group_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_group_members_user ON editorial_group_members(user_id, group_id)",
  `CREATE TABLE IF NOT EXISTS user_presence (
    user_id TEXT PRIMARY KEY,
    area TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_user_presence_activity ON user_presence(last_activity_at DESC)",
  `CREATE TABLE IF NOT EXISTS usage_daily_users (
    day TEXT NOT NULL,
    user_id TEXT NOT NULL,
    area TEXT NOT NULL,
    active_ms INTEGER NOT NULL DEFAULT 0,
    last_activity_at TEXT NOT NULL,
    PRIMARY KEY(day, user_id, area)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_usage_daily_users_day ON usage_daily_users(day, area)",
  `CREATE TABLE IF NOT EXISTS usage_metrics (
    bucket TEXT NOT NULL,
    granularity TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    samples INTEGER NOT NULL DEFAULT 0,
    total_ms INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(bucket, granularity, metric)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_usage_metrics_metric ON usage_metrics(metric, granularity, bucket DESC)",
  `CREATE TABLE IF NOT EXISTS writing_samples (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, content_hash)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_writing_samples_user ON writing_samples(user_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS writing_profiles (
    user_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS profile_references (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reference_type TEXT NOT NULL,
    title TEXT NOT NULL,
    source_url TEXT,
    text_content TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    file_name TEXT,
    mime_type TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    char_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, content_hash)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_profile_references_user ON profile_references(user_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_profile_references_type ON profile_references(user_id, reference_type, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS carousel_learning_examples (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    slide_count INTEGER NOT NULL,
    slides_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, content_hash)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_carousel_learning_user ON carousel_learning_examples(user_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS newsroom_stories (
    id TEXT PRIMARY KEY, topic_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, editoria TEXT NOT NULL, priority TEXT NOT NULL,
    editorial_queue TEXT NOT NULL DEFAULT 'watch', workflow_status TEXT NOT NULL DEFAULT 'discovered', score INTEGER NOT NULL DEFAULT 0,
    assignee_user_id TEXT, verification_level TEXT NOT NULL DEFAULT 'single', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    last_changed_at TEXT NOT NULL, source_count INTEGER NOT NULL DEFAULT 0, item_count INTEGER NOT NULL DEFAULT 0, latest_run_id TEXT,
    snapshot_json TEXT NOT NULL DEFAULT '{}', change_summary_json TEXT NOT NULL DEFAULT '{}', published_at TEXT, updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_newsroom_stories_queue ON newsroom_stories(editorial_queue, last_changed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_newsroom_stories_status ON newsroom_stories(workflow_status, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS newsroom_story_events (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, event_type TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_newsroom_story_events_story ON newsroom_story_events(story_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS newsroom_story_notes (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS newsroom_story_followers (
    story_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(story_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carousel_versions (
    id TEXT PRIMARY KEY, job_id TEXT, cache_key TEXT, topic_id TEXT, user_id TEXT, kind TEXT NOT NULL DEFAULT 'carousel',
    version_number INTEGER NOT NULL DEFAULT 1, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    payload_json TEXT NOT NULL, quality_score REAL, confidence_score REAL, note TEXT, created_by TEXT, created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_carousel_versions_job ON carousel_versions(job_id, version_number DESC)",
  "CREATE INDEX IF NOT EXISTS idx_carousel_versions_topic ON carousel_versions(topic_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS production_workflow (
    id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, version_id TEXT, title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', owner_user_id TEXT, assignee_user_id TEXT, group_id TEXT,
    created_by TEXT NOT NULL, reviewed_by TEXT, approved_by TEXT, published_by TEXT, rejection_reason TEXT, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT, reviewed_at TEXT, approved_at TEXT, published_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_production_workflow_status ON production_workflow(status, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_production_workflow_owner ON production_workflow(owner_user_id, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS production_workflow_events (
    id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, event_type TEXT NOT NULL, from_status TEXT, to_status TEXT, user_id TEXT,
    note TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_workflow_events_item ON production_workflow_events(workflow_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS watchdog_events (
    id TEXT PRIMARY KEY, event_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', subject_id TEXT, status TEXT NOT NULL DEFAULT 'open',
    detail TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, resolved_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_watchdog_events_time ON watchdog_events(created_at DESC)",
  `DELETE FROM source_state WHERE source_id IN (
    'fatos-desconhecidos', 'mega-curioso', 'incrivel-club', 'misterios-do-mundo',
    'canaltech-curiosidades', 'superinteressante', 'revista-galileu',
    'segredos-do-mundo', 'awebic', 'hypeness'
  )`,
];

const STORAGE_GUARD = Object.freeze({
  // Cada ronda já contém a janela editorial completa; manter centenas de payloads completos
  // apenas duplica os mesmos dados e enche o D1. Preservamos metadados por 48h, mas
  // somente as 24 rondas mais recentes mantêm payload detalhado.
  maxRunRows: 576,
  maxRunPayloads: 12,
  maxArticleReadCache: 40,
  maxIntelligentCarousels: 60,
  maxIntelligentJobs: 120,
  maxTranslations: 1000,
  maxCarouselLearningPerUser: MAX_CAROUSEL_LEARNING_EXAMPLES,
  maxNewsroomStories: 500,
  maxNewsroomEvents: 3000,
  maxNewsroomNotes: 1500,
  maxCarouselVersions: 800,
  maxWorkflowItems: 1200,
  maxWorkflowEvents: 5000,
  maxWatchdogEvents: 2000,
});

export function isD1StorageLimitError(error) {
  const text = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  return text.includes("exceeded maximum db size") || text.includes("maximum database size") || text.includes("maximum account storage");
}

async function emergencyCleanupRaw(db) {
  const now = new Date().toISOString();
  const translationCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const statements = [
    `UPDATE runs SET payload_json = NULL
     WHERE payload_json IS NOT NULL
       AND status NOT IN ('queued', 'running')
       AND id NOT IN (
         SELECT id FROM runs
         WHERE status = 'success' AND payload_json IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT ${STORAGE_GUARD.maxRunPayloads}
       )`,
    `DELETE FROM runs
     WHERE status NOT IN ('queued', 'running')
       AND id NOT IN (
         SELECT id FROM runs
         WHERE status NOT IN ('queued', 'running')
         ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), queued_at) DESC
         LIMIT ${STORAGE_GUARD.maxRunRows}
       )`,
    `DELETE FROM intelligent_carousels WHERE expires_at < '${now}'`,
    `DELETE FROM intelligent_carousels WHERE cache_key NOT IN (SELECT cache_key FROM intelligent_carousels ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxIntelligentCarousels})`,
    `DELETE FROM intelligent_jobs WHERE expires_at < '${now}'`,
    `DELETE FROM intelligent_jobs WHERE job_id NOT IN (SELECT job_id FROM intelligent_jobs ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxIntelligentJobs})`,
    `DELETE FROM article_read_cache WHERE expires_at < '${now}'`,
    `DELETE FROM article_read_cache WHERE cache_key NOT IN (SELECT cache_key FROM article_read_cache ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxArticleReadCache})`,
    `DELETE FROM translation_cache WHERE updated_at < '${translationCutoff}'`,
    `DELETE FROM translation_cache WHERE cache_key NOT IN (SELECT cache_key FROM translation_cache ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxTranslations})`,
    `DELETE FROM locks WHERE expires_at < ${Date.now() - 5 * 60 * 1000}`,
    `DELETE FROM user_sessions WHERE expires_at < '${now}' OR last_seen_at < '${new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString()}'`,
    `DELETE FROM user_presence WHERE last_activity_at < '${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}'`,
    `DELETE FROM usage_daily_users WHERE day < '${new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0,10)}'`,
    `DELETE FROM usage_metrics WHERE substr(bucket,1,10) < '${new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0,10)}'`,
    `DELETE FROM carousel_learning_examples WHERE id NOT IN (SELECT id FROM carousel_learning_examples ORDER BY created_at DESC LIMIT 240)`,
    `DELETE FROM newsroom_story_events WHERE id NOT IN (SELECT id FROM newsroom_story_events ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxNewsroomEvents})`,
    `DELETE FROM newsroom_story_notes WHERE id NOT IN (SELECT id FROM newsroom_story_notes ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxNewsroomNotes})`,
    `DELETE FROM newsroom_stories WHERE workflow_status IN ('published','discarded') AND id NOT IN (SELECT id FROM newsroom_stories ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxNewsroomStories})`,
    `DELETE FROM carousel_versions WHERE id NOT IN (SELECT id FROM carousel_versions ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxCarouselVersions})`,
    `DELETE FROM production_workflow_events WHERE id NOT IN (SELECT id FROM production_workflow_events ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxWorkflowEvents})`,
    `DELETE FROM production_workflow WHERE status IN ('published','rejected') AND id NOT IN (SELECT id FROM production_workflow ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxWorkflowItems})`,
    `DELETE FROM watchdog_events WHERE id NOT IN (SELECT id FROM watchdog_events ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxWatchdogEvents})`,
  ];
  for (const statement of statements) {
    try { await db.prepare(statement).run(); } catch {}
  }
}


export async function preflightCoreStorage(db) {
  if (!db) return false;
  const statements = [
    `UPDATE runs SET payload_json = NULL
     WHERE payload_json IS NOT NULL
       AND status NOT IN ('queued', 'running')
       AND id NOT IN (
         SELECT id FROM runs
         WHERE status = 'success' AND payload_json IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT ${STORAGE_GUARD.maxRunPayloads}
       )`,
    `DELETE FROM intelligent_carousels WHERE expires_at < '${new Date().toISOString()}'`,
    `DELETE FROM intelligent_jobs WHERE expires_at < '${new Date().toISOString()}'`,
    `DELETE FROM article_read_cache WHERE expires_at < '${new Date().toISOString()}'`,
  ];
  let changed = false;
  for (const statement of statements) {
    try {
      const result = await db.prepare(statement).run();
      if (Number(result?.meta?.changes || 0) > 0) changed = true;
    } catch {}
  }
  return changed;
}
export async function emergencyDatabaseCleanup(db) {
  if (!db) return false;
  await emergencyCleanupRaw(db);
  return true;
}

async function currentSchemaVersion(db) {
  try {
    const row = await db.prepare("SELECT value FROM app_state WHERE key = 'schema_version' LIMIT 1").first();
    return String(row?.value || "");
  } catch {
    return "";
  }
}

async function migrateLegacyRunsTableIfNeeded(db, rows = []) {
  const byName = new Map((rows || []).map((row) => [String(row?.name || ""), row]));
  const legacyNotNull = Number(byName.get("started_at")?.notnull) === 1 || Number(byName.get("completed_at")?.notnull) === 1;
  if (!legacyNotNull) return false;

  const now = new Date().toISOString();
  const hasQueuedAt = byName.has("queued_at");
  const hasHeartbeatAt = byName.has("heartbeat_at");
  await db.prepare("DROP TABLE IF EXISTS runs_rondaone_v285").run();
  await db.prepare(`CREATE TABLE runs_rondaone_v285 (
    id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    heartbeat_at TEXT,
    completed_at TEXT,
    items_count INTEGER NOT NULL DEFAULT 0,
    topics_count INTEGER NOT NULL DEFAULT 0,
    sources_count INTEGER NOT NULL DEFAULT 0,
    social_items_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    payload_json TEXT
  )`).run();

  const queuedExpr = hasQueuedAt
    ? "COALESCE(NULLIF(queued_at, ''), NULLIF(started_at, ''), NULLIF(completed_at, ''), ?)"
    : "COALESCE(NULLIF(started_at, ''), NULLIF(completed_at, ''), ?)";
  const heartbeatExpr = hasHeartbeatAt
    ? "COALESCE(NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), NULLIF(completed_at, ''), ?)"
    : "COALESCE(NULLIF(started_at, ''), NULLIF(completed_at, ''), ?)";

  await db.prepare(`
    INSERT INTO runs_rondaone_v285 (
      id, trigger_type, status, queued_at, started_at, heartbeat_at, completed_at,
      items_count, topics_count, sources_count, social_items_count, error, payload_json
    )
    SELECT
      id, trigger_type, status, ${queuedExpr},
      CASE WHEN status IN ('running','success','failed','expired') THEN NULLIF(started_at, '') ELSE NULL END,
      ${heartbeatExpr},
      CASE WHEN status IN ('success','failed','expired') THEN NULLIF(completed_at, '') ELSE NULL END,
      items_count, topics_count, sources_count, social_items_count, error, payload_json
    FROM runs
  `).bind(now, now).run();

  await db.prepare("DROP INDEX IF EXISTS idx_runs_completed").run();
  await db.prepare("DROP INDEX IF EXISTS idx_runs_status_completed").run();
  await db.prepare("DROP INDEX IF EXISTS idx_runs_status_activity").run();
  await db.prepare("DROP TABLE runs").run();
  await db.prepare("ALTER TABLE runs_rondaone_v285 RENAME TO runs").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_status_activity ON runs(status, heartbeat_at DESC, queued_at DESC)").run();
  return true;
}

async function ensureRunStateColumns(db) {
  let result = await db.prepare("PRAGMA table_info(runs)").all();
  const migrated = await migrateLegacyRunsTableIfNeeded(db, result?.results || []);
  if (migrated) result = await db.prepare("PRAGMA table_info(runs)").all();
  const columns = new Set((result?.results || []).map((row) => String(row?.name || "")));
  if (!columns.has("queued_at")) await db.prepare("ALTER TABLE runs ADD COLUMN queued_at TEXT").run();
  if (!columns.has("heartbeat_at")) await db.prepare("ALTER TABLE runs ADD COLUMN heartbeat_at TEXT").run();
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE runs
    SET queued_at = COALESCE(NULLIF(queued_at, ''), NULLIF(started_at, ''), NULLIF(completed_at, ''), ?),
        heartbeat_at = COALESCE(NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), NULLIF(queued_at, ''), ?)
    WHERE queued_at IS NULL OR queued_at = '' OR heartbeat_at IS NULL OR heartbeat_at = ''
  `).bind(now, now).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_status_activity ON runs(status, heartbeat_at DESC, queued_at DESC)").run();
}



async function ensureIntelligentJobRequestColumn(db) {
  const result = await db.prepare("PRAGMA table_info(intelligent_jobs)").all();
  const columns = new Set((result?.results || []).map((row) => String(row?.name || "")));
  if (!columns.has("request_json")) {
    await db.prepare("ALTER TABLE intelligent_jobs ADD COLUMN request_json TEXT").run();
  }
}

async function ensureCarouselReliabilitySchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS carousel_reliability (
      job_id TEXT PRIMARY KEY,
      cache_key TEXT,
      user_id TEXT,
      run_id TEXT,
      topic_id TEXT,
      slide_count INTEGER NOT NULL DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'attempted',
      recovered INTEGER NOT NULL DEFAULT 0,
      queue_attempts INTEGER NOT NULL DEFAULT 0,
      failure_stage TEXT,
      error_code TEXT,
      error_detail TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_carousel_reliability_started ON carousel_reliability(started_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_carousel_reliability_status ON carousel_reliability(status, completed_at DESC)").run();
}

export async function ensureSchema(db) {
  if (!db) throw new Error("Binding D1 'DB' não configurado.");
  if (initializedBindings.has(db)) return;
  const initialize = async () => {
    const version = await currentSchemaVersion(db);
    if (version !== DATABASE_SCHEMA_VERSION) {
      for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
    }
    await ensureRunStateColumns(db);
    await ensureIntelligentJobRequestColumn(db);
    await ensureCarouselReliabilitySchema(db);
    if (version !== DATABASE_SCHEMA_VERSION) {
      const now = new Date().toISOString();
      await db.prepare(`
        INSERT INTO app_state (key, value, updated_at) VALUES ('schema_version', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(DATABASE_SCHEMA_VERSION, now).run();
    }
  };
  try {
    await initialize();
  } catch (error) {
    if (!isD1StorageLimitError(error)) throw error;
    await emergencyCleanupRaw(db);
    await initialize();
  }
  initializedBindings.add(db);
}

export async function acquireLock(db, name, ttlMs, nowMs = Date.now()) {
  await ensureSchema(db);
  const token = crypto.randomUUID();
  const expiresAt = nowMs + ttlMs;
  await db
    .prepare(`
      INSERT INTO locks (name, token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE locks.expires_at < ?
    `)
    .bind(name, token, expiresAt, nowMs)
    .run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ?").bind(name).first();
  return row?.token === token ? { name, token, expiresAt } : null;
}

export async function renewLock(db, lock, ttlMs, nowMs = Date.now()) {
  if (!db || !lock) return null;
  const expiresAt = nowMs + Math.max(1_000, Number(ttlMs) || 1_000);
  await db.prepare("UPDATE locks SET expires_at = ? WHERE name = ? AND token = ?")
    .bind(expiresAt, lock.name, lock.token)
    .run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ? LIMIT 1").bind(lock.name).first();
  if (row?.token !== lock.token) return null;
  lock.expiresAt = Number(row.expires_at) || expiresAt;
  return lock;
}

export async function releaseLock(db, lock) {
  if (!db || !lock) return;
  await db.prepare("DELETE FROM locks WHERE name = ? AND token = ?").bind(lock.name, lock.token).run();
}


function monitoringTermRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function monitoringTermKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}


export async function listMonitoringTerms(db, { activeOnly = false } = {}) {
  await ensureSchema(db);
  const result = await db
    .prepare(`SELECT * FROM monitoring_terms ${activeOnly ? "WHERE active = 1" : ""} ORDER BY active DESC, term COLLATE NOCASE`)
    .all();
  return (result?.results || []).map(monitoringTermRow);
}

export async function createMonitoringTerm(db, term) {
  await ensureSchema(db);
  const termKey = monitoringTermKey(term);
  const existing = await db.prepare("SELECT id FROM monitoring_terms WHERE term_key = ? LIMIT 1").bind(termKey).first();
  if (existing) throw new Error("Este termo já está cadastrado.");
  const count = await db.prepare("SELECT COUNT(*) AS total FROM monitoring_terms WHERE active = 1").first();
  if (Number(count?.total) >= MAX_MONITORING_TERMS) throw new Error(`O limite é de ${MAX_MONITORING_TERMS} termos ativos.`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO monitoring_terms (id, term, term_key, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(id, term, termKey, now, now).run();
  return monitoringTermRow(await db.prepare("SELECT * FROM monitoring_terms WHERE id = ?").bind(id).first());
}

export async function setMonitoringTermActive(db, id, active) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM monitoring_terms WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  if (active && Number(current.active) !== 1) {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM monitoring_terms WHERE active = 1").first();
    if (Number(count?.total) >= MAX_MONITORING_TERMS) throw new Error(`O limite é de ${MAX_MONITORING_TERMS} termos ativos.`);
  }
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE monitoring_terms SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, updatedAt, id)
    .run();
  return monitoringTermRow(await db.prepare("SELECT * FROM monitoring_terms WHERE id = ?").bind(id).first());
}

export async function deleteMonitoringTerm(db, id) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM monitoring_terms WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  await db.prepare("DELETE FROM monitoring_terms WHERE id = ?").bind(id).run();
  return monitoringTermRow(current);
}

export async function queueRun(db, { id, triggerType, queuedAt = new Date().toISOString() }) {
  await ensureSchema(db);
  await db.prepare(`
    INSERT INTO runs (
      id, trigger_type, status, queued_at, started_at, heartbeat_at, completed_at,
      items_count, topics_count, sources_count, social_items_count, error, payload_json
    ) VALUES (?, ?, 'queued', ?, '', ?, '', 0, 0, 0, 0, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      trigger_type = excluded.trigger_type,
      status = 'queued',
      queued_at = excluded.queued_at,
      started_at = '',
      heartbeat_at = excluded.heartbeat_at,
      completed_at = '',
      error = NULL
  `).bind(id, triggerType, queuedAt, queuedAt).run();
  return { id, status: "queued", queuedAt };
}

export async function markRunStarted(db, { id, triggerType, queuedAt, startedAt = new Date().toISOString() }) {
  await ensureSchema(db);
  const safeQueuedAt = queuedAt || startedAt;
  await db.prepare(`
    INSERT INTO runs (
      id, trigger_type, status, queued_at, started_at, heartbeat_at, completed_at,
      items_count, topics_count, sources_count, social_items_count, error, payload_json
    ) VALUES (?, ?, 'running', ?, ?, ?, '', 0, 0, 0, 0, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      trigger_type = excluded.trigger_type,
      status = 'running',
      queued_at = COALESCE(NULLIF(runs.queued_at, ''), excluded.queued_at),
      started_at = excluded.started_at,
      heartbeat_at = excluded.heartbeat_at,
      completed_at = '',
      error = NULL
  `).bind(id, triggerType, safeQueuedAt, startedAt, startedAt).run();
  return { id, status: "running", queuedAt: safeQueuedAt, startedAt };
}

export async function touchRun(db, id, heartbeatAt = new Date().toISOString()) {
  await ensureSchema(db);
  await db.prepare("UPDATE runs SET heartbeat_at = ? WHERE id = ? AND status = 'running'")
    .bind(heartbeatAt, id)
    .run();
  return heartbeatAt;
}

export async function expireStaleRuns(db, { queuedTimeoutMs = 2 * 60 * 1000, runningTimeoutMs = 10 * 60 * 1000 } = {}) {
  await ensureSchema(db);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const queuedCutoff = new Date(nowMs - Math.max(30_000, Number(queuedTimeoutMs) || 120_000)).toISOString();
  const runningCutoff = new Date(nowMs - Math.max(60_000, Number(runningTimeoutMs) || 600_000)).toISOString();
  const results = await db.batch([
    db.prepare(`
      UPDATE runs
      SET status = 'expired', completed_at = ?, heartbeat_at = ?, error = 'Ronda expirada antes de iniciar no consumidor.'
      WHERE status = 'queued'
        AND COALESCE(NULLIF(queued_at, ''), NULLIF(started_at, ''), NULLIF(completed_at, '')) < ?
    `).bind(now, now, queuedCutoff),
    db.prepare(`
      UPDATE runs
      SET status = 'expired', completed_at = ?, heartbeat_at = ?, error = 'Ronda expirada por ausência de progresso.'
      WHERE status = 'running'
        AND COALESCE(NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), NULLIF(queued_at, '')) < ?
    `).bind(now, now, runningCutoff),
  ]);
  return (results || []).reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
}

export async function startRun(db, { id, triggerType, startedAt }) {
  return markRunStarted(db, { id, triggerType, queuedAt: startedAt, startedAt });
}

export async function saveRun(db, { id, triggerType, startedAt, payload }) {
  await ensureSchema(db);
  await preflightCoreStorage(db).catch(() => null);
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {
        ok: false,
        collectedAt: new Date().toISOString(),
        error: "A coleta terminou sem retornar dados válidos.",
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: [],
      };
  const completedAt = safePayload.collectedAt || new Date().toISOString();
  const totals = safePayload.totals ?? {};
  const status = safePayload.ok ? "success" : "failed";
  const payloadJson = JSON.stringify(safePayload);
  const write = () => db.prepare(`
    INSERT INTO runs (
      id, trigger_type, status, queued_at, started_at, heartbeat_at, completed_at,
      items_count, topics_count, sources_count, social_items_count, error, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      trigger_type = excluded.trigger_type,
      status = excluded.status,
      queued_at = COALESCE(NULLIF(runs.queued_at, ''), excluded.queued_at),
      started_at = excluded.started_at,
      heartbeat_at = excluded.heartbeat_at,
      completed_at = excluded.completed_at,
      items_count = excluded.items_count,
      topics_count = excluded.topics_count,
      sources_count = excluded.sources_count,
      social_items_count = excluded.social_items_count,
      error = excluded.error,
      payload_json = excluded.payload_json
  `).bind(
    id,
    triggerType,
    status,
    startedAt,
    startedAt,
    completedAt,
    completedAt,
    Number(totals.items) || 0,
    Number(totals.topics) || 0,
    Number(totals.sources) || 0,
    Number(totals.socialItems) || 0,
    safePayload.error || null,
    payloadJson,
  ).run();
  try {
    await write();
  } catch (error) {
    if (!isD1StorageLimitError(error)) throw error;
    await emergencyCleanupRaw(db);
    await write();
  }
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt || completedAt));
  await recordUsageMetric(db, status === 'success' ? 'rounds_completed' : 'rounds_failed', { value:1, samples:1, durationMs, at:new Date(completedAt) }).catch(() => null);
  if (status === 'success') {
    await recordUsageMetric(db, 'topics_generated', { value:Number(totals.topics)||0, samples:1, at:new Date(completedAt) }).catch(() => null);
    await recordUsageMetric(db, 'items_collected', { value:Number(totals.items)||0, samples:1, at:new Date(completedAt) }).catch(() => null);
  }
  await clearRoundPreview(db,id).catch(()=>null);
  return { id, status, completedAt };
}

export async function getCachedTranslations(db, keys = []) {
  await ensureSchema(db);
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const output = new Map();
  for (let offset = 0; offset < uniqueKeys.length; offset += 80) {
    const chunk = uniqueKeys.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT cache_key, translated_text FROM translation_cache WHERE cache_key IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      if (row?.cache_key && row?.translated_text) output.set(row.cache_key, row.translated_text);
    }
  }
  return output;
}

export async function saveCachedTranslations(db, entries = []) {
  await ensureSchema(db);
  const validEntries = entries.filter((entry) => entry?.key && entry?.translatedText);
  const updatedAt = new Date().toISOString();
  for (let offset = 0; offset < validEntries.length; offset += 80) {
    const chunk = validEntries.slice(offset, offset + 80);
    await db.batch(chunk.map((entry) => db
      .prepare(`
        INSERT INTO translation_cache (cache_key, source_lang, target_lang, translated_text, updated_at)
        VALUES (?, ?, 'pt', ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          translated_text = excluded.translated_text,
          updated_at = excluded.updated_at
      `)
      .bind(entry.key, entry.sourceLanguage, entry.translatedText, updatedAt)));
  }
}


export async function saveRoundPreview(db,{runId,triggerType="scheduled",payload}={}){
  await ensureSchema(db);if(!runId||!payload||typeof payload!=="object")return null;
  const updatedAt=new Date().toISOString();
  const value=JSON.stringify({runId,triggerType,payload,updatedAt});
  await db.prepare(`INSERT INTO app_state(key,value,updated_at) VALUES('latest_round_preview',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(value,updatedAt).run();
  return {runId,updatedAt};
}

export async function clearRoundPreview(db,runId=null){
  await ensureSchema(db);
  if(!runId){await db.prepare("DELETE FROM app_state WHERE key='latest_round_preview'").run();return true;}
  const row=await db.prepare("SELECT value FROM app_state WHERE key='latest_round_preview' LIMIT 1").first();
  try{const parsed=JSON.parse(row?.value||"{}");if(parsed?.runId&&parsed.runId!==runId)return false;}catch{}
  await db.prepare("DELETE FROM app_state WHERE key='latest_round_preview'").run();return true;
}

async function getRoundPreview(db){
  const row=await db.prepare("SELECT value,updated_at FROM app_state WHERE key='latest_round_preview' LIMIT 1").first();
  if(!row?.value)return null;try{const parsed=JSON.parse(row.value);const updatedMs=Date.parse(parsed?.updatedAt||row.updated_at||"");if(!parsed?.payload||!Number.isFinite(updatedMs)||Date.now()-updatedMs>10*60*1000)return null;return {...parsed,updatedAt:parsed.updatedAt||row.updated_at};}catch{return null;}
}

export async function getLatestRound(db) {
  await ensureSchema(db);
  const [row,preview] = await Promise.all([
    db.prepare("SELECT id, trigger_type, completed_at, payload_json FROM runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1").first(),
    getRoundPreview(db).catch(()=>null),
  ]);
  let stored=null;
  if(row?.payload_json){try{const payload=JSON.parse(row.payload_json);if(payload&&typeof payload==="object"&&!Array.isArray(payload))stored={...payload,runId:row.id,triggerType:row.trigger_type,storedAt:row.completed_at};}catch{throw new Error("A última ronda armazenada está corrompida.");}}
  const previewMs=Date.parse(preview?.updatedAt||"");const storedMs=Date.parse(stored?.storedAt||stored?.collectedAt||"");
  if(preview?.payload&&Number.isFinite(previewMs)&&(!Number.isFinite(storedMs)||previewMs>storedMs)){return {...preview.payload,runId:preview.runId,triggerType:preview.triggerType,storedAt:preview.updatedAt,preview:true};}
  return stored;
}

export async function getRunHistory(db, limit = 30, { includeFastLane = false, includeTechnical = false } = {}) {
  await ensureSchema(db);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const where = [];
  if (!includeFastLane) where.push("trigger_type <> 'fast-lane'");
  // Falhas sem uma única fonte diagnosticada são incidentes de infraestrutura,
  // não uma ronda editorial. Permanecem no D1/watchdog, mas não poluem o Histórico.
  if (!includeTechnical) where.push("NOT (status IN ('failed','expired') AND items_count = 0 AND topics_count = 0 AND sources_count = 0)");
  const result = await db
    .prepare(`
      SELECT id, trigger_type, status, queued_at,
             NULLIF(started_at, '') AS started_at, NULLIF(completed_at, '') AS completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), queued_at) DESC
      LIMIT ?
    `)
    .bind(safeLimit)
    .all();
  return result?.results ?? [];
}

export async function getRunStatus(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, queued_at,
             NULLIF(started_at, '') AS started_at, NULLIF(completed_at, '') AS completed_at,
             items_count, topics_count, sources_count, social_items_count, error, payload_json
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  if (!row) return null;
  let diagnostics = null;
  let detail = null;
  let collectionStatus = null;
  if (row.payload_json) {
    try {
      const payload = JSON.parse(row.payload_json);
      diagnostics = payload?.diagnostics || null;
      detail = payload?.detail || null;
      collectionStatus = payload?.collectionStatus || null;
    } catch {}
  }
  delete row.payload_json;
  return {
    ...row,
    collectionStatus,
    detail,
    diagnostics,
  };
}

export async function getRunPayload(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, queued_at,
             NULLIF(started_at, '') AS started_at, NULLIF(completed_at, '') AS completed_at, error, payload_json
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error("Os dados desta ronda estão corrompidos.");
    }
  }
  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    queuedAt: row.queued_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    error: row.error,
    payload,
  };
}

export async function getArticleReadCache(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM article_read_cache WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function saveArticleReadCache(db, cacheKey, payload, ttlHours = 12) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 12) * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO article_read_cache (cache_key, payload_json, updated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(cacheKey, JSON.stringify(payload), updatedAt, expiresAt).run();
  return { updatedAt, expiresAt };
}

function hostnameFromUrl(value) {
  try { return new URL(String(value || "")).hostname.toLocaleLowerCase("pt-BR").replace(/^www\./, ""); } catch { return ""; }
}

export async function getArticleSourceStats(db, urls = []) {
  await ensureSchema(db);
  const hostnames = [...new Set(urls.map(hostnameFromUrl).filter(Boolean))];
  if (!hostnames.length) return {};
  const output = {};
  for (let offset = 0; offset < hostnames.length; offset += 80) {
    const chunk = hostnames.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT hostname, attempts, successes, total_words, updated_at FROM article_source_stats WHERE hostname IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      output[row.hostname] = {
        attempts: Number(row.attempts) || 0,
        successes: Number(row.successes) || 0,
        totalWords: Number(row.total_words) || 0,
        updatedAt: row.updated_at,
      };
    }
  }
  return output;
}

export async function recordArticleSourceAttempt(db, { url, success, wordCount = 0 } = {}) {
  await ensureSchema(db);
  const hostname = hostnameFromUrl(url);
  if (!hostname) return null;
  const updatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO article_source_stats (hostname, attempts, successes, total_words, updated_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      attempts = article_source_stats.attempts + 1,
      successes = article_source_stats.successes + excluded.successes,
      total_words = article_source_stats.total_words + excluded.total_words,
      updated_at = excluded.updated_at
  `).bind(hostname, success ? 1 : 0, Math.max(0, Number(wordCount) || 0), updatedAt).run();
  return { hostname, updatedAt };
}


export async function getIntelligentCarousel(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM intelligent_carousels WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function saveIntelligentCarousel(db, { cacheKey, runId, topicId, payload, ttlHours = 48 }) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 48) * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`
      INSERT INTO intelligent_carousels (cache_key, run_id, topic_id, payload_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        run_id = excluded.run_id,
        topic_id = excluded.topic_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
    .bind(cacheKey, runId, topicId, JSON.stringify(payload), updatedAt, expiresAt)
    .run();
  return { updatedAt, expiresAt };
}


function parseIntelligentJob(row) {
  if (!row) return null;
  let payload = null;
  let request = null;
  if (row.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch {}
  }
  if (row.request_json) {
    try { request = JSON.parse(row.request_json); } catch {}
  }
  const updatedAt = row.updated_at || row.created_at;
  const active = row.status === "queued" || row.status === "running";
  const updatedMs = Date.parse(updatedAt || "");
  const staleAfterMs = row.status === "queued"
    ? 45 * 1000
    : row.status === "running"
      ? 90 * 1000
      : 0;
  const stale = active && (!Number.isFinite(updatedMs) || Date.now() - updatedMs > staleAfterMs);
  return {
    cacheKey: row.cache_key,
    jobId: row.job_id,
    runId: row.run_id,
    topicId: row.topic_id,
    status: row.status,
    progress: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    message: row.message || "",
    error: row.error || null,
    payload,
    request,
    createdAt: row.created_at,
    updatedAt,
    expiresAt: row.expires_at,
    stale,
    staleAfterMs,
  };
}

export async function getIntelligentJob(db, jobId) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT * FROM intelligent_jobs WHERE job_id = ? LIMIT 1")
    .bind(jobId)
    .first();
  return parseIntelligentJob(row);
}

export async function createIntelligentJob(db, {
  cacheKey,
  runId,
  topicId,
  staleMs = 5 * 60 * 1000,
  ttlMinutes = 120,
  replaceCompleted = false,
  requestPayload = null,
} = {}) {
  await ensureSchema(db);
  const existingRow = await db
    .prepare("SELECT * FROM intelligent_jobs WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  const existing = parseIntelligentJob(existingRow);
  const legacyLockConflict = existing && /JOB_LOCK_BUSY|outro consumidor|processada por outro consumidor/i.test(`${existing.message || ""} ${existing.error || ""}`);
  if (existing && (
    (["queued", "running"].includes(existing.status) && !existing.stale && !legacyLockConflict)
    || (!replaceCompleted && existing.status === "succeeded" && existing.payload)
  )) {
    return { created: false, job: existing };
  }

  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO intelligent_jobs (
      cache_key, job_id, run_id, topic_id, status, progress, message, error,
      payload_json, request_json, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, 'queued', 1, ?, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      job_id = excluded.job_id,
      run_id = excluded.run_id,
      topic_id = excluded.topic_id,
      status = excluded.status,
      progress = excluded.progress,
      message = excluded.message,
      error = NULL,
      payload_json = NULL,
      request_json = excluded.request_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(
    cacheKey, jobId, runId, topicId, "Leitura adicionada à fila.",
    requestPayload ? JSON.stringify(requestPayload) : null,
    now, now, expiresAt
  ).run();
  return {
    created: true,
    job: {
      cacheKey,
      jobId,
      runId,
      topicId,
      status: "queued",
      progress: 1,
      message: "Leitura adicionada à fila.",
      request: requestPayload || null,
      error: null,
      payload: null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      stale: false,
    },
  };
}


export async function touchIntelligentJob(db, jobId, ttlMinutes = 120) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    UPDATE intelligent_jobs
    SET updated_at = ?, expires_at = ?
    WHERE job_id = ? AND status IN ('queued','running')
  `).bind(updatedAt, expiresAt, jobId).run();
  return getIntelligentJob(db, jobId);
}

export async function updateIntelligentJob(db, {
  jobId,
  status,
  progress = 0,
  message = "",
  error = null,
  payload = null,
  ttlMinutes = 120,
} = {}) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    UPDATE intelligent_jobs
    SET status = ?, progress = ?, message = ?, error = ?, payload_json = ?, updated_at = ?, expires_at = ?
    WHERE job_id = ?
      AND status NOT IN ('succeeded','failed')
  `).bind(
    status,
    Math.max(0, Math.min(100, Number(progress) || 0)),
    message || "",
    error ? String(error).slice(0, 300) : null,
    payload ? JSON.stringify(payload) : null,
    updatedAt,
    expiresAt,
    jobId,
  ).run();
  return getIntelligentJob(db, jobId);
}


function parseJsonObject(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sourceStateRow(row) {
  if (!row) return null;
  return {
    sourceId: row.source_id,
    name: row.name,
    region: row.region,
    status: row.status,
    route: row.route,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    errorCode: row.error_code || null,
    errorDetail: row.error_detail || null,
    items: Array.isArray(parseJsonObject(row.items_json, [])) ? parseJsonObject(row.items_json, []) : [],
    itemCount: Number(row.item_count) || 0,
    lastUrl: row.last_url || null,
    validators: parseJsonObject(row.validators_json, {}),
    lastAttemptAt: row.last_attempt_at || null,
    lastSuccessAt: row.last_success_at || null,
    nextCheckAt: row.next_check_at || null,
    failureCount: Number(row.failure_count) || 0,
    responseMs: row.response_ms == null ? null : Number(row.response_ms),
    updatedAt: row.updated_at,
  };
}

export async function getSourceStates(db, sourceIds = []) {
  await ensureSchema(db);
  const ids = [...new Set(sourceIds.map((value) => String(value || "").trim()).filter(Boolean))];
  const output = new Map();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db.prepare(`SELECT * FROM source_state WHERE source_id IN (${placeholders})`).bind(...chunk).all();
    for (const row of result?.results || []) {
      const parsed = sourceStateRow(row);
      if (parsed) output.set(parsed.sourceId, parsed);
    }
  }
  return output;
}

export async function saveSourceStates(db, entries = []) {
  await ensureSchema(db);
  const valid = entries.filter((entry) => entry?.sourceId && entry?.name);
  if (!valid.length) return 0;
  for (let offset = 0; offset < valid.length; offset += 40) {
    const chunk = valid.slice(offset, offset + 40);
    await db.batch(chunk.map((entry) => db.prepare(`
      INSERT INTO source_state (
        source_id, name, region, status, route, http_status, error_code, error_detail,
        items_json, item_count, last_url, validators_json, last_attempt_at, last_success_at,
        next_check_at, failure_count, response_ms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        name = excluded.name,
        region = excluded.region,
        status = excluded.status,
        route = excluded.route,
        http_status = excluded.http_status,
        error_code = excluded.error_code,
        error_detail = excluded.error_detail,
        items_json = excluded.items_json,
        item_count = excluded.item_count,
        last_url = excluded.last_url,
        validators_json = excluded.validators_json,
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = excluded.last_success_at,
        next_check_at = excluded.next_check_at,
        failure_count = excluded.failure_count,
        response_ms = excluded.response_ms,
        updated_at = excluded.updated_at
    `).bind(
      entry.sourceId,
      entry.name,
      entry.region || "Brasil",
      entry.status || "unknown",
      entry.route || "unknown",
      entry.httpStatus ?? null,
      entry.errorCode || null,
      entry.errorDetail ? String(entry.errorDetail).slice(0, 300) : null,
      JSON.stringify(Array.isArray(entry.items) ? entry.items : []),
      Number(entry.itemCount) || 0,
      entry.lastUrl || null,
      JSON.stringify(entry.validators && typeof entry.validators === "object" ? entry.validators : {}),
      entry.lastAttemptAt || null,
      entry.lastSuccessAt || null,
      entry.nextCheckAt || null,
      Number(entry.failureCount) || 0,
      entry.responseMs == null ? null : Math.max(0, Number(entry.responseMs) || 0),
      entry.updatedAt || new Date().toISOString(),
    )));
  }
  return valid.length;
}

export async function listSourceDiagnostics(db) {
  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT source_id, name, region, status, route, http_status, error_code, error_detail,
           item_count, last_attempt_at, last_success_at, next_check_at, failure_count,
           response_ms, updated_at
    FROM source_state
    ORDER BY region, name COLLATE NOCASE
  `).all();
  return (result?.results || []).map((row) => ({
    sourceId: row.source_id,
    name: row.name,
    region: row.region,
    status: row.status,
    route: row.route,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    errorCode: row.error_code || null,
    errorDetail: row.error_detail || null,
    itemCount: Number(row.item_count) || 0,
    lastAttemptAt: row.last_attempt_at || null,
    lastSuccessAt: row.last_success_at || null,
    nextCheckAt: row.next_check_at || null,
    failureCount: Number(row.failure_count) || 0,
    responseMs: row.response_ms == null ? null : Number(row.response_ms),
    updatedAt: row.updated_at,
  }));
}

export async function getLatestRunSummary(db, { successOnly = false, editorialOnly = false, includeTechnical = true } = {}) {
  await ensureSchema(db);
  const where = [];
  if (successOnly) where.push("status = 'success'");
  if (editorialOnly) where.push("trigger_type <> 'fast-lane'");
  if (!includeTechnical) where.push("NOT (status IN ('failed','expired') AND items_count = 0 AND topics_count = 0 AND sources_count = 0)");
  const row = await db.prepare(`
    SELECT id, trigger_type, status, queued_at,
           NULLIF(started_at, '') AS started_at, NULLIF(heartbeat_at, '') AS heartbeat_at,
           NULLIF(completed_at, '') AS completed_at,
           items_count, topics_count, sources_count, social_items_count, error
    FROM runs
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), queued_at) DESC
    LIMIT 1
  `).first();
  if (!row) return null;
  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    queuedAt: row.queued_at || null,
    startedAt: row.started_at || null,
    heartbeatAt: row.heartbeat_at || null,
    completedAt: row.completed_at || null,
    items: Number(row.items_count) || 0,
    topics: Number(row.topics_count) || 0,
    sources: Number(row.sources_count) || 0,
    socialItems: Number(row.social_items_count) || 0,
    error: row.error || null,
  };
}

export async function runDatabaseMaintenance(db, { intervalHours = 12 } = {}) {
  await ensureSchema(db);
  const nowMs = Date.now();
  const row = await db.prepare("SELECT value FROM app_state WHERE key = 'last_maintenance_at' LIMIT 1").first();
  const lastMs = Date.parse(row?.value || "");
  if (Number.isFinite(lastMs) && nowMs - lastMs < Math.max(1, Number(intervalHours) || 12) * 60 * 60 * 1000) return false;
  const now = new Date(nowMs).toISOString();
  const retentionCutoff = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const translationCutoff = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM runs WHERE status IN ('success', 'failed', 'expired') AND NULLIF(completed_at, '') < ?").bind(retentionCutoff),
    db.prepare(`UPDATE runs SET payload_json = NULL WHERE payload_json IS NOT NULL AND status NOT IN ('queued', 'running') AND id NOT IN (SELECT id FROM runs WHERE status = 'success' AND payload_json IS NOT NULL ORDER BY completed_at DESC LIMIT ${STORAGE_GUARD.maxRunPayloads})`),
    db.prepare(`DELETE FROM runs WHERE status NOT IN ('queued', 'running') AND id NOT IN (SELECT id FROM runs WHERE status NOT IN ('queued', 'running') ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), queued_at) DESC LIMIT ${STORAGE_GUARD.maxRunRows})`),
    db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(nowMs - 5 * 60 * 1000),
    db.prepare("DELETE FROM user_sessions WHERE expires_at < ? OR last_seen_at < ?").bind(now, new Date(nowMs - SESSION_IDLE_MINUTES * 60 * 1000).toISOString()),
    db.prepare("DELETE FROM user_presence WHERE last_activity_at < ?").bind(new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()),
    db.prepare("DELETE FROM usage_daily_users WHERE day < ?").bind(new Date(nowMs - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0,10)),
    db.prepare("DELETE FROM usage_metrics WHERE substr(bucket,1,10) < ?").bind(new Date(nowMs - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0,10)),
    db.prepare("DELETE FROM translation_cache WHERE updated_at < ?").bind(translationCutoff),
    db.prepare(`DELETE FROM translation_cache WHERE cache_key NOT IN (SELECT cache_key FROM translation_cache ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxTranslations})`),
    db.prepare("DELETE FROM intelligent_carousels WHERE expires_at < ?").bind(now),
    db.prepare(`DELETE FROM intelligent_carousels WHERE cache_key NOT IN (SELECT cache_key FROM intelligent_carousels ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxIntelligentCarousels})`),
    db.prepare("DELETE FROM intelligent_jobs WHERE expires_at < ?").bind(now),
    db.prepare(`DELETE FROM intelligent_jobs WHERE job_id NOT IN (SELECT job_id FROM intelligent_jobs ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxIntelligentJobs})`),
    db.prepare("DELETE FROM article_read_cache WHERE expires_at < ?").bind(now),
    db.prepare(`DELETE FROM article_read_cache WHERE cache_key NOT IN (SELECT cache_key FROM article_read_cache ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxArticleReadCache})`),
    db.prepare(`DELETE FROM carousel_versions WHERE id NOT IN (SELECT id FROM carousel_versions ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxCarouselVersions})`),
    db.prepare(`DELETE FROM production_workflow_events WHERE id NOT IN (SELECT id FROM production_workflow_events ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxWorkflowEvents})`),
    db.prepare(`DELETE FROM production_workflow WHERE status IN ('published','rejected') AND id NOT IN (SELECT id FROM production_workflow ORDER BY updated_at DESC LIMIT ${STORAGE_GUARD.maxWorkflowItems})`),
    db.prepare(`DELETE FROM watchdog_events WHERE id NOT IN (SELECT id FROM watchdog_events ORDER BY created_at DESC LIMIT ${STORAGE_GUARD.maxWatchdogEvents})`),
    db.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('last_maintenance_at', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(now, now),
  ]);
  return true;
}


function newsroomStoryRow(row) {
  if (!row) return null;
  return {
    id: row.id, topicKey: row.topic_key, title: row.title, editoria: row.editoria, priority: row.priority,
    queue: row.editorial_queue, workflowStatus: row.workflow_status, score: Number(row.score) || 0,
    assigneeUserId: row.assignee_user_id || null, verificationLevel: row.verification_level || "single",
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, lastChangedAt: row.last_changed_at,
    sourceCount: Number(row.source_count) || 0, itemCount: Number(row.item_count) || 0, latestRunId: row.latest_run_id || null,
    snapshot: parseJsonObject(row.snapshot_json, {}), changeSummary: parseJsonObject(row.change_summary_json, {}),
    publishedAt: row.published_at || null, updatedAt: row.updated_at,
  };
}

function compactTopicSnapshot(topic = {}) {
  const items = Array.isArray(topic.items) ? topic.items : [];
  return {
    title: String(topic.title || "").slice(0, 220),
    sourceNames: [...new Set((topic.sourceNames || items.map((item) => item?.sourceName)).filter(Boolean))].slice(0, 20),
    itemKeys: items.slice(0, 20).map((item) => `${item?.sourceName || ""}|${item?.title || ""}|${item?.publishedAt || ""}`).filter(Boolean),
    lastPublishedAt: topic.lastPublishedAt || null,
    score: Number(topic.score) || 0,
    priority: topic.priority || "Em observação",
  };
}

function newsroomVerification(topic = {}) {
  const names = (topic.sourceNames || []).map((value) => String(value).toLocaleLowerCase("pt-BR"));
  if (names.some((name) => /agência brasil|agencia brasil|gov\.br|tse|stf|senado|câmara|camara dos deputados/.test(name))) return "official";
  return Number(topic.sourceCount) >= 2 ? "cross" : "single";
}

function newsroomQueue(topic = {}, changed = false) {
  const score = Number(topic.score) || 0;
  if (topic.priority === "Pautar agora" || score >= 72) return "now";
  if (changed && score >= 48) return "rising";
  if (score >= 38 || Number(topic.sourceCount) >= 2) return "watch";
  return "quiet";
}

function newsroomChanges(previous = {}, current = {}) {
  const oldSources = new Set(previous.sourceNames || []);
  const oldItems = new Set(previous.itemKeys || []);
  const newSources = (current.sourceNames || []).filter((name) => !oldSources.has(name));
  const newItems = (current.itemKeys || []).filter((key) => !oldItems.has(key));
  const scoreDelta = (Number(current.score) || 0) - (Number(previous.score) || 0);
  const priorityChanged = Boolean(previous.priority && previous.priority !== current.priority);
  const changed = !previous.title || newSources.length > 0 || newItems.length > 0 || Math.abs(scoreDelta) >= 8 || priorityChanged;
  const parts = [];
  if (!previous.title) parts.push("Pauta identificada nesta ronda");
  if (newSources.length) parts.push(`${newSources.length} ${newSources.length === 1 ? "nova fonte" : "novas fontes"}`);
  if (newItems.length) parts.push(`${newItems.length} ${newItems.length === 1 ? "nova publicação" : "novas publicações"}`);
  if (scoreDelta >= 8) parts.push(`índice subiu ${scoreDelta} pontos`);
  if (scoreDelta <= -8) parts.push(`índice caiu ${Math.abs(scoreDelta)} pontos`);
  if (priorityChanged) parts.push(`prioridade mudou para ${current.priority}`);
  return { changed, newSources, newItemsCount: newItems.length, scoreDelta, priorityChanged, text: parts.join(" · ") || "Sem mudança editorial relevante" };
}

export async function syncNewsroomStories(db, topics = [], { runId = null, at = new Date().toISOString() } = {}) {
  await ensureSchema(db);
  const output = [];
  for (const topic of Array.isArray(topics) ? topics : []) {
    const topicKey = String(topic?.id || "").trim();
    if (!topicKey) continue;
    const id = topicKey.replace(/^topic-/, "story-");
    const existingRow = await db.prepare("SELECT * FROM newsroom_stories WHERE topic_key = ? LIMIT 1").bind(topicKey).first();
    const existing = newsroomStoryRow(existingRow);
    const current = compactTopicSnapshot(topic);
    const changes = newsroomChanges(existing?.snapshot || {}, current);
    const queue = newsroomQueue(topic, changes.changed);
    const verification = newsroomVerification(topic);
    const firstSeenAt = existing?.firstSeenAt || at;
    const lastChangedAt = changes.changed ? at : existing?.lastChangedAt || at;
    const workflow = existing?.workflowStatus || "discovered";
    const assignee = existing?.assigneeUserId || null;
    await db.prepare(`
      INSERT INTO newsroom_stories (
        id, topic_key, title, editoria, priority, editorial_queue, workflow_status, score, assignee_user_id,
        verification_level, first_seen_at, last_seen_at, last_changed_at, source_count, item_count, latest_run_id,
        snapshot_json, change_summary_json, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_key) DO UPDATE SET
        title=excluded.title, editoria=excluded.editoria, priority=excluded.priority, editorial_queue=excluded.editorial_queue,
        score=excluded.score, verification_level=excluded.verification_level, last_seen_at=excluded.last_seen_at,
        last_changed_at=excluded.last_changed_at, source_count=excluded.source_count, item_count=excluded.item_count,
        latest_run_id=excluded.latest_run_id, snapshot_json=excluded.snapshot_json, change_summary_json=excluded.change_summary_json,
        updated_at=excluded.updated_at
    `).bind(
      id, topicKey, String(topic.title || "Assunto em acompanhamento").slice(0, 240), topic.editoria || "Notícias",
      topic.priority || "Em observação", queue, workflow, Number(topic.score) || 0, assignee, verification,
      firstSeenAt, at, lastChangedAt, Number(topic.sourceCount) || 0, Number(topic.itemCount) || 0, runId,
      JSON.stringify(current), JSON.stringify(changes), existing?.publishedAt || null, at,
    ).run();
    if (changes.changed) {
      await db.prepare("INSERT INTO newsroom_story_events (id, story_id, event_type, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, existing ? "changed" : "discovered", changes.text, JSON.stringify(changes), at).run();
    }
    output.push(await getNewsroomStory(db, id));
  }
  return output.filter(Boolean);
}

export async function getNewsroomStory(db, id) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT * FROM newsroom_stories WHERE id = ? LIMIT 1").bind(id).first();
  if (!row) return null;
  const story = newsroomStoryRow(row);
  const [events, notes, followers] = await Promise.all([
    db.prepare("SELECT * FROM newsroom_story_events WHERE story_id = ? ORDER BY created_at DESC LIMIT 20").bind(id).all(),
    db.prepare("SELECT n.*, u.display_name FROM newsroom_story_notes n LEFT JOIN users u ON u.id=n.user_id WHERE story_id = ? ORDER BY created_at DESC LIMIT 20").bind(id).all(),
    db.prepare("SELECT COUNT(*) AS count FROM newsroom_story_followers WHERE story_id = ?").bind(id).first(),
  ]);
  story.events = (events?.results || []).map((event) => ({ id:event.id, type:event.event_type, summary:event.summary, payload:parseJsonObject(event.payload_json, {}), createdAt:event.created_at }));
  story.notes = (notes?.results || []).map((note) => ({ id:note.id, userId:note.user_id, displayName:note.display_name || "Redação", note:note.note, createdAt:note.created_at }));
  story.followerCount = Number(followers?.count) || 0;
  return story;
}

export async function listNewsroomStories(db, { limit = 80, queue = null, status = null } = {}) {
  await ensureSchema(db);
  const clauses = ["workflow_status <> 'discarded'"];
  const binds = [];
  if (queue) { clauses.push("editorial_queue = ?"); binds.push(queue); }
  if (status) { clauses.push("workflow_status = ?"); binds.push(status); }
  const safeLimit = Math.max(1, Math.min(150, Number(limit) || 80));
  const result = await db.prepare(`SELECT * FROM newsroom_stories WHERE ${clauses.join(" AND ")} ORDER BY CASE editorial_queue WHEN 'now' THEN 1 WHEN 'rising' THEN 2 WHEN 'watch' THEN 3 ELSE 4 END, last_changed_at DESC LIMIT ?`).bind(...binds, safeLimit).all();
  return (result?.results || []).map(newsroomStoryRow);
}

export async function updateNewsroomStory(db, id, patch = {}, actorUserId = null) {
  await ensureSchema(db);
  const current = await getNewsroomStory(db, id);
  if (!current) return null;
  const allowedStatuses = new Set(["discovered","selected","investigating","confirmed","production","published","discarded"]);
  const status = allowedStatuses.has(patch.workflowStatus) ? patch.workflowStatus : current.workflowStatus;
  const assignee = patch.assignToSelf ? actorUserId : patch.clearAssignee ? null : current.assigneeUserId;
  const publishedAt = status === "published" ? (current.publishedAt || new Date().toISOString()) : current.publishedAt;
  const now = new Date().toISOString();
  await db.prepare("UPDATE newsroom_stories SET workflow_status=?, assignee_user_id=?, published_at=?, updated_at=? WHERE id=?")
    .bind(status, assignee, publishedAt, now, id).run();
  const changes = [];
  if (status !== current.workflowStatus) changes.push(`status: ${status}`);
  if (assignee !== current.assigneeUserId) changes.push(assignee ? "pauta assumida" : "responsável removido");
  if (changes.length) await db.prepare("INSERT INTO newsroom_story_events (id, story_id, event_type, summary, payload_json, created_at) VALUES (?, ?, 'workflow', ?, ?, ?)")
    .bind(crypto.randomUUID(), id, changes.join(" · "), JSON.stringify({ status, assigneeUserId:assignee }), now).run();
  return getNewsroomStory(db, id);
}

export async function addNewsroomStoryNote(db, id, userId, note) {
  await ensureSchema(db);
  const text = String(note || "").replace(/\s+/g, " ").trim().slice(0, 800);
  if (!text) throw new Error("Nota vazia.");
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO newsroom_story_notes (id, story_id, user_id, note, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), id, userId, text, now).run();
  await db.prepare("INSERT INTO newsroom_story_events (id, story_id, event_type, summary, payload_json, created_at) VALUES (?, ?, 'note', ?, '{}', ?)")
    .bind(crypto.randomUUID(), id, "Nova nota editorial", now).run();
  return getNewsroomStory(db, id);
}

export async function toggleNewsroomStoryFollow(db, id, userId) {
  await ensureSchema(db);
  const existing = await db.prepare("SELECT 1 AS ok FROM newsroom_story_followers WHERE story_id=? AND user_id=?").bind(id,userId).first();
  if (existing) await db.prepare("DELETE FROM newsroom_story_followers WHERE story_id=? AND user_id=?").bind(id,userId).run();
  else await db.prepare("INSERT INTO newsroom_story_followers (story_id,user_id,created_at) VALUES (?,?,?)").bind(id,userId,new Date().toISOString()).run();
  return { following: !existing, story: await getNewsroomStory(db,id) };
}

export async function getNewsroomHandoff(db, { hours = 8 } = {}) {
  await ensureSchema(db);
  const safeHours = Math.max(1, Math.min(24, Number(hours) || 8));
  const cutoff = new Date(Date.now() - safeHours * 3600000).toISOString();
  const [stories, events] = await Promise.all([
    listNewsroomStories(db, { limit: 80 }),
    db.prepare("SELECT e.*, s.title, s.editoria FROM newsroom_story_events e JOIN newsroom_stories s ON s.id=e.story_id WHERE e.created_at>=? ORDER BY e.created_at DESC LIMIT 80").bind(cutoff).all(),
  ]);
  const pending = stories.filter((story) => !["published","discarded"].includes(story.workflowStatus));
  return {
    since: cutoff,
    counters: {
      changed: (events?.results || []).filter((event) => event.event_type === "changed").length,
      discovered: (events?.results || []).filter((event) => event.event_type === "discovered").length,
      urgent: pending.filter((story) => story.queue === "now").length,
      investigating: pending.filter((story) => story.workflowStatus === "investigating").length,
      unassigned: pending.filter((story) => !story.assigneeUserId).length,
    },
    attention: pending.filter((story) => story.queue === "now" || story.workflowStatus === "investigating").slice(0, 12),
    events: (events?.results || []).slice(0, 30).map((event) => ({ id:event.id, storyId:event.story_id, title:event.title, editoria:event.editoria, type:event.event_type, summary:event.summary, createdAt:event.created_at })),
  };
}

export async function databaseHealth(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT 1 AS ok").first();
  return Number(row?.ok) === 1;
}

export async function databaseSelfTest(db) {
  await ensureSchema(db);
  const id = `self-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let lock = null;
  try {
    await db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, 'self-test', 'self-test', ?, ?, 0, 0, 0, 0, NULL, NULL)
      `)
      .bind(id, now, now)
      .run();
    const written = await db.prepare("SELECT id FROM runs WHERE id = ?").bind(id).first();
    lock = await acquireLock(db, `self-test-lock-${id}`, 10_000);
    return written?.id === id && Boolean(lock);
  } finally {
    await releaseLock(db, lock);
    await db.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
  }
}


function publicUserRow(row) {
  if (!row) return null;
  const admin = String(row.email_key || row.email || '').toLowerCase() === ADMIN_EMAIL;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    defaultSlideCount: validateSlideCount(row.default_slide_count, DEFAULT_SLIDE_COUNT),
    role: admin ? 'admin' : (row.access_role || 'editor'),
    disabled: admin ? false : Number(row.access_disabled) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createEditorialUser(db, {
  id = crypto.randomUUID(), email, emailKey, displayName, passwordHash, passwordSalt,
  passwordIterations, defaultSlideCount = DEFAULT_SLIDE_COUNT,
} = {}) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO users (
      id, email, email_key, display_name, password_hash, password_salt,
      password_iterations, default_slide_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, email, emailKey, displayName, passwordHash, passwordSalt,
    Number.isFinite(Number(passwordIterations)) ? Math.max(0, Math.round(Number(passwordIterations))) : 120000, validateSlideCount(defaultSlideCount), now, now,
  ).run();
  return { id, email, displayName, defaultSlideCount: validateSlideCount(defaultSlideCount), createdAt: now, updatedAt: now };
}

export async function getEditorialUserByEmailKey(db, emailKey) {
  await ensureSchema(db);
  const row = await db.prepare(`
    SELECT u.*, a.role AS access_role, a.disabled AS access_disabled
    FROM users u LEFT JOIN user_access a ON a.user_id = u.id
    WHERE u.email_key = ? LIMIT 1
  `).bind(emailKey).first();
  if (!row) return null;
  return {
    ...publicUserRow(row),
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordIterations: Number.isFinite(Number(row.password_iterations)) ? Number(row.password_iterations) : 120000,
  };
}

export async function getEditorialUserById(db, userId) {
  await ensureSchema(db);
  const row = await db.prepare(`
    SELECT u.*, a.role AS access_role, a.disabled AS access_disabled
    FROM users u LEFT JOIN user_access a ON a.user_id = u.id
    WHERE u.id = ? LIMIT 1
  `).bind(userId).first();
  return publicUserRow(row);
}

export async function updateEditorialUserPassword(db, userId, { passwordHash, passwordSalt, passwordIterations } = {}) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  await db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?`)
    .bind(passwordHash, passwordSalt, Number(passwordIterations) || 120000, updatedAt, userId).run();
  return getEditorialUserById(db, userId);
}

export async function createUserSession(db, { tokenHash, userId, ttlDays = 30 } = {}) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlDays) || 30) * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tokenHash, userId, now, now, expiresAt).run();
  return { createdAt: now, expiresAt };
}

export async function getUserBySessionHash(db, tokenHash) {
  await ensureSchema(db);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const idleCutoff = new Date(nowMs - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
  const row = await db.prepare(`
    SELECT u.*, a.role AS access_role, a.disabled AS access_disabled,
           s.expires_at AS session_expires_at, s.last_seen_at AS session_last_seen_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_access a ON a.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row) return null;
  if (String(row.session_last_seen_at || '') < idleCutoff) {
    await db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(tokenHash).run().catch(() => null);
    return null;
  }
  const user = publicUserRow(row);
  if (user?.disabled) {
    await db.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(user.id).run().catch(() => null);
    return null;
  }
  const lastSeenMs = Date.parse(row.session_last_seen_at || '');
  if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs >= SESSION_TOUCH_MINUTES * 60 * 1000) {
    db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(now, tokenHash).run().catch(() => null);
  }
  return { ...user, sessionExpiresAt: row.session_expires_at, sessionLastSeenAt: row.session_last_seen_at };
}

export async function deleteUserSession(db, tokenHash) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(tokenHash).run();
  return true;
}

export async function ensureUserAccess(db, userId, email, defaultRole = 'editor') {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const admin = String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
  const role = admin ? 'admin' : (['user','editor','reviewer','publisher'].includes(defaultRole) ? defaultRole : 'editor');
  await db.prepare(`
    INSERT INTO user_access (user_id, role, disabled, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      role = CASE WHEN ? = 1 THEN 'admin' ELSE user_access.role END,
      disabled = CASE WHEN ? = 1 THEN 0 ELSE user_access.disabled END,
      updated_at = excluded.updated_at
  `).bind(userId, role, now, now, admin ? 1 : 0, admin ? 1 : 0).run();
  return getEditorialUserById(db, userId);
}

export async function cleanupIdleUserSessions(db, idleMinutes = SESSION_IDLE_MINUTES) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - Math.max(5, Number(idleMinutes) || SESSION_IDLE_MINUTES) * 60 * 1000).toISOString();
  const result = await db.prepare("DELETE FROM user_sessions WHERE expires_at <= ? OR last_seen_at < ?").bind(now, cutoff).run();
  return Number(result?.meta?.changes) || 0;
}

export async function userHasActiveSeat(db, userId, idleMinutes = SESSION_IDLE_MINUTES) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - idleMinutes * 60 * 1000).toISOString();
  const row = await db.prepare(`SELECT 1 AS active FROM user_sessions WHERE user_id = ? AND expires_at > ? AND last_seen_at >= ? LIMIT 1`)
    .bind(userId, now, cutoff).first();
  return Boolean(row?.active);
}

export async function countActiveEditorialUsers(db, idleMinutes = SESSION_IDLE_MINUTES) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - idleMinutes * 60 * 1000).toISOString();
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT s.user_id) AS total
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_access a ON a.user_id = u.id
    WHERE s.expires_at > ? AND s.last_seen_at >= ?
      AND LOWER(u.email_key) <> ?
      AND COALESCE(a.role, 'editor') <> 'admin'
      AND COALESCE(a.disabled, 0) = 0
  `).bind(now, cutoff, ADMIN_EMAIL).first();
  return Number(row?.total) || 0;
}

export async function revokeUserSessions(db, userId) {
  await ensureSchema(db);
  const result = await db.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM user_presence WHERE user_id = ?").bind(userId).run().catch(() => null);
  return Number(result?.meta?.changes) || 0;
}

export async function setUserAccessDisabled(db, userId, disabled = true) {
  await ensureSchema(db);
  const user = await getEditorialUserById(db, userId);
  if (!user) return null;
  if (String(user.email || '').toLowerCase() === ADMIN_EMAIL) return user;
  await ensureUserAccess(db, userId, user.email, user.role || 'editor');
  const now = new Date().toISOString();
  await db.prepare("UPDATE user_access SET disabled = ?, updated_at = ? WHERE user_id = ?")
    .bind(disabled ? 1 : 0, now, userId).run();
  if (disabled) await revokeUserSessions(db, userId).catch(() => null);
  return getEditorialUserById(db, userId);
}

export async function setUserAccessRole(db, userId, role) {
  await ensureSchema(db);
  const user = await getEditorialUserById(db, userId);
  if (!user) return null;
  if (String(user.email || '').toLowerCase() === ADMIN_EMAIL) return user;
  const normalized = ['user','editor','reviewer','publisher'].includes(String(role)) ? String(role) : 'editor';
  await ensureUserAccess(db, userId, user.email, normalized);
  const now = new Date().toISOString();
  await db.prepare("UPDATE user_access SET role = ?, updated_at = ? WHERE user_id = ?").bind(normalized, now, userId).run();
  return getEditorialUserById(db, userId);
}

function groupNameKey(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
}

export async function createEditorialGroup(db, name) {
  await ensureSchema(db);
  const clean = String(name || '').replace(/\s+/g,' ').trim().slice(0,80);
  if (clean.length < 2) throw new Error('Informe um nome de grupo com pelo menos 2 caracteres.');
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await db.prepare("INSERT INTO editorial_groups (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, clean, groupNameKey(clean), now, now).run();
  return { id, name: clean, members: [], createdAt: now, updatedAt: now };
}

export async function updateEditorialGroup(db, id, name) {
  await ensureSchema(db);
  const clean = String(name || '').replace(/\s+/g,' ').trim().slice(0,80);
  if (clean.length < 2) throw new Error('Informe um nome válido.');
  const now = new Date().toISOString();
  await db.prepare("UPDATE editorial_groups SET name = ?, name_key = ?, updated_at = ? WHERE id = ?")
    .bind(clean, groupNameKey(clean), now, id).run();
  return listEditorialGroups(db).then(groups => groups.find(group => group.id === id) || null);
}

export async function deleteEditorialGroup(db, id) {
  await ensureSchema(db);
  await db.batch([
    db.prepare("DELETE FROM editorial_group_members WHERE group_id = ?").bind(id),
    db.prepare("DELETE FROM editorial_groups WHERE id = ?").bind(id),
  ]);
  return true;
}

export async function addEditorialGroupMember(db, groupId, userId) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO editorial_group_members (group_id, user_id, created_at) VALUES (?, ?, ?)")
    .bind(groupId, userId, now).run();
  return true;
}

export async function removeEditorialGroupMember(db, groupId, userId) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM editorial_group_members WHERE group_id = ? AND user_id = ?").bind(groupId, userId).run();
  return true;
}

export async function listEditorialGroups(db) {
  await ensureSchema(db);
  const [groupsResult, membersResult] = await Promise.all([
    db.prepare("SELECT * FROM editorial_groups ORDER BY name COLLATE NOCASE").all(),
    db.prepare(`SELECT m.group_id, u.id AS user_id, u.email, u.display_name FROM editorial_group_members m JOIN users u ON u.id = m.user_id ORDER BY u.display_name COLLATE NOCASE`).all(),
  ]);
  const membersByGroup = new Map();
  for (const row of membersResult?.results || []) {
    const list = membersByGroup.get(row.group_id) || [];
    list.push({ id: row.user_id, email: row.email, displayName: row.display_name });
    membersByGroup.set(row.group_id, list);
  }
  return (groupsResult?.results || []).map(row => ({
    id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at,
    members: membersByGroup.get(row.id) || [],
  }));
}

export async function listAdminUsers(db) {
  await ensureSchema(db);
  await cleanupIdleUserSessions(db);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
  const [usersResult, groups] = await Promise.all([
    db.prepare(`
      SELECT u.*, a.role AS access_role, a.disabled AS access_disabled,
             MAX(CASE WHEN s.expires_at > ? AND s.last_seen_at >= ? THEN s.last_seen_at ELSE NULL END) AS active_last_seen,
             COUNT(DISTINCT CASE WHEN s.expires_at > ? AND s.last_seen_at >= ? THEN s.token_hash ELSE NULL END) AS active_sessions,
             p.area AS current_area, p.last_activity_at AS presence_at,
             COALESCE((SELECT SUM(d.active_ms) FROM usage_daily_users d WHERE d.user_id=u.id),0) AS total_active_ms,
             COALESCE((SELECT SUM(d.active_ms) FROM usage_daily_users d WHERE d.user_id=u.id AND d.day=date('now')),0) AS today_active_ms
      FROM users u
      LEFT JOIN user_access a ON a.user_id = u.id
      LEFT JOIN user_sessions s ON s.user_id = u.id
      LEFT JOIN user_presence p ON p.user_id = u.id
      GROUP BY u.id
      ORDER BY active_last_seen DESC, u.created_at DESC
    `).bind(now, cutoff, now, cutoff).all(),
    listEditorialGroups(db),
  ]);
  const groupMap = new Map();
  for (const group of groups) for (const member of group.members) {
    const list = groupMap.get(member.id) || []; list.push({ id: group.id, name: group.name }); groupMap.set(member.id, list);
  }
  return (usersResult?.results || []).map(row => {
    const user = publicUserRow(row);
    return { ...user, active: Number(row.active_sessions) > 0, activeSessions: Number(row.active_sessions)||0,
      lastSeenAt: row.active_last_seen || row.presence_at || null, currentArea: row.current_area || null,
      todayActiveMs: Number(row.today_active_ms)||0, totalActiveMs: Number(row.total_active_ms)||0,
      groups: groupMap.get(user.id) || [] };
  });
}



function parseCarouselVersion(row) {
  if (!row) return null;
  let payload = null; try { payload = JSON.parse(row.payload_json || 'null'); } catch {}
  return { id:row.id, jobId:row.job_id||null, cacheKey:row.cache_key||null, topicId:row.topic_id||null, userId:row.user_id||null,
    kind:row.kind||'carousel', versionNumber:Number(row.version_number)||1, title:row.title||'', status:row.status||'draft', payload,
    qualityScore:row.quality_score==null?null:Number(row.quality_score), confidenceScore:row.confidence_score==null?null:Number(row.confidence_score),
    note:row.note||null, createdBy:row.created_by||null, createdAt:row.created_at };
}

export async function saveCarouselVersion(db,{jobId=null,cacheKey=null,topicId=null,userId=null,kind='carousel',title='',payload,status='draft',qualityScore=null,confidenceScore=null,note=null,createdBy=null}={}){
  await ensureSchema(db); if(!payload||typeof payload!=='object') throw new Error('Payload da versão é obrigatório.');
  const where=jobId?'job_id = ?':topicId?'topic_id = ?':null; const key=jobId||topicId;
  let number=1;if(where){const row=await db.prepare(`SELECT MAX(version_number) AS max_version FROM carousel_versions WHERE ${where}`).bind(key).first();number=(Number(row?.max_version)||0)+1;}
  const id=crypto.randomUUID(),createdAt=new Date().toISOString();
  const payloadJson=JSON.stringify(payload); if(payloadJson.length>1500000) throw new Error('Esta versão excede o limite seguro de 1,5 MB. Remova assets incorporados pesados e tente novamente.');
  await db.prepare(`INSERT INTO carousel_versions(id,job_id,cache_key,topic_id,user_id,kind,version_number,title,status,payload_json,quality_score,confidence_score,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,jobId,cacheKey,topicId,userId,String(kind||'carousel').slice(0,30),number,String(title||'').slice(0,220),String(status||'draft').slice(0,30),payloadJson,qualityScore==null?null:Number(qualityScore),confidenceScore==null?null:Number(confidenceScore),note?String(note).slice(0,600):null,createdBy||userId||null,createdAt).run();
  return getCarouselVersion(db,id);
}

export async function getCarouselVersion(db,id){await ensureSchema(db);return parseCarouselVersion(await db.prepare('SELECT * FROM carousel_versions WHERE id=? LIMIT 1').bind(id).first());}
export async function listCarouselVersions(db,{jobId=null,topicId=null,limit=40}={}){await ensureSchema(db);const take=Math.max(1,Math.min(100,Number(limit)||40));let sql='SELECT * FROM carousel_versions',params=[];if(jobId){sql+=' WHERE job_id=?';params=[jobId];}else if(topicId){sql+=' WHERE topic_id=?';params=[topicId];}sql+=' ORDER BY created_at DESC LIMIT ?';params.push(take);const out=await db.prepare(sql).bind(...params).all();return (out?.results||[]).map(parseCarouselVersion);}

function parseWorkflow(row){if(!row)return null;return {id:row.id,subjectType:row.subject_type,subjectId:row.subject_id,versionId:row.version_id||null,title:row.title||'',status:row.status||'draft',ownerUserId:row.owner_user_id||null,assigneeUserId:row.assignee_user_id||null,groupId:row.group_id||null,createdBy:row.created_by,reviewedBy:row.reviewed_by||null,approvedBy:row.approved_by||null,publishedBy:row.published_by||null,rejectionReason:row.rejection_reason||null,note:row.note||null,createdAt:row.created_at,updatedAt:row.updated_at,submittedAt:row.submitted_at||null,reviewedAt:row.reviewed_at||null,approvedAt:row.approved_at||null,publishedAt:row.published_at||null};}
async function workflowEvent(db,workflowId,eventType,{fromStatus=null,toStatus=null,userId=null,note=null,payload=null}={}){await db.prepare('INSERT INTO production_workflow_events(id,workflow_id,event_type,from_status,to_status,user_id,note,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),workflowId,eventType,fromStatus,toStatus,userId,note?String(note).slice(0,600):null,payload?JSON.stringify(payload).slice(0,8000):'{}',new Date().toISOString()).run();}
export async function createWorkflowItem(db,{subjectType='carousel',subjectId,versionId=null,title='',ownerUserId=null,assigneeUserId=null,groupId=null,createdBy}={}){
  await ensureSchema(db);
  if(!subjectId||!createdBy)throw new Error('Assunto e autor são obrigatórios.');
  const existing=await db.prepare("SELECT * FROM production_workflow WHERE subject_type=? AND subject_id=? AND status NOT IN ('published','archived') ORDER BY created_at DESC LIMIT 1").bind(subjectType,subjectId).first();
  if(existing){
    const current=parseWorkflow(existing); const at=new Date().toISOString();
    const nextVersion=versionId||current.versionId; const nextTitle=String(title||current.title||'').slice(0,220);
    const nextOwner=ownerUserId||current.ownerUserId||createdBy; const nextAssignee=assigneeUserId===null?current.assigneeUserId:assigneeUserId; const nextGroup=groupId===null?current.groupId:groupId;
    await db.prepare('UPDATE production_workflow SET version_id=?,title=?,owner_user_id=?,assignee_user_id=?,group_id=?,updated_at=? WHERE id=?').bind(nextVersion,nextTitle,nextOwner,nextAssignee,nextGroup,at,current.id).run();
    if(versionId&&versionId!==current.versionId)await workflowEvent(db,current.id,'version_updated',{fromStatus:current.status,toStatus:current.status,userId:createdBy,payload:{previousVersionId:current.versionId,versionId}});
    return getWorkflowItem(db,current.id);
  }
  const id=crypto.randomUUID(),at=new Date().toISOString();
  await db.prepare(`INSERT INTO production_workflow(id,subject_type,subject_id,version_id,title,status,owner_user_id,assignee_user_id,group_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?)`).bind(id,subjectType,subjectId,versionId,String(title||'').slice(0,220),ownerUserId||createdBy,assigneeUserId,groupId,createdBy,at,at).run();
  await workflowEvent(db,id,'created',{toStatus:'draft',userId:createdBy});
  return getWorkflowItem(db,id);
}
export async function getWorkflowItem(db,id){await ensureSchema(db);const row=await db.prepare('SELECT * FROM production_workflow WHERE id=? LIMIT 1').bind(id).first();if(!row)return null;const item=parseWorkflow(row);const events=(await db.prepare('SELECT * FROM production_workflow_events WHERE workflow_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all())?.results||[];item.events=events.map(e=>({id:e.id,eventType:e.event_type,fromStatus:e.from_status||null,toStatus:e.to_status||null,userId:e.user_id||null,note:e.note||null,createdAt:e.created_at}));return item;}
export async function listWorkflowItems(db,{status=null,userId=null,limit=100}={}){await ensureSchema(db);const where=[],args=[];if(status){where.push('status=?');args.push(status);}if(userId){where.push('(owner_user_id=? OR assignee_user_id=? OR created_by=?)');args.push(userId,userId,userId);}const sql=`SELECT * FROM production_workflow ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY updated_at DESC LIMIT ?`;args.push(Math.max(1,Math.min(200,Number(limit)||100)));const rows=(await db.prepare(sql).bind(...args).all())?.results||[];return rows.map(parseWorkflow);}
export async function transitionWorkflowItem(db,id,{action,userId,role='user',note=null,assigneeUserId=undefined,groupId=undefined}={}){await ensureSchema(db);const row=await db.prepare('SELECT * FROM production_workflow WHERE id=? LIMIT 1').bind(id).first();if(!row)return null;const current=parseWorkflow(row);const admin=role==='admin';const editor=admin||role==='editor'||role==='reviewer'||role==='publisher';const reviewer=admin||role==='reviewer'||role==='publisher';const publisher=admin||role==='publisher';let next=current.status,fields={};switch(action){case 'submit':if(!editor||!['draft','rejected'].includes(current.status))throw new Error('Este item não pode ser enviado para revisão.');next='in_review';fields.submitted_at=new Date().toISOString();fields.rejection_reason=null;break;case 'approve':if(!reviewer||current.status!=='in_review')throw new Error('Aprovação exige função de revisor/publicador e item em revisão.');next='approved';fields.reviewed_by=userId;fields.approved_by=userId;fields.reviewed_at=new Date().toISOString();fields.approved_at=fields.reviewed_at;break;case 'reject':if(!reviewer||current.status!=='in_review')throw new Error('Rejeição exige item em revisão.');next='rejected';fields.reviewed_by=userId;fields.reviewed_at=new Date().toISOString();fields.rejection_reason=String(note||'Ajustes solicitados.').slice(0,600);break;case 'publish':if(!publisher||current.status!=='approved')throw new Error('Publicação exige função de publicador e item aprovado.');next='published';fields.published_by=userId;fields.published_at=new Date().toISOString();break;case 'return_draft':if(!editor||!['in_review','approved','rejected'].includes(current.status))throw new Error('Não é possível retornar este item para rascunho.');next='draft';break;case 'assign':if(!editor)throw new Error('Sem permissão para atribuir.');break;default:throw new Error('Ação de workflow inválida.');}
  const at=new Date().toISOString();const assignment=assigneeUserId===undefined?current.assigneeUserId:assigneeUserId;const group=groupId===undefined?current.groupId:groupId;
  await db.prepare(`UPDATE production_workflow SET status=?,assignee_user_id=?,group_id=?,reviewed_by=COALESCE(?,reviewed_by),approved_by=COALESCE(?,approved_by),published_by=COALESCE(?,published_by),rejection_reason=?,note=COALESCE(?,note),submitted_at=COALESCE(?,submitted_at),reviewed_at=COALESCE(?,reviewed_at),approved_at=COALESCE(?,approved_at),published_at=COALESCE(?,published_at),updated_at=? WHERE id=?`).bind(next,assignment,group,fields.reviewed_by||null,fields.approved_by||null,fields.published_by||null,fields.rejection_reason===undefined?current.rejectionReason:fields.rejection_reason,note?String(note).slice(0,600):null,fields.submitted_at||null,fields.reviewed_at||null,fields.approved_at||null,fields.published_at||null,at,id).run();
  await workflowEvent(db,id,action,{fromStatus:current.status,toStatus:next,userId,note,payload:{assigneeUserId:assignment,groupId:group}});return getWorkflowItem(db,id);
}

export async function recordWatchdogEvent(db,{eventType,severity='info',subjectId=null,detail=null,metadata=null,status='open'}={}){await ensureSchema(db);const id=crypto.randomUUID(),at=new Date().toISOString();await db.prepare('INSERT INTO watchdog_events(id,event_type,severity,subject_id,status,detail,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,String(eventType||'watchdog').slice(0,80),String(severity||'info').slice(0,20),subjectId,status,detail?String(detail).slice(0,800):null,metadata?JSON.stringify(metadata).slice(0,8000):'{}',at).run();return id;}
export async function listWatchdogEvents(db,{hours=24,limit=100}={}){await ensureSchema(db);const cutoff=new Date(Date.now()-Math.max(1,Number(hours)||24)*3600000).toISOString();const rows=(await db.prepare('SELECT * FROM watchdog_events WHERE created_at>=? ORDER BY created_at DESC LIMIT ?').bind(cutoff,Math.max(1,Math.min(300,Number(limit)||100))).all())?.results||[];return rows.map(r=>({id:r.id,eventType:r.event_type,severity:r.severity,subjectId:r.subject_id||null,status:r.status,detail:r.detail||null,createdAt:r.created_at,resolvedAt:r.resolved_at||null}));}

export async function getCostMonitor(db,{hours=24,estimatedCallUsd=0}={}){await ensureSchema(db);const cutoff=new Date(Date.now()-Math.max(1,Number(hours)||24)*3600000).toISOString().slice(0,13);const rows=(await db.prepare("SELECT metric,SUM(value) AS value,SUM(samples) AS samples,SUM(total_ms) AS total_ms FROM usage_metrics WHERE granularity='hour' AND bucket>=? AND (metric LIKE 'ai_%' OR metric LIKE 'carousel_%') GROUP BY metric").bind(cutoff).all())?.results||[];const metrics=Object.fromEntries(rows.map(r=>[r.metric,{value:Number(r.value)||0,samples:Number(r.samples)||0,totalMs:Number(r.total_ms)||0}]));const aiCalls=Object.entries(metrics).filter(([k])=>/^ai_.*_calls$/.test(k)).reduce((sum,[,v])=>sum+v.value,0);return {hours:Number(hours)||24,metrics,aiCalls,estimatedUsd:Number((aiCalls*Math.max(0,Number(estimatedCallUsd)||0)).toFixed(4)),estimateOnly:true,note:'Estimativa interna por chamada. O faturamento real deve ser conferido no Cloudflare.'};}

export async function startCarouselReliabilityAttempt(db, {
  jobId, cacheKey = null, userId = null, runId = null, topicId = null, slideCount = 7,
  startedAt = new Date().toISOString(),
} = {}) {
  await ensureSchema(db);
  if (!jobId) return null;
  await db.prepare(`
    INSERT OR IGNORE INTO carousel_reliability (
      job_id, cache_key, user_id, run_id, topic_id, slide_count, status, recovered,
      queue_attempts, failure_stage, error_code, error_detail, started_at, completed_at,
      duration_ms, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'attempted', 0, 0, NULL, NULL, NULL, ?, NULL, 0, ?)
  `).bind(
    jobId, cacheKey, userId, runId, topicId,
    Math.max(3, Math.min(15, Number(slideCount) || 7)),
    startedAt, startedAt,
  ).run();
  return true;
}

export async function touchCarouselReliabilityAttempt(db, {
  jobId, queueAttempts = null, recovered = null,
} = {}) {
  await ensureSchema(db);
  if (!jobId) return null;
  const row = await db.prepare("SELECT queue_attempts,recovered FROM carousel_reliability WHERE job_id=? LIMIT 1").bind(jobId).first();
  if (!row) return null;
  const updatedAt = new Date().toISOString();
  await db.prepare(`
    UPDATE carousel_reliability SET queue_attempts=?, recovered=?, updated_at=? WHERE job_id=?
  `).bind(
    queueAttempts == null ? Number(row.queue_attempts)||0 : Math.max(Number(row.queue_attempts)||0, Number(queueAttempts)||0),
    recovered == null ? Number(row.recovered)||0 : (recovered ? 1 : Number(row.recovered)||0),
    updatedAt, jobId,
  ).run();
  return true;
}

export async function finishCarouselReliabilityAttempt(db, {
  jobId, status, recovered = false, queueAttempts = null,
  failureStage = null, errorCode = null, errorDetail = null,
  completedAt = new Date().toISOString(),
} = {}) {
  await ensureSchema(db);
  if (!jobId || !['succeeded','failed'].includes(status)) return null;
  const row = await db.prepare("SELECT * FROM carousel_reliability WHERE job_id=? LIMIT 1").bind(jobId).first();
  if (!row) return null;

  if (['succeeded','failed'].includes(String(row.status))) {
    if (recovered && !Number(row.recovered)) {
      await db.prepare("UPDATE carousel_reliability SET recovered=1,updated_at=? WHERE job_id=?")
        .bind(completedAt,jobId).run();
    }
    return {status:row.status,alreadyTerminal:true};
  }

  const startMs=Date.parse(row.started_at||'');
  const endMs=Date.parse(completedAt);
  const durationMs=Number.isFinite(startMs)&&Number.isFinite(endMs)?Math.max(0,endMs-startMs):0;

  await db.prepare(`
    UPDATE carousel_reliability SET
      status=?, recovered=?, queue_attempts=?, failure_stage=?, error_code=?, error_detail=?,
      completed_at=?, duration_ms=?, updated_at=?
    WHERE job_id=?
  `).bind(
    status,
    recovered ? 1 : Number(row.recovered)||0,
    queueAttempts == null ? Number(row.queue_attempts)||0 : Math.max(Number(row.queue_attempts)||0,Number(queueAttempts)||0),
    status==='failed' ? String(failureStage||'unknown').slice(0,40) : null,
    status==='failed' && errorCode ? String(errorCode).slice(0,80) : null,
    status==='failed' && errorDetail ? String(errorDetail).slice(0,300) : null,
    completedAt,durationMs,completedAt,jobId,
  ).run();
  return {status,alreadyTerminal:false,durationMs};
}

export async function getCarouselReliabilitySummary(db,{hours=24}={}) {
  await ensureSchema(db);
  const safeHours=Math.max(1,Math.min(720,Number(hours)||24));
  const cutoff=new Date(Date.now()-safeHours*60*60*1000).toISOString();

  const [summary,recent,stages]=await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS attempts,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status='attempted' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN recovered=1 AND status='succeeded' THEN 1 ELSE 0 END) AS recovered,
        COALESCE(AVG(CASE WHEN status='succeeded' THEN duration_ms END),0) AS avg_success_ms
      FROM carousel_reliability WHERE started_at>=?
    `).bind(cutoff).first(),
    db.prepare(`
      SELECT job_id,status,recovered,failure_stage,completed_at,duration_ms
      FROM carousel_reliability
      WHERE status IN ('succeeded','failed')
      ORDER BY completed_at DESC LIMIT 10
    `).all(),
    db.prepare(`
      SELECT COALESCE(failure_stage,'unknown') AS stage,COUNT(*) AS total
      FROM carousel_reliability
      WHERE status='failed' AND started_at>=?
      GROUP BY COALESCE(failure_stage,'unknown')
      ORDER BY total DESC
    `).bind(cutoff).all(),
  ]);

  const succeeded=Number(summary?.succeeded)||0;
  const failed=Number(summary?.failed)||0;
  const terminal=succeeded+failed;
  const successRate=terminal?succeeded/terminal:null;
  const rows=recent?.results||[];
  const recentSucceeded=rows.filter(r=>r.status==='succeeded').length;
  const recentFailed=rows.filter(r=>r.status==='failed').length;
  const recentTerminal=recentSucceeded+recentFailed;
  const recentRate=recentTerminal?recentSucceeded/recentTerminal:null;

  return {
    target:0.90,targetLabel:'9/10',windowHours:safeHours,
    attempts:Number(summary?.attempts)||0,terminal,succeeded,failed,
    active:Number(summary?.active)||0,recovered:Number(summary?.recovered)||0,
    successRate,successPercent:successRate==null?null:Math.round(successRate*1000)/10,
    averageSuccessMs:Math.round(Number(summary?.avg_success_ms)||0),
    sampleReady:terminal>=10,onTarget:terminal>=10?successRate>=0.90:null,
    recent10:{
      completed:recentTerminal,succeeded:recentSucceeded,failed:recentFailed,
      successRate:recentRate,successPercent:recentRate==null?null:Math.round(recentRate*1000)/10,
      onTarget:recentTerminal>=10?recentSucceeded>=9:null,
    },
    failureStages:(stages?.results||[]).map(r=>({stage:r.stage,total:Number(r.total)||0})),
  };
}

export async function recordUsageMetric(db, metric, { value = 1, samples = 1, durationMs = 0, at = new Date() } = {}) {
  await ensureSchema(db);
  const date = at instanceof Date ? at : new Date(at);
  const iso = Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  const rows = [
    { bucket: iso.slice(0,13), granularity: 'hour' },
    { bucket: iso.slice(0,10), granularity: 'day' },
  ];
  const updatedAt = new Date().toISOString();
  await db.batch(rows.map(row => db.prepare(`
    INSERT INTO usage_metrics (bucket, granularity, metric, value, samples, total_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket, granularity, metric) DO UPDATE SET
      value = usage_metrics.value + excluded.value,
      samples = usage_metrics.samples + excluded.samples,
      total_ms = usage_metrics.total_ms + excluded.total_ms,
      updated_at = excluded.updated_at
  `).bind(row.bucket, row.granularity, String(metric), Number(value)||0, Math.max(0,Number(samples)||0), Math.max(0,Math.round(Number(durationMs)||0)), updatedAt)));
  return true;
}

export async function recordUserActivity(db, userId, area = 'ronda') {
  await ensureSchema(db);
  const allowed = new Set(['ronda','design','projects','admin']);
  const currentArea = allowed.has(String(area)) ? String(area) : 'ronda';
  const nowMs = Date.now(); const now = new Date(nowMs).toISOString(); const day = now.slice(0,10);
  const previous = await db.prepare("SELECT area, last_activity_at FROM user_presence WHERE user_id = ? LIMIT 1").bind(userId).first();
  const previousMs = Date.parse(previous?.last_activity_at || '');
  const rawDelta = Number.isFinite(previousMs) ? nowMs - previousMs : 0;
  const deltaMs = rawDelta > 0 && rawDelta <= 10 * 60 * 1000 ? Math.min(rawDelta, SESSION_TOUCH_MINUTES * 60 * 1000) : 0;
  const creditArea = previous?.area || currentArea;
  await db.prepare(`
    INSERT INTO user_presence (user_id, area, last_activity_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET area=excluded.area, last_activity_at=excluded.last_activity_at, updated_at=excluded.updated_at
  `).bind(userId, currentArea, now, now).run();
  if (deltaMs > 0) {
    await db.prepare(`
      INSERT INTO usage_daily_users (day, user_id, area, active_ms, last_activity_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, user_id, area) DO UPDATE SET active_ms = usage_daily_users.active_ms + excluded.active_ms, last_activity_at = excluded.last_activity_at
    `).bind(day, userId, creditArea, deltaMs, now).run();
  }
  return { area: currentArea, activeDeltaMs: deltaMs, idleMinutes: SESSION_IDLE_MINUTES, touchedAt: now };
}

function metricRow(row) {
  return row ? { value:Number(row.value)||0, samples:Number(row.samples)||0, totalMs:Number(row.total_ms)||0 } : { value:0, samples:0, totalMs:0 };
}

export async function getAdminDashboard(db) {
  await ensureSchema(db);
  await cleanupIdleUserSessions(db);
  const now = new Date(); const day = now.toISOString().slice(0,10); const hour = now.toISOString().slice(0,13); const month = day.slice(0,7);
  const cutoff24 = new Date(now.getTime()-24*60*60*1000).toISOString().slice(0,13);
  const cutoff30 = new Date(now.getTime()-30*24*60*60*1000).toISOString().slice(0,10);
  const [activeUsers, registeredRow, groupsRow, dayMetrics, hourMetrics, monthTopics, hourlyTopics, dailyTopics, appUsage, designUsage,
    jobRows, runRows, cacheRows, articleRows, sourceRows, navigationRows, carouselReliability, reliabilityCore] = await Promise.all([
    countActiveEditorialUsers(db),
    db.prepare("SELECT COUNT(*) AS total FROM users").first(),
    db.prepare("SELECT COUNT(*) AS total FROM editorial_groups").first(),
    db.prepare("SELECT metric,value,samples,total_ms FROM usage_metrics WHERE granularity='day' AND bucket=?").bind(day).all(),
    db.prepare("SELECT metric,value,samples,total_ms FROM usage_metrics WHERE granularity='hour' AND bucket=?").bind(hour).all(),
    db.prepare("SELECT COALESCE(SUM(value),0) AS total FROM usage_metrics WHERE granularity='day' AND metric='topics_generated' AND substr(bucket,1,7)=?").bind(month).first(),
    db.prepare("SELECT bucket,value FROM usage_metrics WHERE granularity='hour' AND metric='topics_generated' AND bucket>=? ORDER BY bucket").bind(cutoff24).all(),
    db.prepare("SELECT bucket,value FROM usage_metrics WHERE granularity='day' AND metric='topics_generated' AND bucket>=? ORDER BY bucket").bind(cutoff30).all(),
    db.prepare("SELECT user_id, SUM(active_ms) AS active_ms FROM usage_daily_users WHERE day=? GROUP BY user_id").bind(day).all(),
    db.prepare("SELECT user_id, SUM(active_ms) AS active_ms FROM usage_daily_users WHERE day=? AND area='design' GROUP BY user_id").bind(day).all(),
    db.prepare("SELECT status,COUNT(*) AS total FROM intelligent_jobs GROUP BY status").all(),
    db.prepare("SELECT status,COUNT(*) AS total FROM runs GROUP BY status").all(),
    db.prepare("SELECT (SELECT COUNT(*) FROM intelligent_carousels) AS carousels, (SELECT COUNT(*) FROM article_read_cache) AS articles").first(),
    db.prepare("SELECT COALESCE(SUM(attempts),0) AS attempts, COALESCE(SUM(successes),0) AS successes FROM article_source_stats").first(),
    db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status NOT IN ('failed','blocked','not-found') THEN 1 ELSE 0 END) AS healthy, SUM(CASE WHEN item_count>0 THEN 1 ELSE 0 END) AS with_content FROM source_state").first(),
    db.prepare("SELECT area, SUM(active_ms) AS active_ms, COUNT(DISTINCT user_id) AS users FROM usage_daily_users WHERE day=? GROUP BY area ORDER BY active_ms DESC").bind(day).all(),
    getCarouselReliabilitySummary(db,{hours:24}),
    getReliabilitySummary(db,{hours:24}),
  ]);
  const dayMap = Object.fromEntries((dayMetrics?.results||[]).map(row=>[row.metric,metricRow(row)]));
  const hourMap = Object.fromEntries((hourMetrics?.results||[]).map(row=>[row.metric,metricRow(row)]));
  const avg = rows => { const list=rows?.results||[]; return list.length ? Math.round(list.reduce((sum,row)=>sum+(Number(row.active_ms)||0),0)/list.length) : 0; };
  const statuses = rows => Object.fromEntries((rows?.results||[]).map(row=>[row.status,Number(row.total)||0]));
  const rounds = dayMap.rounds_completed || metricRow(null); const carousels = dayMap.carousels_generated || metricRow(null);
  return {
    generatedAt: now.toISOString(),
    seats: { active: activeUsers, maximum: MAX_ACTIVE_USERS, available: Math.max(0,MAX_ACTIVE_USERS-activeUsers), adminExcluded:true, idleMinutes:SESSION_IDLE_MINUTES },
    users: { registered:Number(registeredRow?.total)||0, groups:Number(groupsRow?.total)||0 },
    today: {
      rounds: Math.round(rounds.value), roundAverageMs: rounds.samples ? Math.round(rounds.totalMs/rounds.samples) : 0,
      carousels: Math.round(carousels.value), carouselAverageMs: carousels.samples ? Math.round(carousels.totalMs/carousels.samples) : 0,
      topics: Math.round((dayMap.topics_generated||{}).value||0), items: Math.round((dayMap.items_collected||{}).value||0),
      appAverageMs: avg(appUsage), designAverageMs: avg(designUsage),
    },
    topics: { hour:Math.round((hourMap.topics_generated||{}).value||0), day:Math.round((dayMap.topics_generated||{}).value||0), month:Math.round(Number(monthTopics?.total)||0),
      hourly:(hourlyTopics?.results||[]).map(row=>({bucket:row.bucket,value:Math.round(Number(row.value)||0)})),
      daily:(dailyTopics?.results||[]).map(row=>({bucket:row.bucket,value:Math.round(Number(row.value)||0)})) },
    health: { sources:{total:Number(sourceRows?.total)||0,healthy:Number(sourceRows?.healthy)||0,withContent:Number(sourceRows?.with_content)||0}, jobs:statuses(jobRows), runs:statuses(runRows) },
    resources: { carouselCache:Number(cacheRows?.carousels)||0, articleCache:Number(cacheRows?.articles)||0, articleReadAttempts:Number(articleRows?.attempts)||0, articleReadSuccesses:Number(articleRows?.successes)||0 },
    carouselReliability,
    reliabilityCore,
    navigation: (navigationRows?.results||[]).map(row=>({ area:row.area, activeMs:Number(row.active_ms)||0, users:Number(row.users)||0 })),
    note: 'Recursos são métricas internas do aplicativo; faturamento/CPU/rows da Cloudflare não são estimados aqui.'
  };
}

function parseProfileReference(row) {
  return row ? {
    id: row.id, userId: row.user_id, type: row.reference_type, title: row.title, sourceUrl: row.source_url || null,
    content: row.text_content || "", notes: row.notes || "", fileName: row.file_name || null, mimeType: row.mime_type || null,
    fileSize: Number(row.file_size) || 0, charCount: Number(row.char_count) || 0, createdAt: row.created_at, updatedAt: row.updated_at,
    trainingText: [row.title, row.text_content, row.notes].filter(Boolean).join("\n\n").trim(),
  } : null;
}

export async function listProfileReferences(db, userId, limit = MAX_PROFILE_REFERENCES) {
  await ensureSchema(db);
  const result = await db.prepare(`SELECT * FROM profile_references WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(userId, Math.max(1, Math.min(MAX_PROFILE_REFERENCES, Number(limit) || MAX_PROFILE_REFERENCES))).all();
  return (result?.results || []).map(parseProfileReference);
}

export async function getProfileReferenceStats(db, userId) {
  await ensureSchema(db);
  const row = await db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(char_count),0) AS total_chars FROM profile_references WHERE user_id = ?`).bind(userId).first();
  return { count:Number(row?.total)||0, totalChars:Number(row?.total_chars)||0 };
}

export async function createProfileReference(db, userId, reference) {
  await ensureSchema(db);
  const stats = await getProfileReferenceStats(db, userId);
  if (stats.count >= MAX_PROFILE_REFERENCES) throw new Error(`O perfil aceita no máximo ${MAX_PROFILE_REFERENCES} referências.`);
  if (stats.totalChars + Number(reference.charCount || 0) > MAX_PROFILE_REFERENCE_TOTAL_CHARS) throw new Error(`As referências aceitam até ${MAX_PROFILE_REFERENCE_TOTAL_CHARS.toLocaleString("pt-BR")} caracteres somados.`);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await db.prepare(`INSERT INTO profile_references (id,user_id,reference_type,title,source_url,text_content,notes,file_name,mime_type,file_size,content_hash,char_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,userId,reference.type,reference.title,reference.sourceUrl || null,reference.content || "",reference.notes || "",reference.fileName || null,reference.mimeType || null,Number(reference.fileSize)||0,reference.contentHash,Number(reference.charCount)||0,now,now).run();
  return parseProfileReference(await db.prepare("SELECT * FROM profile_references WHERE id = ? AND user_id = ?").bind(id,userId).first());
}

export async function deleteProfileReference(db, userId, id) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM profile_references WHERE id = ? AND user_id = ? LIMIT 1").bind(id,userId).first();
  if (!current) return null;
  await db.prepare("DELETE FROM profile_references WHERE id = ? AND user_id = ?").bind(id,userId).run();
  return parseProfileReference(current);
}

export async function updateUserDefaultSlideCount(db, userId, slideCount) {
  await ensureSchema(db);
  const count = validateSlideCount(slideCount);
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE users SET default_slide_count = ?, updated_at = ? WHERE id = ?")
    .bind(count, updatedAt, userId).run();
  return { defaultSlideCount: count, updatedAt };
}

function parseWritingSample(row) {
  return row ? {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    content: row.content,
    charCount: Number(row.char_count) || String(row.content || "").length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

export async function listWritingSamples(db, userId, limit = MAX_STYLE_SAMPLES) {
  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT * FROM writing_samples WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, Math.max(1, Math.min(MAX_STYLE_SAMPLES, Number(limit) || MAX_STYLE_SAMPLES))).all();
  return (result?.results || []).map(parseWritingSample);
}

export async function getWritingSampleStats(db, userId) {
  await ensureSchema(db);
  const row = await db.prepare(`
    SELECT COUNT(*) AS sample_count, COALESCE(SUM(char_count), 0) AS total_chars
    FROM writing_samples WHERE user_id = ?
  `).bind(userId).first();
  return { sampleCount: Number(row?.sample_count) || 0, totalChars: Number(row?.total_chars) || 0 };
}

export async function createWritingSample(db, userId, sample) {
  await ensureSchema(db);
  const stats = await getWritingSampleStats(db, userId);
  if (stats.sampleCount >= MAX_STYLE_SAMPLES) throw new Error(`O perfil aceita no máximo ${MAX_STYLE_SAMPLES} textos.`);
  if (stats.totalChars + sample.charCount > MAX_STYLE_TOTAL_CHARS) throw new Error(`O perfil aceita até ${MAX_STYLE_TOTAL_CHARS.toLocaleString("pt-BR")} caracteres somados.`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO writing_samples (
      id, user_id, title, source_type, content, content_hash, char_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, userId, sample.title, sample.sourceType, sample.content, sample.contentHash, sample.charCount, now, now).run();
  return { id, ...sample, createdAt: now, updatedAt: now };
}

export async function deleteWritingSample(db, userId, sampleId) {
  await ensureSchema(db);
  const result = await db.prepare("DELETE FROM writing_samples WHERE id = ? AND user_id = ?")
    .bind(sampleId, userId).run();
  return Number(result?.meta?.changes) > 0;
}


function parseCarouselLearningExample(row) {
  if (!row) return null;
  let slides = [];
  try { slides = JSON.parse(row.slides_json || "[]"); } catch {}
  return {
    id: row.id,
    topicId: row.topic_id,
    sourceName: row.source_name,
    slideCount: Number(row.slide_count) || slides.length,
    slides: Array.isArray(slides) ? slides : [],
    createdAt: row.created_at,
  };
}

export async function listCarouselLearningExamples(db, userId, limit = MAX_CAROUSEL_LEARNING_EXAMPLES) {
  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT * FROM carousel_learning_examples
    WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, Math.max(1, Math.min(MAX_CAROUSEL_LEARNING_EXAMPLES, Number(limit) || MAX_CAROUSEL_LEARNING_EXAMPLES))).all();
  return (result?.results || []).map(parseCarouselLearningExample).filter(Boolean);
}

export async function getCarouselLearningStats(db, userId) {
  await ensureSchema(db);
  const row = await db.prepare(`
    SELECT COUNT(*) AS example_count, MAX(created_at) AS updated_at
    FROM carousel_learning_examples WHERE user_id = ?
  `).bind(userId).first();
  return { count: Number(row?.example_count) || 0, updatedAt: row?.updated_at || null };
}

export async function createCarouselLearningExample(db, userId, example) {
  await ensureSchema(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO carousel_learning_examples (
      id, user_id, topic_id, source_name, slide_count, slides_json, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, content_hash) DO UPDATE SET created_at = excluded.created_at
  `).bind(id, userId, example.topicId, example.sourceName, example.slideCount, JSON.stringify(example.slides), example.contentHash, now).run();
  await db.prepare(`
    DELETE FROM carousel_learning_examples
    WHERE user_id = ? AND id NOT IN (
      SELECT id FROM carousel_learning_examples WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    )
  `).bind(userId, userId, MAX_CAROUSEL_LEARNING_EXAMPLES).run();
  const stats = await getCarouselLearningStats(db, userId);
  return { id, ...example, createdAt: now, ...stats };
}

export async function invalidateWritingProfile(db, userId) {
  await ensureSchema(db);
  await db.prepare("DELETE FROM writing_profiles WHERE user_id = ?").bind(userId).run();
  return true;
}

export async function getWritingProfile(db, userId) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT * FROM writing_profiles WHERE user_id = ? LIMIT 1").bind(userId).first();
  if (!row?.profile_json) return null;
  try {
    return {
      profile: JSON.parse(row.profile_json),
      sampleCount: Number(row.sample_count) || 0,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function saveWritingProfile(db, userId, profile, sampleCount) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO writing_profiles (user_id, profile_json, sample_count, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      profile_json = excluded.profile_json,
      sample_count = excluded.sample_count,
      updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(profile), Math.max(0, Number(sampleCount) || 0), updatedAt).run();
  return { profile, sampleCount: Math.max(0, Number(sampleCount) || 0), updatedAt };
}
