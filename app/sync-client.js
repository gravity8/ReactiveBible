/**
 * ReactiveBible Sync Client
 * Runs inside the Electron main process on non-host machines.
 * Connects to a host, receives state updates, sends actions.
 * Handles auto-reconnect and auto-promote to host on host failure.
 */
const WebSocket = require('ws');

class SyncClient {
  constructor({ onLog } = {}) {
    this.ws = null;
    this.url = null;
    this.pin = null;
    this.name = null;
    this.clientId = null;
    this.role = 'operator';
    this.connected = false;
    this.joinedAt = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 15000;
    this.intentionalClose = false;
    this.onLog = onLog || console.log;

    // Callbacks
    this._onSync = null;
    this._onUpdate = null;
    this._onClientsChanged = null;
    this._onDisconnect = null;
    this._onHostLost = null;
    this._onActionRejected = null;
    this._onError = null;
  }

  connect({ host, port = 3000, pin, name, role = 'operator' }) {
    this.url = `ws://${host}:${port}`;
    this.pin = pin;
    this.name = name;
    this.role = role;
    this.intentionalClose = false;
    this._initialConnect = true;

    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;

      // Timeout after 5 seconds.
      this._connectTimeout = setTimeout(() => {
        this._connectResolve = null;
        this._connectReject = null;
        this.intentionalClose = true;
        if (this.ws) { this.ws.close(); this.ws = null; }
        reject(new Error('Connection timed out. Check the IP address and make sure the host is running.'));
      }, 5000);

      this._doConnect();
    });
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
    this._connectResolve = null;
    this._connectReject = null;
    this._initialConnect = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  sendAction(field, value, action = 'set') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'action',
      field,
      value,
      action,
    }));
  }

  // ── Event handlers ─────────────────────────────────

  onSync(cb) { this._onSync = cb; }
  onUpdate(cb) { this._onUpdate = cb; }
  onClientsChanged(cb) { this._onClientsChanged = cb; }
  onDisconnect(cb) { this._onDisconnect = cb; }
  onHostLost(cb) { this._onHostLost = cb; }
  onActionRejected(cb) { this._onActionRejected = cb; }
  onError(cb) { this._onError = cb; }
  onBecomeHost(cb) { this._onBecomeHost = cb; }

  // ── Private ────────────────────────────────────────

  _doConnect() {
    // Clean up previous socket if any.
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.onLog(`[sync-client] Connection failed: ${err.message}`);
      if (this._initialConnect && this._connectReject) {
        clearTimeout(this._connectTimeout);
        this._connectReject(err);
        this._connectResolve = null;
        this._connectReject = null;
        this._initialConnect = false;
      } else {
        this._scheduleReconnect();
      }
      return;
    }

    this.ws.on('open', () => {
      this.onLog(`[sync-client] Connected to ${this.url}`);
      this.reconnectDelay = 1000; // Reset backoff.
      this.connected = true;

      // Send join message.
      this.ws.send(JSON.stringify({
        type: 'join',
        pin: this.pin,
        name: this.name,
        role: this.role,
      }));
    });

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'sync':
          this.clientId = msg.clientId;
          this.joinedAt = Date.now();
          if (this._onSync) this._onSync(msg.state, msg.clients);
          // Resolve initial connect promise.
          if (this._connectResolve) {
            clearTimeout(this._connectTimeout);
            this._connectResolve();
            this._connectResolve = null;
            this._connectReject = null;
            this._initialConnect = false;
          }
          break;

        case 'update':
          if (this._onUpdate) this._onUpdate(msg.field, msg.value);
          break;

        case 'client-joined':
        case 'client-left':
          if (this._onClientsChanged) this._onClientsChanged(msg.clients, msg);
          break;

        case 'action-rejected':
          this.onLog(`[sync-client] Action rejected: ${msg.field} locked by ${msg.lockedBy}`);
          if (this._onActionRejected) this._onActionRejected(msg.field, msg.lockedBy);
          break;

        case 'host-shutdown':
          this.onLog('[sync-client] Host is shutting down');
          // Don't auto-reconnect to the old host.
          this.intentionalClose = true;
          if (this._onHostLost) this._onHostLost();
          break;

        case 'ping':
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'pong' }));
          }
          break;

        case 'become-host':
          // The current host is transferring host role to us.
          this.onLog('[sync-client] Received host transfer');
          this.intentionalClose = true;
          if (this._onBecomeHost) this._onBecomeHost(msg.state, msg.pin);
          break;

        case 'error':
          this.onLog(`[sync-client] Error from host: ${msg.message}`);
          if (this._onError) this._onError(msg.message);
          // Reject initial connect promise (e.g. wrong PIN).
          if (this._connectReject) {
            clearTimeout(this._connectTimeout);
            this._connectReject(new Error(msg.message));
            this._connectResolve = null;
            this._connectReject = null;
            this._initialConnect = false;
          }
          break;
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      if (this._initialConnect && this._connectReject) {
        clearTimeout(this._connectTimeout);
        this._connectReject(new Error('Connection refused. No session found at this address.'));
        this._connectResolve = null;
        this._connectReject = null;
        this._initialConnect = false;
        return;
      }
      if (!this.intentionalClose) {
        this.onLog('[sync-client] Connection lost');
        if (this._onDisconnect) this._onDisconnect();
        this._scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.onLog(`[sync-client] Error: ${err.message}`);
      // 'close' event will fire after this and handle the rejection.
    });
  }

  _scheduleReconnect() {
    if (this.intentionalClose) return;
    this.onLog(`[sync-client] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._doConnect();
    }, this.reconnectDelay);
    // Exponential backoff.
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}

module.exports = SyncClient;
