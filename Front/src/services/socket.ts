type SocketCallback = (data: any) => void;

interface SocketMessage {
  type: string;
  simTime?: string;
  payload: any;
}

class SocketService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<SocketCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastProcessedSequence: Map<string, number> = new Map();
  private intentionalDisconnect = false;

  connect(sessionId: string) {
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }

    this._doConnect(sessionId);
  }

  private _doConnect(sessionId: string) {
    const token = localStorage.getItem('jwt_token');
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    // Conectar directamente al backend (bypassa el proxy de Vite que no
    // maneja upgrades WebSocket en modo middleware de Express).
    // VITE_WS_BASE_URL = ws://localhost:8080  (definido en .env)
    const wsBase: string =
      (import.meta as any).env?.VITE_WS_BASE_URL ??
      ((import.meta as any).env?.DEV
        // En dev el server Express (middleware mode) no proxea upgrades WS:
        // sin VITE_WS_BASE_URL hay que ir directo al backend.
        ? 'ws://localhost:8080'
        : (() => {
            const p = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${p}//${window.location.host}`;
          })());

    const url = `${wsBase}/api/v1/simulations/${sessionId}/ws${tokenParam}`;
    console.log('[Socket] Connecting to', url);

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        console.log('[Socket] Connected');
        this.reconnectAttempts = 0;
      };

      this.socket.onmessage = (event) => {
        try {
          const message: SocketMessage = JSON.parse(event.data);

          if ((message as any).sequenceNumber !== undefined) {
            const lastSeq = this.lastProcessedSequence.get(message.type) ?? -1;
            if ((message as any).sequenceNumber <= lastSeq) return;
            this.lastProcessedSequence.set(message.type, (message as any).sequenceNumber);
          }

          this.emit(message.type, { simTime: message.simTime, payload: message.payload });
        } catch (e) {
          console.error('[Socket] Failed to parse message', e);
        }
      };

      this.socket.onclose = () => {
        console.warn('[Socket] Disconnected');
        this.socket = null;
        if (!this.intentionalDisconnect) {
          this._attemptReconnect(sessionId);
        }
      };

      this.socket.onerror = (error) => {
        console.error('[Socket] Error', error);
      };
    } catch (error) {
      console.error('[Socket] Connection failed', error);
    }
  }

  private _attemptReconnect(sessionId: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      console.log(`[Socket] Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
      setTimeout(() => {
        if (!this.intentionalDisconnect) this._doConnect(sessionId);
      }, delay);
    }
  }

  on(event: string, callback: SocketCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: SocketCallback) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(callback => callback(data));
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.socket?.close();
    this.socket = null;
  }
}

export const socketService = new SocketService();
