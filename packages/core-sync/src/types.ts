/**
 * Types for the core sync engine.
 */

import type { BugReport, BugUpdateEvent, TelemetryEvent, CreateBugRequest } from '@ebug/core-proto';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface SyncConfig {
  /** gRPC/WebSocket server URL */
  serverUrl: string;

  /** Organization ID */
  orgId: string;

  /** User ID for this session */
  userId: string;

  /** Auth token provider — called on each connection/reconnection */
  getAuthToken: () => Promise<string>;

  /** Use WebSocket instead of gRPC (browser-compatible fallback) */
  useWebSocket?: boolean;

  /** Maximum offline queue size before dropping oldest items */
  maxQueueSize?: number;

  /** Reconnection backoff — initial delay in ms */
  reconnectBaseDelay?: number;

  /** Reconnection backoff — maximum delay in ms */
  reconnectMaxDelay?: number;

  /** Heartbeat interval in ms */
  heartbeatInterval?: number;

  /** File paths to watch for bug updates (IDE context) */
  watchedFilePaths?: string[];
}

export interface SyncState {
  /** Current connection status */
  connectionStatus: ConnectionStatus;

  /** Number of items in the offline queue */
  queuedItems: number;

  /** Last successful sync timestamp */
  lastSyncAt: string | null;

  /** Resume token for reconnection */
  resumeToken: string | null;

  /** Whether the sync engine is actively streaming */
  isStreaming: boolean;

  /** Error message if in error state */
  lastError: string | null;
}

export interface QueuedOperation {
  id: string;
  type: 'create_bug' | 'update_bug' | 'transition_status' | 'telemetry';
  payload: CreateBugRequest | Record<string, unknown> | TelemetryEvent;
  createdAt: string;
  retryCount: number;
}

export interface SyncEventMap {
  'connection:status': (status: ConnectionStatus) => void;
  'bug:created': (bug: BugReport) => void;
  'bug:updated': (event: BugUpdateEvent) => void;
  'bug:deduplicated': (event: BugUpdateEvent) => void;
  'queue:changed': (queueSize: number) => void;
  'sync:error': (error: Error) => void;
  'sync:state': (state: SyncState) => void;
}
