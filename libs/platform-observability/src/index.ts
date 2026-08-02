import { randomUUID } from 'node:crypto';

import { type AuditEvent, AuditEventSchema, type RequestContext, type RiskTier } from '@ceo/contracts';

/**
 * @ceo/platform-observability — structured logging and the audit log.
 *
 * The audit log is not "logging". It is the evidence the release gates are
 * evaluated against ("zero unauthorized writes", "100% approval enforcement"), so
 * it is a typed, append-only stream with a validated schema — not free text.
 */

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
  /** Read back for the eval gates and the admin CLI. */
  query(filter?: { requestId?: string; workspaceId?: string }): Promise<AuditEvent[]>;
}

export class InMemoryAuditSink implements AuditSink {
  readonly #events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.#events.push(AuditEventSchema.parse(event));
  }

  async query(filter: { requestId?: string; workspaceId?: string } = {}): Promise<AuditEvent[]> {
    return this.#events.filter(
      e =>
        (filter.requestId === undefined || e.requestId === filter.requestId) &&
        (filter.workspaceId === undefined || e.workspaceId === filter.workspaceId),
    );
  }

  get size(): number {
    return this.#events.length;
  }
}

/** Builds a well-formed audit event from a turn context plus the call detail. */
export function buildAuditEvent(input: {
  context: RequestContext;
  agentId: string;
  toolId: string;
  tier: RiskTier;
  outcome: AuditEvent['outcome'];
  redactedSummary: string;
  reason?: string;
  approvalId?: string;
  argumentsHash?: string;
  now?: Date;
}): AuditEvent {
  const { context, now = new Date(), ...rest } = input;
  return AuditEventSchema.parse({
    eventId: randomUUID(),
    at: now.toISOString(),
    requestId: context.requestId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: context.role,
    surface: context.surface,
    channelId: context.channelId,
    ...rest,
  });
}

// --- structured logging -------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Returns a logger that stamps every line with the turn's correlation ids. */
  forRequest(context: Pick<RequestContext, 'requestId' | 'workspaceId' | 'userId'>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly base: Record<string, unknown> = {},
  ) {}

  #write(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = { level, msg, at: new Date().toISOString(), ...this.base, ...fields };
    const stream = level === 'error' || level === 'warn' ? console.error : console.log;
    stream(JSON.stringify(line));
  }

  debug(msg: string, fields?: Record<string, unknown>) { this.#write('debug', msg, fields); }
  info(msg: string, fields?: Record<string, unknown>) { this.#write('info', msg, fields); }
  warn(msg: string, fields?: Record<string, unknown>) { this.#write('warn', msg, fields); }
  error(msg: string, fields?: Record<string, unknown>) { this.#write('error', msg, fields); }

  forRequest(context: Pick<RequestContext, 'requestId' | 'workspaceId' | 'userId'>): Logger {
    return new ConsoleLogger(this.minLevel, {
      ...this.base,
      requestId: context.requestId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    });
  }
}

/** Discards everything. Used by evals so a 400-case run stays readable. */
export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  forRequest(): Logger { return this; }
}
