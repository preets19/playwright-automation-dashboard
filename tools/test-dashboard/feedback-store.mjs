import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const hostRootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const sessionStatuses = new Set(['draft', 'generated', 'validated', 'accepted', 'rejected']);
const promptFlows = new Set(['quick', 'guided']);
const stepNames = new Set([
  'recorder_interpreter',
  'framework_mapper',
  'artifact_designer',
  'code_generator',
  'reviewer',
  'other'
]);
const snapshotTypes = new Set(['initial_generated', 'accepted', 'rejected', 'reviewed']);
const validationStatuses = new Set(['passed', 'failed']);
const lessonConfidences = new Set(['low', 'medium', 'high']);

export function defaultFeedbackDbPath() {
  return resolve(process.env.DASHBOARD_FEEDBACK_DB_PATH ?? join(hostRootDir, '.tmp', 'feedback-loop.db'));
}

export function createFeedbackStore(options = {}) {
  const dbPath = resolve(options.dbPath ?? defaultFeedbackDbPath());
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(feedbackSchemaSql);

  return {
    dbPath,

    createSession(session = {}) {
      const id = session.id ?? randomUUID();
      const now = new Date().toISOString();
      assertEnum('status', session.status ?? 'draft', sessionStatuses);
      if (session.promptFlow) {
        assertEnum('promptFlow', session.promptFlow, promptFlows);
      }

      db.prepare(`
        INSERT INTO generation_sessions (
          id, created_at, updated_at, repo_name, repo_path, automation_root,
          test_type, test_suite, scenario, test_objective, pass_condition,
          status, model_name, prompt_flow, prompt_version, framework_version,
          dashboard_version, git_branch, git_commit_initial, git_commit_accepted,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        session.createdAt ?? now,
        now,
        textOrNull(session.repoName),
        textOrNull(session.repoPath),
        textOrNull(session.automationRoot),
        textOrNull(session.testType),
        textOrNull(session.testSuite),
        textOrNull(session.scenario),
        textOrNull(session.testObjective),
        textOrNull(session.passCondition),
        session.status ?? 'draft',
        textOrNull(session.modelName),
        textOrNull(session.promptFlow),
        textOrNull(session.promptVersion),
        textOrNull(session.frameworkVersion),
        textOrNull(session.dashboardVersion),
        textOrNull(session.gitBranch),
        textOrNull(session.gitCommitInitial),
        textOrNull(session.gitCommitAccepted),
        textOrNull(session.notes)
      );

      return id;
    },

    updateSessionStatus(sessionId, status, updates = {}) {
      assertEnum('status', status, sessionStatuses);
      db.prepare(`
        UPDATE generation_sessions
        SET status = ?,
            updated_at = ?,
            git_commit_initial = COALESCE(?, git_commit_initial),
            git_commit_accepted = COALESCE(?, git_commit_accepted),
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        status,
        new Date().toISOString(),
        textOrNull(updates.gitCommitInitial),
        textOrNull(updates.gitCommitAccepted),
        textOrNull(updates.notes),
        sessionId
      );
    },

    addRecorderInput(sessionId, input = {}) {
      const id = input.id ?? randomUUID();
      db.prepare(`
        INSERT INTO recorder_inputs (
          id, session_id, raw_code, formatted_code, entry_url, notes, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        textOrNull(input.rawCode),
        textOrNull(input.formattedCode),
        textOrNull(input.entryUrl),
        textOrNull(input.notes),
        input.createdAt ?? new Date().toISOString()
      );
      return id;
    },

    addStep(sessionId, step = {}) {
      const id = step.id ?? randomUUID();
      assertEnum('stepName', step.stepName ?? 'other', stepNames);
      db.prepare(`
        INSERT INTO generation_steps (
          id, session_id, step_name, prompt_text, response_text, input_tokens,
          output_tokens, model_name, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        step.stepName ?? 'other',
        textOrNull(step.promptText),
        textOrNull(step.responseText),
        integerOrNull(step.inputTokens),
        integerOrNull(step.outputTokens),
        textOrNull(step.modelName),
        step.createdAt ?? new Date().toISOString()
      );
      return id;
    },

    addArtifactSnapshot(sessionId, snapshot = {}) {
      const id = snapshot.id ?? randomUUID();
      assertEnum('snapshotType', snapshot.snapshotType, snapshotTypes);
      db.prepare(`
        INSERT INTO artifact_snapshots (
          id, session_id, snapshot_type, file_path, content, content_hash, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        snapshot.snapshotType,
        textOrNull(snapshot.filePath),
        textOrNull(snapshot.content),
        textOrNull(snapshot.contentHash),
        snapshot.createdAt ?? new Date().toISOString()
      );
      return id;
    },

    addValidationRun(sessionId, run = {}) {
      const id = run.id ?? randomUUID();
      assertEnum('status', run.status, validationStatuses);
      db.prepare(`
        INSERT INTO validation_runs (
          id, session_id, command, status, exit_code, stdout, stderr,
          duration_ms, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        textOrNull(run.command),
        run.status,
        integerOrNull(run.exitCode),
        textOrNull(run.stdout),
        textOrNull(run.stderr),
        integerOrNull(run.durationMs),
        run.createdAt ?? new Date().toISOString()
      );
      return id;
    },

    addLesson(sessionId, lesson = {}) {
      const id = lesson.id ?? randomUUID();
      assertEnum('confidence', lesson.confidence ?? 'low', lessonConfidences);
      db.prepare(`
        INSERT INTO lessons_learned (
          id, session_id, category, pattern, lesson, example_before,
          example_after, confidence, promoted, seen_count, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        textOrNull(lesson.category),
        textOrNull(lesson.pattern),
        textOrNull(lesson.lesson),
        textOrNull(lesson.exampleBefore),
        textOrNull(lesson.exampleAfter),
        lesson.confidence ?? 'low',
        lesson.promoted ? 1 : 0,
        integerOrNull(lesson.seenCount) ?? 1,
        lesson.createdAt ?? new Date().toISOString()
      );
      return id;
    },

    addCaptureEvent(sessionId, event = {}) {
      const id = event.id ?? randomUUID();
      db.prepare(`
        INSERT INTO capture_events (
          id, session_id, event_name, payload_json, created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        textOrNull(event.eventName),
        JSON.stringify(event.payload ?? {}),
        event.createdAt ?? new Date().toISOString()
      );
      return id;
    },

    sessionCount() {
      return db.prepare('SELECT COUNT(*) AS count FROM generation_sessions').get().count;
    },

    close() {
      db.close();
    }
  };
}

export const feedbackSchemaSql = `
CREATE TABLE IF NOT EXISTS generation_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  repo_name TEXT,
  repo_path TEXT,
  automation_root TEXT,
  test_type TEXT,
  test_suite TEXT,
  scenario TEXT,
  test_objective TEXT,
  pass_condition TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'generated', 'validated', 'accepted', 'rejected')),
  model_name TEXT,
  prompt_flow TEXT CHECK (prompt_flow IS NULL OR prompt_flow IN ('quick', 'guided')),
  prompt_version TEXT,
  framework_version TEXT,
  dashboard_version TEXT,
  git_branch TEXT,
  git_commit_initial TEXT,
  git_commit_accepted TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS recorder_inputs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  raw_code TEXT,
  formatted_code TEXT,
  entry_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_steps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL CHECK (step_name IN (
    'recorder_interpreter',
    'framework_mapper',
    'artifact_designer',
    'code_generator',
    'reviewer',
    'other'
  )),
  prompt_text TEXT,
  response_text TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  model_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN (
    'initial_generated',
    'accepted',
    'rejected',
    'reviewed'
  )),
  file_path TEXT,
  content TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  command TEXT,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons_learned (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES generation_sessions(id) ON DELETE SET NULL,
  category TEXT,
  pattern TEXT,
  lesson TEXT,
  example_before TEXT,
  example_after TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  promoted INTEGER NOT NULL DEFAULT 0 CHECK (promoted IN (0, 1)),
  seen_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  event_name TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generation_steps_session ON generation_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_artifact_snapshots_session ON artifact_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_validation_runs_session ON validation_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_lessons_session ON lessons_learned(session_id);
CREATE INDEX IF NOT EXISTS idx_lessons_promoted ON lessons_learned(promoted);
CREATE INDEX IF NOT EXISTS idx_capture_events_session ON capture_events(session_id);
`;

function textOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`Expected integer value, received ${value}.`);
  }

  return number;
}

function assertEnum(name, value, allowedValues) {
  if (!allowedValues.has(value)) {
    throw new Error(`${name} must be one of: ${Array.from(allowedValues).join(', ')}.`);
  }
}
