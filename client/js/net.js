import { io } from "/socket.io/socket.io.esm.min.js";

// Detect if running inside Capacitor (APK) vs browser
const isCapacitor = !!(window.Capacitor) || location.protocol === "capacitor:";

export function resolveServerUrl() {
  // 1. User-configured URL (from Settings in-app)
  const stored = localStorage.getItem("ns_server_url");
  if (stored && stored.startsWith("http")) return stored;

  // 2. Capacitor APK with no configured URL
  if (isCapacitor) return null;

  // 3. Browser: auto-detect from current page origin
  const h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:3000";
  return window.location.origin;
}

export class NetworkClient {
  constructor() {
    this.url    = resolveServerUrl();
    this.socket = null;
    this.handlers = {};
  }

  on(name, handler) {
    this.handlers[name] = handler;
  }

  connect(username, roomId) {
    if (!this.url) {
      setTimeout(() =>
        this.handlers.error?.("No server URL set. Open Settings and enter your server URL."), 100);
      return;
    }

    this.socket = io(this.url, {
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionDelayMax: 1200,
      timeout: 8000
    });

    this.socket.on("connect", () => {
      this.handlers.connect?.(this.socket.id);
      this.socket.emit("join-game", { username, roomId });
    });

    this.socket.on("welcome",     data  => this.handlers.welcome?.(data));
    this.socket.on("room-state",  data  => this.handlers.snapshot?.(data));
    this.socket.on("server-pong", stamp => this.handlers.ping?.(performance.now() - stamp));
    this.socket.on("disconnect",  reason => this.handlers.disconnect?.(reason));
    this.socket.on("connect_error", err  => this.handlers.error?.(err?.message || "Connection failed"));
  }

  sendInput(state) { if (this.socket?.connected) this.socket.emit("input", state); }
  sendAction(kind)  { if (this.socket?.connected) this.socket.emit("action", { kind }); }
  ping()            { if (this.socket?.connected) this.socket.emit("client-ping", performance.now()); }
  disconnect()      { this.socket?.disconnect(); this.socket = null; }
}
