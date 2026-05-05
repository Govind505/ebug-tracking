/**
 * SyncEngine
 * 
 * The main orchestrator that ties together ConnectionManager and OfflineQueue
 * to provide a seamless IDE ↔ Cloud synchronization experience.
 * 
 * Features:
 * - Offline-first: operations queue when disconnected
 * - Auto-drain: queued operations replay on reconnection
 * - Event-driven: emits typed events for UI layer consumption
 * - Resilient: handles auth refresh, reconnection, and conflict resolution
 */

import EventEmitter from 'eventemitter3';
import type {
  BugReport,
  BugUpdateEvent,
  CreateBugRequest,
  CreateBugResponse,
  TelemetryEvent,
} from '@ebug/core-proto';
import { ConnectionManager } from './connection-manager.js';
import { OfflineQueue } from './offline-queue.js';
import type { SyncConfig, SyncState, SyncEventMap, ConnectionStatus } from './types.js';

export class SyncEngine extends EventEmitter<SyncEventMap> {
  private connection: ConnectionManager;
  private queue: OfflineQueue;
  private config: SyncConfig;
  private resumeToken: string | null = null;
  private state: SyncState;

  constructor(config: SyncConfig) {
    super();
    this.config = config;

    this.state = {
      connectionStatus: 'disconnected',
      queuedItems: 0,
      lastSyncAt: null,
      resumeToken: null,
      isStreaming: false,
      lastError: null,
    };

    // Initialize connection manager
    this.connection = new ConnectionManager(config);

    // Initialize offline queue
    this.queue = new OfflineQueue(config.maxQueueSize ?? 500);

    // Wire up connection events
    this.connection.on('status', this.handleConnectionStatus.bind(this));
    this.connection.on('message', this.handleMessage.bind(this));
    this.connection.on('error', this.handleError.bind(this));
  }

  /** Get current sync state */
  getState(): Readonly<SyncState> {
    return { ...this.state };
  }

  /** Start the sync engine — connect and begin streaming */
  async start(): Promise<void> {
    await this.queue.init();
    this.updateState({ queuedItems: this.queue.size });
    await this.connection.connect();
  }

  /** Stop the sync engine gracefully */
  stop(): void {
    this.connection.disconnect();
    this.updateState({
      connectionStatus: 'disconnected',
      isStreaming: false,
    });
  }

  /** Create a new bug report — queues offline if disconnected */
  async createBug(request: CreateBugRequest): Promise<string | null> {
    if (this.connection.getStatus() === 'connected') {
      const sent = this.connection.send({
        type: 'create_bug',
        payload: request,
      });
      if (sent) return null; // Response will come via stream
    }

    // Queue for later
    const queueId = await this.queue.enqueue({
      type: 'create_bug',
      payload: request,
    });
    this.updateState({ queuedItems: this.queue.size });
    this.emit('queue:changed', this.queue.size);
    return queueId;
  }

  /** Send telemetry events — best-effort, queues if offline */
  async sendTelemetry(events: TelemetryEvent[]): Promise<void> {
    for (const event of events) {
      if (this.connection.getStatus() === 'connected') {
        this.connection.send({
          type: 'telemetry',
          payload: event,
        });
      } else {
        await this.queue.enqueue({
          type: 'telemetry',
          payload: event,
        });
      }
    }
    this.updateState({ queuedItems: this.queue.size });
  }

  /** Update a bug's status */
  async transitionStatus(bugId: string, newStatus: string, comment?: string): Promise<void> {
    const payload = { id: bugId, orgId: this.config.orgId, newStatus, comment };

    if (this.connection.getStatus() === 'connected') {
      this.connection.send({ type: 'transition_status', payload });
    } else {
      await this.queue.enqueue({ type: 'transition_status', payload });
      this.updateState({ queuedItems: this.queue.size });
      this.emit('queue:changed', this.queue.size);
    }
  }

  /** Get queue contents for UI display */
  getQueuedOperations() {
    return this.queue.peek();
  }

  // ── Private Event Handlers ──

  private async handleConnectionStatus(status: ConnectionStatus): Promise<void> {
    this.updateState({ connectionStatus: status });
    this.emit('connection:status', status);

    if (status === 'connected') {
      // Subscribe to bug updates stream
      this.connection.send({
        type: 'subscribe',
        payload: {
          orgId: this.config.orgId,
          userId: this.config.userId,
          filePaths: this.config.watchedFilePaths ?? [],
          resumeToken: this.resumeToken,
        },
      });

      this.updateState({ isStreaming: true, lastError: null });

      // Drain offline queue
      const result = await this.queue.drain((op) => {
        return Promise.resolve(this.connection.send({
          type: op.type,
          payload: op.payload,
        }));
      });

      this.updateState({ queuedItems: this.queue.size });
      this.emit('queue:changed', this.queue.size);
    }

    if (status === 'error' || status === 'disconnected') {
      this.updateState({ isStreaming: false });
    }
  }

  private handleMessage(data: unknown): void {
    const msg = data as { type: string; payload: unknown };

    switch (msg.type) {
      case 'bug_created': {
        const bug = msg.payload as BugReport;
        this.emit('bug:created', bug);
        break;
      }

      case 'bug_updated': {
        const event = msg.payload as BugUpdateEvent;
        this.resumeToken = event.resumeToken;
        this.updateState({
          resumeToken: event.resumeToken,
          lastSyncAt: new Date().toISOString(),
        });

        if (event.eventType === 'deduplicated') {
          this.emit('bug:deduplicated', event);
        } else {
          this.emit('bug:updated', event);
        }
        break;
      }

      case 'error': {
        const error = msg.payload as { message: string };
        this.emit('sync:error', new Error(error.message));
        break;
      }
    }
  }

  private handleError(error: Error): void {
    this.updateState({ lastError: error.message });
    this.emit('sync:error', error);
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('sync:state', this.getState());
  }
}
