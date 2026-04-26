// Networking via PeerJS (WebRTC P2P over a free public broker).
//
// Topology: star, host-authoritative.
//   - Host owns world simulation. It broadcasts ~20 Hz state snapshots.
//   - Guests send only their input (axis + action pulses). They render the
//     last snapshot from the host with simple interpolation.
//   - Lobby chat: small JSON messages keep things readable.
//
// Room codes are 4-char alphanumeric. We register the host's PeerJS id as
// `vacman-<CODE>` so guests can find them deterministically.

const ROOM_PREFIX = "vacman-arcade-2026-";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars

export function makeRoomCode() {
  let s = "";
  for (let i = 0; i < 4; i++)
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.role = "offline"; // "offline" | "host" | "guest"
    this.code = null;
    this.connections = new Map(); // peerId -> DataConnection (host side)
    this.hostConn = null;          // guest side
    this.handlers = {};
  }

  on(event, cb) { this.handlers[event] = cb; }
  emit(event, data) { if (this.handlers[event]) this.handlers[event](data); }

  _newPeer(id) {
    if (typeof window.Peer === "undefined") {
      this.emit("error", "PeerJS failed to load.");
      return null;
    }
    return new window.Peer(id, {
      debug: 1,
    });
  }

  // ------- Host -------
  async host() {
    this.role = "host";
    this.code = makeRoomCode();
    const peerId = ROOM_PREFIX + this.code;
    this.peer = this._newPeer(peerId);

    return new Promise((resolve, reject) => {
      const fail = (err) => { this.emit("error", err?.type || String(err)); reject(err); };
      this.peer.on("open", (id) => {
        this.emit("hosted", { code: this.code, id });
        resolve({ code: this.code });
      });
      this.peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          // Race: very rare collision on the broker. Retry with a new code.
          this.peer.destroy();
          this.code = makeRoomCode();
          this.peer = this._newPeer(ROOM_PREFIX + this.code);
          this.peer.on("open", (id) => {
            this.emit("hosted", { code: this.code, id });
            resolve({ code: this.code });
          });
          this.peer.on("error", fail);
          this._wireHostEvents();
        } else fail(err);
      });
      this._wireHostEvents();
    });
  }

  _wireHostEvents() {
    if (!this.peer) return;
    this.peer.on("connection", (conn) => {
      conn.on("open", () => {
        this.connections.set(conn.peer, conn);
        this.emit("guest-connected", { id: conn.peer });
      });
      conn.on("data", (raw) => {
        const msg = typeof raw === "string" ? safeParse(raw) : raw;
        if (!msg) return;
        this.emit("from-guest", { id: conn.peer, msg });
      });
      conn.on("close", () => {
        this.connections.delete(conn.peer);
        this.emit("guest-disconnected", { id: conn.peer });
      });
      conn.on("error", () => {
        this.connections.delete(conn.peer);
        this.emit("guest-disconnected", { id: conn.peer });
      });
    });
  }

  // ------- Guest -------
  async join(code) {
    this.role = "guest";
    this.code = code.toUpperCase();
    this.peer = this._newPeer();
    return new Promise((resolve, reject) => {
      this.peer.on("open", () => {
        const conn = this.peer.connect(ROOM_PREFIX + this.code, {
          serialization: "json",
          reliable: false,
        });
        const fail = (err) => { this.emit("error", err?.type || String(err)); reject(err); };
        let opened = false;
        conn.on("open", () => {
          opened = true;
          this.hostConn = conn;
          this.emit("joined", { code: this.code });
          resolve();
        });
        conn.on("data", (raw) => {
          const msg = typeof raw === "string" ? safeParse(raw) : raw;
          if (!msg) return;
          this.emit("from-host", msg);
        });
        conn.on("close", () => {
          this.emit("disconnected");
          this.hostConn = null;
        });
        conn.on("error", fail);
        // Bail if the connection never opens.
        setTimeout(() => {
          if (!opened) fail({ type: "timeout" });
        }, 8000);
      });
      this.peer.on("error", (err) => {
        this.emit("error", err?.type || String(err));
        reject(err);
      });
    });
  }

  // ------- Send -------
  sendToAll(msg) {
    for (const c of this.connections.values()) {
      if (c.open) c.send(msg);
    }
  }
  sendToHost(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
  }

  destroy() {
    try { this.peer?.destroy(); } catch (_) {}
    this.peer = null;
    this.connections.clear();
    this.hostConn = null;
    this.role = "offline";
    this.code = null;
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
