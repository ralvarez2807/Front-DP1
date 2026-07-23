type SocketCallback = (data: any) => void;

interface SocketMessage {
  seq?: number;
  type: string;
  simTime?: string;
  payload: any;
}

export class SocketService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<SocketCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastSeq = -1;
  private intentionalDisconnect = false;

  connect(sessionId: string) {
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.lastSeq = -1;

    if (this.socket) {
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
      const ws = new WebSocket(url);
      this.socket = ws;

      // Guard `this.socket !== ws` en los 4 handlers: al reconectar (nueva sesión,
      // o retry automático) el socket viejo puede tener mensajes ya en tránsito
      // (encolados por el browser antes del close()). Sin este guard, un evento
      // tardío del socket VIEJO (p. ej. un COLLAPSE_DETECTED de una sesión que ya
      // se pausó/cerró) se emitía igual — y como los listeners de SimulationProvider
      // ya están suscritos para la sesión NUEVA, se procesaba como si fuera de
      // ésta, mostrando el colapso equivocado. Comparar por identidad de instancia
      // (no por sessionId, que no viaja en el mensaje) es la única forma correcta
      // de saber si este socket sigue siendo el vigente.
      ws.onopen = () => {
        if (this.socket !== ws) return;
        console.log('[Socket] Connected');
        this.reconnectAttempts = 0;
        this.emit('__OPEN__', {});
      };

      ws.onmessage = (event) => {
        if (this.socket !== ws) return;
        try {
          const message: SocketMessage = JSON.parse(event.data);
          const { seq } = message;

          if (seq !== undefined) {
            if (seq <= this.lastSeq) return;

            if (this.lastSeq !== -1 && seq !== this.lastSeq + 1) {
              console.warn(`[Socket] Gap detected: expected seq ${this.lastSeq + 1}, got ${seq}`);
              this.emit('RESYNC_NEEDED', { sessionId });
            }

            this.lastSeq = seq;
          }

          this.emit(message.type, { simTime: message.simTime, payload: message.payload });
        } catch (e) {
          console.error('[Socket] Failed to parse message', e);
        }
      };

      ws.onclose = () => {
        if (this.socket !== ws) return;
        console.warn('[Socket] Disconnected');
        this.socket = null;
        this.emit('__CLOSE__', {});
        if (!this.intentionalDisconnect) {
          this._attemptReconnect(sessionId);
        }
      };

      ws.onerror = (error) => {
        if (this.socket !== ws) return;
        console.error('[Socket] Error', error);
      };
    } catch (error) {
      console.error('[Socket] Connection failed', error);
    }
  }

  /**
   * Fuerza una reconexión inmediata, ignorando el backoff/límite normal de
   * intentos. Pensado para cuando la pestaña vuelve a estar visible tras un
   * buen rato en segundo plano: el backoff de `_attemptReconnect` corre con
   * `setTimeout`, que los navegadores throttlean agresivamente en pestañas no
   * visibles (o pausan del todo si el equipo se suspende) — el cupo de
   * `maxReconnectAttempts` puede agotarse sin que el usuario se entere, y a
   * partir de ahí no hay ningún reintento más programado. No hace nada si la
   * sesión se cerró intencionalmente (pause/stop) ni si ya hay una conexión
   * abierta.
   */
  forceReconnect(sessionId: string) {
    if (this.intentionalDisconnect) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.reconnectAttempts = 0;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this._doConnect(sessionId);
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
