/**
 * OfflineQueue
 * 
 * Persists operations when the connection is down.
 * Replays them in order upon reconnection.
 * Uses an in-memory store with optional external persistence adapter.
 */

import type { QueuedOperation } from './types.js';

export interface PersistenceAdapter {
  load(): Promise<QueuedOperation[]>;
  save(operations: QueuedOperation[]): Promise<void>;
  clear(): Promise<void>;
}

export class OfflineQueue {
  private queue: QueuedOperation[] = [];
  private maxSize: number;
  private persistence: PersistenceAdapter | null;
  private isProcessing = false;

  constructor(maxSize = 500, persistence?: PersistenceAdapter) {
    this.maxSize = maxSize;
    this.persistence = persistence ?? null;
  }

  /** Initialize from persisted storage */
  async init(): Promise<void> {
    if (this.persistence) {
      this.queue = await this.persistence.load();
    }
  }

  /** Add an operation to the queue */
  async enqueue(operation: Omit<QueuedOperation, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
    const op: QueuedOperation = {
      ...operation,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    // If at capacity, drop oldest non-critical items
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
    }

    this.queue.push(op);
    await this.persist();
    return op.id;
  }

  /** Get all queued operations in FIFO order */
  peek(): QueuedOperation[] {
    return [...this.queue];
  }

  /** Remove and return the next operation */
  async dequeue(): Promise<QueuedOperation | null> {
    const op = this.queue.shift() ?? null;
    if (op) await this.persist();
    return op;
  }

  /** Mark an operation as failed and re-queue with incremented retry */
  async retry(operationId: string, maxRetries = 5): Promise<boolean> {
    const idx = this.queue.findIndex(op => op.id === operationId);
    if (idx === -1) {
      // Already dequeued — find in failed and re-add
      return false;
    }

    const op = this.queue[idx];
    if (op.retryCount >= maxRetries) {
      // Max retries exceeded — drop it
      this.queue.splice(idx, 1);
      await this.persist();
      return false;
    }

    op.retryCount++;
    await this.persist();
    return true;
  }

  /** Remove a specific operation (e.g., after successful send) */
  async remove(operationId: string): Promise<boolean> {
    const idx = this.queue.findIndex(op => op.id === operationId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    await this.persist();
    return true;
  }

  /** Clear the entire queue */
  async clear(): Promise<void> {
    this.queue = [];
    if (this.persistence) {
      await this.persistence.clear();
    }
  }

  /** Current queue size */
  get size(): number {
    return this.queue.length;
  }

  /** Whether the queue is currently being drained */
  get processing(): boolean {
    return this.isProcessing;
  }

  /** Drain the queue, calling the handler for each operation */
  async drain(handler: (op: QueuedOperation) => Promise<boolean>): Promise<{ sent: number; failed: number }> {
    if (this.isProcessing) return { sent: 0, failed: 0 };
    this.isProcessing = true;

    let sent = 0;
    let failed = 0;

    try {
      while (this.queue.length > 0) {
        const op = this.queue[0];
        try {
          const success = await handler(op);
          if (success) {
            this.queue.shift();
            sent++;
          } else {
            // Handler returned false — stop draining (connection likely lost)
            break;
          }
        } catch {
          op.retryCount++;
          if (op.retryCount >= 5) {
            this.queue.shift(); // Drop after max retries
          }
          failed++;
          break; // Stop on error
        }
      }
    } finally {
      this.isProcessing = false;
      await this.persist();
    }

    return { sent, failed };
  }

  // ── Private ──

  private async persist(): Promise<void> {
    if (this.persistence) {
      await this.persistence.save(this.queue);
    }
  }
}
