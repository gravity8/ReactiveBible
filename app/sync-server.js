/**
 * ReactiveBible Sync Server
 * Runs inside the Electron main process on the host machine.
 * Manages connected clients, broadcasts state, handles actions.
 */
const { WebSocket, WebSocketServer } = require('ws');
const crypto = require('crypto');
const os = require('os');

class SyncServer {
  constructor({ port = 3000, pin, onLog } = {}) {
    this.port = port;
    this.wss = null;
    this.pin = pin || this._generatePin();
    this.clients = new Map(); // ws → { id, name, role, joinedAt }
    this.state = {};          // Full app state to sync
    this.actionLock = null;   // { field, by, until } — brief lock after mutation
    this.onLog = onLog || console.log;
    this.heartbeatInterval = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        this.onLog(`[sync] Server started on port ${this.port}, PIN: ${this.pin}`);
        this._startHeartbeat();
        resolve({ port: this.port, pin: this.pin, ip: this._getLocalIP() });
      });

      this.wss.on('error', (err) => {
        this.onLog(`[sync] Server error: ${err.message}`);
        reject(err);
      });

      this.wss.on('connection', (ws) => this._handleConnection(ws));
    });
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.wss) {
      // Notify all clients before closing.
      this.broadcast({ type: 'host-shutdown' });
      // Terminate all client sockets.
      for (const [ws] of this.clients) {
        try { ws.terminate(); } catch {}
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    } else {
      this.clients.clear();
    }
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
  }

  getConnectedClients() {
    return Array.from(this.clients.values()).map(c => ({
      id: c.id,
      name: c.name,
      role: c.role,
      joinedAt: c.joinedAt,
    }));
  }

  broadcast(message, excludeWs = null) {
    const data = JSON.stringify(message);
    for (const [ws] of this.clients) {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch (e) {
          // Socket closed between readyState check and send — ignore.
        }
      }
    }
  }

  // ── Private ────────────────────────────────────────

  _handleConnection(ws) {
    let clientInfo = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'join': {
          if (msg.pin !== this.pin) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid PIN' }));
            ws.close();
            return;
          }
          clientInfo = {
            id: crypto.randomUUID(),
            name: msg.name || 'Unknown',
            role: msg.role || 'operator',
            joinedAt: Date.now(),
          };
          this.clients.set(ws, clientInfo);
          this.onLog(`[sync] ${clientInfo.name} joined as ${clientInfo.role}`);

          // Send full state sync.
          ws.send(JSON.stringify({
            type: 'sync',
            state: this.state,
            clientId: clientInfo.id,
            clients: this.getConnectedClients(),
          }));

          // Notify others.
          this.broadcast({
            type: 'client-joined',
            client: { id: clientInfo.id, name: clientInfo.name, role: clientInfo.role },
            clients: this.getConnectedClients(),
          }, ws);
          break;
        }

        case 'action': {
          if (!clientInfo) return;

          // Check action lock.
          if (this.actionLock && msg.field === this.actionLock.field) {
            const now = Date.now();
            if (now < this.actionLock.until) {
              // Reject — another operator got there first.
              ws.send(JSON.stringify({
                type: 'action-rejected',
                field: msg.field,
                lockedBy: this.actionLock.by,
              }));
              return;
            }
          }

          // Apply lock for 500ms on critical fields.
          const lockableFields = ['liveVerse', 'previewVerse'];
          if (lockableFields.includes(msg.field)) {
            this.actionLock = {
              field: msg.field,
              by: clientInfo.name,
              until: Date.now() + 500,
            };
          }

          // Broadcast the action to host handler (via callback).
          if (this._onAction) {
            this._onAction(msg, clientInfo);
          }
          break;
        }

        case 'pong': {
          if (clientInfo) clientInfo.lastPong = Date.now();
          break;
        }

        case 'transfer-host': {
          // The current host wants to make a connected client the new host.
          // msg.targetId = the client ID to promote.
          if (!clientInfo || !msg.targetId) return;
          // Find the target client.
          let targetWs = null;
          let targetInfo = null;
          for (const [ws2, info2] of this.clients) {
            if (info2.id === msg.targetId) {
              targetWs = ws2;
              targetInfo = info2;
              break;
            }
          }
          if (!targetWs || !targetInfo) return;
          // Notify the target that they should become host.
          targetWs.send(JSON.stringify({
            type: 'become-host',
            state: this.state,
            pin: this.pin,
          }));
          this.onLog(`[sync] Host transfer: ${clientInfo.name} → ${targetInfo.name}`);
          break;
        }
      }
    });

    ws.on('close', () => {
      if (clientInfo) {
        this.onLog(`[sync] ${clientInfo.name} disconnected`);
        this.clients.delete(ws);
        this.broadcast({
          type: 'client-left',
          clientId: clientInfo.id,
          clients: this.getConnectedClients(),
        });
      }
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  onAction(callback) {
    this._onAction = callback;
  }

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [ws, info] of this.clients) {
        // If no pong in 15 seconds, consider dead.
        if (info.lastPong && now - info.lastPong > 15000) {
          this.onLog(`[sync] ${info.name} timed out`);
          ws.terminate();
          this.clients.delete(ws);
          this.broadcast({
            type: 'client-left',
            clientId: info.id,
            clients: this.getConnectedClients(),
          });
          continue;
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }
    }, 5000);
  }

  _generatePin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  _getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }
}

module.exports = SyncServer;
