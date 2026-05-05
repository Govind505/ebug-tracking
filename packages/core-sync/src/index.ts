/**
 * @ebug/core-sync
 * 
 * Bi-directional sync engine for IDE ↔ Cloud communication.
 * Handles connection lifecycle, offline queue, reconnection,
 * and conflict resolution for the eBug tracking system.
 */

export { SyncEngine } from './sync-engine.js';
export { OfflineQueue } from './offline-queue.js';
export { ConnectionManager } from './connection-manager.js';
export type { SyncConfig, SyncState, ConnectionStatus } from './types.js';
