import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { FrozenMemorySnapshot } from "./memory-store.js";
import type { ConversationProcessingEvent, ConversationSample, EvaluationLabel, EvaluationRecord, VisualAttachment } from "../shared/types.js";

export interface EpisodicMessage {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: VisualAttachment[];
}

export interface EpisodicSearchInput {
  query?: string;
  sessionId?: string;
  aroundMessageId?: number;
  limit?: number;
  window?: number;
  source?: string;
}

export interface EpisodicSearchResult {
  mode: "discover" | "scroll" | "browse";
  sessions: Array<{
    sessionId: string;
    source: string;
    startedAt: string;
    endedAt: string;
    snippet?: string;
    anchorMessageId?: number;
    messages: EpisodicMessage[];
  }>;
}

export class EpisodicStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attachments_json TEXT
      );
      CREATE TABLE IF NOT EXISTS session_snapshots (
        session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
        memory TEXT NOT NULL,
        user_profile TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_samples (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        channel TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        reply TEXT NOT NULL,
        reply_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        evaluation_id TEXT,
        evaluation_status TEXT,
        evaluation_score INTEGER,
        evaluation_labels TEXT,
        expected_reply TEXT,
        evaluation_notes TEXT
      );
      CREATE INDEX IF NOT EXISTS conversation_samples_updated_idx ON conversation_samples(updated_at DESC);
      CREATE INDEX IF NOT EXISTS conversation_samples_conversation_idx ON conversation_samples(conversation_id, updated_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='id',
        tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);
    this.ensureColumn("conversation_samples", "delivery_error", "TEXT");
    this.ensureColumn("conversation_samples", "binding_id", "TEXT");
    this.ensureColumn("conversation_samples", "persona_id", "TEXT");
    this.ensureColumn("conversation_samples", "branch_id", "TEXT");
    this.ensureColumn("conversation_samples", "twin_version_id", "TEXT");
    this.ensureColumn("conversation_samples", "twin_version_name", "TEXT");
    this.ensureColumn("conversation_samples", "robot_id", "TEXT");
    this.ensureColumn("conversation_samples", "robot_name", "TEXT");
    this.ensureColumn("conversation_samples", "group_id", "TEXT");
    this.ensureColumn("conversation_samples", "attachments_json", "TEXT");
    this.ensureColumn("conversation_samples", "processing_stage", "TEXT");
    this.ensureColumn("conversation_samples", "processing_log", "TEXT");
    this.ensureColumn("messages", "attachments_json", "TEXT");
    this.backfillDingTalkSamples();
  }

  recordTurn(sessionId: string, source: string, prompt: string, reply: string, snapshot: FrozenMemorySnapshot, attachments: VisualAttachment[] = []): EpisodicMessage[] {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO sessions(session_id, source, started_at, ended_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET ended_at=excluded.ended_at
      `).run(sessionId, source, now, now);
      this.db.prepare(`
        INSERT OR IGNORE INTO session_snapshots(session_id, memory, user_profile, captured_at)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, snapshot.memory, snapshot.user, snapshot.capturedAt);
      const insert = this.db.prepare("INSERT INTO messages(session_id, role, content, created_at, attachments_json) VALUES (?, ?, ?, ?, ?)");
      const serializedAttachments = attachments.length ? JSON.stringify(attachments) : null;
      const userInsert = insert.run(sessionId, "user", prompt, now, serializedAttachments);
      const assistantInsert = insert.run(sessionId, "assistant", reply, now, null);
      this.db.exec("COMMIT");
      return [
        { id: Number(userInsert.lastInsertRowid), sessionId, role: "user", content: prompt, createdAt: now, attachments },
        { id: Number(assistantInsert.lastInsertRowid), sessionId, role: "assistant", content: reply, createdAt: now },
      ];
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSnapshot(sessionId: string): { memory: string; user: string; capturedAt: string } | undefined {
    const row = this.db.prepare(`
      SELECT memory, user_profile, captured_at FROM session_snapshots WHERE session_id = ?
    `).get(sessionId) as { memory: string; user_profile: string; captured_at: string } | undefined;
    return row ? { memory: row.memory, user: row.user_profile, capturedAt: row.captured_at } : undefined;
  }

  loadSessionMessages(sessionId: string, source: string): EpisodicMessage[] {
    if (!this.sessionMeta(sessionId, source)) return [];
    const rows = this.db.prepare(`
      SELECT id, session_id, role, content, created_at, attachments_json
      FROM messages
      WHERE session_id = ?
      ORDER BY id
    `).all(sessionId) as unknown as MessageRow[];
    return rows.map(mapMessage);
  }

  stats(source?: string): { episodicSessions: number; episodicMessages: number } {
    const sessions = (source
      ? this.db.prepare("SELECT count(*) AS count FROM sessions WHERE source = ?").get(source)
      : this.db.prepare("SELECT count(*) AS count FROM sessions").get()) as { count: number };
    const messages = (source
      ? this.db.prepare("SELECT count(*) AS count FROM messages m JOIN sessions s ON s.session_id = m.session_id WHERE s.source = ?").get(source)
      : this.db.prepare("SELECT count(*) AS count FROM messages").get()) as { count: number };
    return { episodicSessions: Number(sessions.count), episodicMessages: Number(messages.count) };
  }

  recordConversationSample(input: Omit<ConversationSample, "updatedAt" | "evaluation"> & { updatedAt?: string }): ConversationSample {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    this.db.prepare(`
      INSERT INTO conversation_samples(
        id, session_id, channel, conversation_id, group_name, sender_id, sender_name,
        prompt, reply, reply_status, created_at, updated_at, sent_at,
        delivery_error, binding_id, persona_id, branch_id, twin_version_id, twin_version_name, robot_id, robot_name, group_id,
        attachments_json, processing_stage, processing_log
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_id=excluded.session_id,
        channel=excluded.channel,
        conversation_id=excluded.conversation_id,
        group_name=excluded.group_name,
        sender_id=excluded.sender_id,
        sender_name=excluded.sender_name,
        prompt=excluded.prompt,
        reply=excluded.reply,
        reply_status=excluded.reply_status,
        updated_at=excluded.updated_at,
        sent_at=COALESCE(excluded.sent_at, conversation_samples.sent_at),
        delivery_error=COALESCE(excluded.delivery_error, conversation_samples.delivery_error),
        binding_id=excluded.binding_id,
        persona_id=excluded.persona_id,
        branch_id=excluded.branch_id,
        twin_version_id=excluded.twin_version_id,
        twin_version_name=excluded.twin_version_name,
        robot_id=excluded.robot_id,
        robot_name=excluded.robot_name,
        group_id=excluded.group_id,
        attachments_json=COALESCE(excluded.attachments_json, conversation_samples.attachments_json),
        processing_stage=COALESCE(excluded.processing_stage, conversation_samples.processing_stage),
        processing_log=COALESCE(excluded.processing_log, conversation_samples.processing_log)
    `).run(
      input.id,
      input.sessionId ?? null,
      input.channel,
      input.conversationId,
      input.groupName,
      input.senderId,
      input.senderName,
      input.prompt,
      input.reply,
      input.status,
      input.createdAt,
      updatedAt,
      input.sentAt ?? null,
      input.deliveryError?.slice(0, 2_000) ?? null,
      input.bindingId ?? null,
      input.personaId ?? null,
      input.branchId ?? null,
      input.twinVersionId ?? null,
      input.twinVersionName ?? null,
      input.robotId ?? null,
      input.robotName ?? null,
      input.groupId ?? null,
      input.attachments?.length ? JSON.stringify(input.attachments) : null,
      input.processingStage ?? null,
      input.processingLog?.length ? JSON.stringify(input.processingLog.slice(-100)) : null,
    );
    return { ...input, updatedAt };
  }

  updateConversationSampleStatus(id: string, status: ConversationSample["status"], deliveryError?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE conversation_samples
      SET reply_status = ?, updated_at = ?,
          sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
          delivery_error = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 'sent' THEN NULL ELSE delivery_error END
      WHERE id = ?
    `).run(status, now, status, now, deliveryError?.slice(0, 2_000) ?? null, deliveryError?.slice(0, 2_000) ?? null, status, id);
  }

  getConversationSample(id: string): ConversationSample | undefined {
    const row = this.db.prepare("SELECT * FROM conversation_samples WHERE id = ?").get(id) as ConversationSampleRow | undefined;
    return row ? mapConversationSample(row) : undefined;
  }

  appendConversationSampleEvent(id: string, event: ConversationProcessingEvent): void {
    const row = this.db.prepare("SELECT processing_log FROM conversation_samples WHERE id = ?").get(id) as { processing_log: string | null } | undefined;
    if (!row) return;
    const log = parseProcessingLog(row.processing_log);
    log.push({ ...event, message: event.message.slice(0, 2_000) });
    this.db.prepare(`
      UPDATE conversation_samples
      SET processing_stage = ?, processing_log = ?, updated_at = ?
      WHERE id = ?
    `).run(event.stage, JSON.stringify(log.slice(-100)), event.at, id);
  }

  recoverInterruptedConversationSamples(): number {
    const rows = this.db.prepare("SELECT id FROM conversation_samples WHERE reply_status IN ('received', 'processing')").all() as unknown as Array<{ id: string }>;
    if (!rows.length) return 0;
    const now = new Date().toISOString();
    const message = "应用在消息处理完成前退出。原始消息已保留，但旧的 sessionWebhook 可能已经失效；请在待回复列表人工处理，或让对方重新 @机器人。";
    for (const row of rows) {
      this.appendConversationSampleEvent(row.id, { stage: "recovery", status: "error", at: now, message });
      this.updateConversationSampleStatus(row.id, "failed", message);
    }
    return rows.length;
  }

  listConversationSamples(limit = 100, twinVersionId?: string, branchId?: string): ConversationSample[] {
    const safeLimit = Math.max(1, Math.min(Math.round(limit), 500));
    const rows = (twinVersionId
      ? this.db.prepare("SELECT * FROM conversation_samples WHERE twin_version_id = ? ORDER BY updated_at DESC LIMIT ?").all(twinVersionId, safeLimit)
      : branchId
        ? this.db.prepare("SELECT * FROM conversation_samples WHERE branch_id = ? ORDER BY updated_at DESC LIMIT ?").all(branchId, safeLimit)
        : this.db.prepare("SELECT * FROM conversation_samples ORDER BY updated_at DESC LIMIT ?").all(safeLimit)) as unknown as ConversationSampleRow[];
    return rows.map(mapConversationSample);
  }

  deleteConversationSamplesForBranch(branchId: string): number {
    const result = this.db.prepare("DELETE FROM conversation_samples WHERE branch_id = ?").run(branchId);
    return Number(result.changes);
  }

  renameConversationSamplesForBranch(branchId: string, twinVersionName: string): number {
    const result = this.db.prepare("UPDATE conversation_samples SET twin_version_name = ?, updated_at = ? WHERE branch_id = ?")
      .run(twinVersionName, new Date().toISOString(), branchId);
    return Number(result.changes);
  }

  deleteTwinVersionSessions(versionIds: string[]): number {
    if (!versionIds.length) return 0;
    const remove = this.db.prepare("DELETE FROM sessions WHERE source = ?");
    let deleted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const versionId of versionIds) deleted += Number(remove.run(`twin:${versionId}`).changes);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return deleted;
  }

  markConversationSampleEvaluated(record: EvaluationRecord): void {
    if (!record.sampleId) return;
    this.db.prepare(`
      UPDATE conversation_samples SET
        evaluation_id = ?, evaluation_status = ?, evaluation_score = ?, evaluation_labels = ?,
        expected_reply = ?, evaluation_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      record.id,
      record.status,
      record.score,
      JSON.stringify(record.labels),
      record.expectedReply ?? null,
      record.notes ?? null,
      new Date().toISOString(),
      record.sampleId,
    );
  }

  markConversationSampleEvaluationsApplied(evaluationIds: string[]): void {
    if (!evaluationIds.length) return;
    const update = this.db.prepare("UPDATE conversation_samples SET evaluation_status = 'applied', updated_at = ? WHERE evaluation_id = ?");
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of evaluationIds) update.run(now, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  search(input: EpisodicSearchInput = {}): EpisodicSearchResult {
    const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
    const window = Math.max(1, Math.min(input.window ?? 5, 20));
    if (input.sessionId && input.aroundMessageId) {
      const session = this.sessionMeta(input.sessionId, input.source);
      if (!session) return { mode: "scroll", sessions: [] };
      return {
        mode: "scroll",
        sessions: [{ ...session, anchorMessageId: input.aroundMessageId, messages: this.messageWindow(input.sessionId, input.aroundMessageId, window) }],
      };
    }

    if (!input.query?.trim()) {
      const rows = (input.source
        ? this.db.prepare("SELECT session_id, source, started_at, ended_at FROM sessions WHERE source = ? ORDER BY ended_at DESC LIMIT ?").all(input.source, limit)
        : this.db.prepare("SELECT session_id, source, started_at, ended_at FROM sessions ORDER BY ended_at DESC LIMIT ?").all(limit)) as unknown as SessionRow[];
      return {
        mode: "browse",
        sessions: rows.map((row) => ({ ...mapSession(row), messages: this.tailMessages(row.session_id, 4) })),
      };
    }

    const hits = this.searchHits(input.query.trim(), limit * 4, input.source);
    const seen = new Set<string>();
    const sessions: EpisodicSearchResult["sessions"] = [];
    for (const hit of hits) {
      if (seen.has(hit.session_id)) continue;
      const meta = this.sessionMeta(hit.session_id, input.source);
      if (!meta) continue;
      seen.add(hit.session_id);
      sessions.push({
        ...meta,
        snippet: hit.snippet,
        anchorMessageId: hit.id,
        messages: this.messageWindow(hit.session_id, hit.id, window),
      });
      if (sessions.length >= limit) break;
    }
    return { mode: "discover", sessions };
  }

  close(): void {
    this.db.close();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private searchHits(query: string, limit: number, source?: string): SearchHitRow[] {
    if ([...query].length < 3) {
      return (source ? this.db.prepare(`
        SELECT m.id, m.session_id, substr(m.content, 1, 180) AS snippet
        FROM messages m JOIN sessions s ON s.session_id = m.session_id
        WHERE m.content LIKE ? AND s.source = ? ORDER BY m.id DESC LIMIT ?
      `).all(`%${query}%`, source, limit) : this.db.prepare(`
        SELECT id, session_id, substr(content, 1, 180) AS snippet
        FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?
      `).all(`%${query}%`, limit)) as unknown as SearchHitRow[];
    }
    const statement = this.db.prepare(source ? `
      SELECT m.id, m.session_id,
             snippet(messages_fts, 0, '【', '】', '…', 24) AS snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN sessions s ON s.session_id = m.session_id
      WHERE messages_fts MATCH ? AND s.source = ?
      ORDER BY rank
      LIMIT ?
    ` : `
      SELECT m.id, m.session_id,
             snippet(messages_fts, 0, '【', '】', '…', 24) AS snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    try {
      return statement.all(...(source ? [query, source, limit] : [query, limit])) as unknown as SearchHitRow[];
    } catch {
      const escaped = `"${query.replace(/"/g, '""')}"`;
      return statement.all(...(source ? [escaped, source, limit] : [escaped, limit])) as unknown as SearchHitRow[];
    }
  }

  private sessionMeta(sessionId: string, source?: string): ReturnType<typeof mapSession> | undefined {
    const row = (source
      ? this.db.prepare("SELECT session_id, source, started_at, ended_at FROM sessions WHERE session_id = ? AND source = ?").get(sessionId, source)
      : this.db.prepare("SELECT session_id, source, started_at, ended_at FROM sessions WHERE session_id = ?").get(sessionId)) as SessionRow | undefined;
    return row ? mapSession(row) : undefined;
  }

  private messageWindow(sessionId: string, anchorId: number, window: number): EpisodicMessage[] {
    const rows = this.db.prepare("SELECT id, session_id, role, content, created_at, attachments_json FROM messages WHERE session_id = ? ORDER BY id").all(sessionId) as unknown as MessageRow[];
    const index = rows.findIndex((row) => row.id === anchorId);
    if (index < 0) return [];
    return rows.slice(Math.max(0, index - window), index + window + 1).map(mapMessage);
  }

  private tailMessages(sessionId: string, limit: number): EpisodicMessage[] {
    const rows = this.db.prepare("SELECT id, session_id, role, content, created_at, attachments_json FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?").all(sessionId, limit) as unknown as MessageRow[];
    return rows.reverse().map(mapMessage);
  }

  private backfillDingTalkSamples(): void {
    this.db.exec(`
      INSERT OR IGNORE INTO conversation_samples(
        id, session_id, channel, conversation_id, group_name, sender_id, sender_name,
        prompt, reply, reply_status, created_at, updated_at
      )
      SELECT
        'legacy:' || s.session_id || ':' || u.id,
        s.session_id,
        CASE WHEN s.source = 'dingtalk_custom_webhook_robot' THEN 'dingtalk_webhook' ELSE 'dingtalk_stream' END,
        '',
        '历史钉钉会话',
        '',
        '群成员',
        u.content,
        (SELECT a.content FROM messages a WHERE a.session_id = u.session_id AND a.role = 'assistant' AND a.id > u.id ORDER BY a.id LIMIT 1),
        'generated',
        u.created_at,
        u.created_at
      FROM messages u
      JOIN sessions s ON s.session_id = u.session_id
      WHERE u.role = 'user'
        AND s.source IN ('dingtalk_enterprise_stream_robot', 'dingtalk_custom_webhook_robot')
        AND EXISTS (SELECT 1 FROM messages a WHERE a.session_id = u.session_id AND a.role = 'assistant' AND a.id > u.id)
    `);
    // Early MVP builds backfilled every legacy row with the migration timestamp,
    // which made the archive appear out of chronological order. Restore source time.
    this.db.exec("UPDATE conversation_samples SET updated_at = created_at WHERE id LIKE 'legacy:%'");
  }
}

interface SessionRow {
  session_id: string;
  source: string;
  started_at: string;
  ended_at: string;
}

interface MessageRow {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  attachments_json?: string | null;
}

interface SearchHitRow {
  id: number;
  session_id: string;
  snippet: string;
}

interface ConversationSampleRow {
  id: string;
  session_id: string | null;
  channel: ConversationSample["channel"];
  conversation_id: string;
  group_name: string;
  sender_id: string;
  sender_name: string;
  prompt: string;
  reply: string;
  reply_status: ConversationSample["status"];
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  delivery_error: string | null;
  evaluation_id: string | null;
  evaluation_status: "pending" | "applied" | null;
  evaluation_score: number | null;
  evaluation_labels: string | null;
  expected_reply: string | null;
  evaluation_notes: string | null;
  binding_id: string | null;
  persona_id: string | null;
  branch_id: string | null;
  twin_version_id: string | null;
  twin_version_name: string | null;
  robot_id: string | null;
  robot_name: string | null;
  group_id: string | null;
  attachments_json: string | null;
  processing_stage: string | null;
  processing_log: string | null;
}

function mapSession(row: SessionRow) {
  return { sessionId: row.session_id, source: row.source, startedAt: row.started_at, endedAt: row.ended_at };
}

function mapMessage(row: MessageRow): EpisodicMessage {
  return { id: row.id, sessionId: row.session_id, role: row.role, content: row.content, createdAt: row.created_at, attachments: parseAttachments(row.attachments_json) };
}

function parseAttachments(value?: string | null): VisualAttachment[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as VisualAttachment[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch { return undefined; }
}

function parseProcessingLog(value?: string | null): ConversationProcessingEvent[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as ConversationProcessingEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function mapConversationSample(row: ConversationSampleRow): ConversationSample {
  const labels = parseEvaluationLabels(row.evaluation_labels);
  return {
    id: row.id,
    sessionId: row.session_id ?? undefined,
    channel: row.channel,
    conversationId: row.conversation_id,
    groupName: row.group_name,
    senderId: row.sender_id,
    senderName: row.sender_name,
    prompt: row.prompt,
    reply: row.reply,
    status: row.reply_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at ?? undefined,
    deliveryError: row.delivery_error ?? undefined,
    processingStage: row.processing_stage ?? undefined,
    processingLog: parseProcessingLog(row.processing_log),
    bindingId: row.binding_id ?? undefined,
    personaId: row.persona_id ?? undefined,
    branchId: row.branch_id ?? undefined,
    twinVersionId: row.twin_version_id ?? undefined,
    twinVersionName: row.twin_version_name ?? undefined,
    robotId: row.robot_id ?? undefined,
    robotName: row.robot_name ?? undefined,
    groupId: row.group_id ?? undefined,
    attachments: parseAttachments(row.attachments_json),
    evaluation: row.evaluation_id && row.evaluation_status && row.evaluation_score
      ? {
        id: row.evaluation_id,
        status: row.evaluation_status,
        score: row.evaluation_score,
        labels,
        expectedReply: row.expected_reply ?? undefined,
        notes: row.evaluation_notes ?? undefined,
      }
      : undefined,
  };
}

function parseEvaluationLabels(value: string | null): EvaluationLabel[] {
  if (!value) return [];
  try {
    const labels = JSON.parse(value) as unknown;
    if (!Array.isArray(labels)) return [];
    const allowed = new Set<EvaluationLabel>(["voice", "facts", "judgment", "boundary", "length", "other"]);
    return labels.filter((label): label is EvaluationLabel => typeof label === "string" && allowed.has(label as EvaluationLabel));
  } catch {
    return [];
  }
}
