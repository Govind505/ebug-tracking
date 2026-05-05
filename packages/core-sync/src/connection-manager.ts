/**
 * ConnectionManager
 * 
 * Manages WebSocket/gRPC connections with automatic reconnection,
 * exponential backoff, heartbeat, and auth token refresh.
 */

import EventEmitter from 'eventemitter3';
import type { ConnectionStatus, SyncConfig } from './types.js';

interface ConnectionEvents {
  'status': (status: ConnectionStatus) => void;
  'message': (data: unknown) => void;
  'error': (error: Error) => void;
}

export class ConnectionManager extends EventEmitter<ConnectionEvents> {
  private config: SyncConfig;
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  constructor(config: SyncConfig) {
    super();
    this.config = config;
  }

  /** Current connection status */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Initiate connection */
  async connect(): Promise<void> {
    if (this.isDestroyed) return;
    this.setStatus('connecting');

    try {
      const token = await this.config.getAuthToken();
      const url = this.buildUrl(token);

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setStatus('connected');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.emit('message', data);
        } catch {
          this.emit('error', new Error('Failed to parse message'));
        }
      };

      this.ws.onerror = () => {
        this.emit('error', new Error('WebSocket connection error'));
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        if (!this.isDestroyed && !event.wasClean) {
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };
    } catch (error) {
      this.setStatus('error');
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  /** Send a message through the connection */
  send(data: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /** Gracefully disconnect */
  disconnect(): void {
    this.isDestroyed = true;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnection on intentional close
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.setStatus('disconnected');
  }

  /** Reconnect (e.g., after token refresh) */
  async reconnect(): Promise<void> {
    this.disconnect();
    this.isDestroyed = false;
    await this.connect();
  }

  // ── Private ──

  private buildUrl(token: string): string {
    const base = this.config.serverUrl.replace(/^http/, 'ws');
    const params = new URLSearchParams({
      token,
      org_id: this.config.orgId,
      user_id: this.config.userId,
    });
    return `${base}/ws/v1/stream?${params.toString()}`;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;

    this.setStatus('reconnecting');
    this.reconnectAttempt++;

    const baseDelay = this.config.reconnectBaseDelay ?? 1000;
    const maxDelay = this.config.reconnectMaxDelay ?? 30000;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempt - 1) + Math.random() * 1000,
      maxDelay
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', timestamp: new Date().toISOString() });
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
