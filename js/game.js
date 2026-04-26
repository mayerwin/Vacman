// Game: manages a single round.
//   - holds the World, the players, the pets, the pickups, mines, bullets
//   - runs the simulation each frame
//   - emits events the UI can listen to (toast, score change, level cleared)
//
// Designed to run identically in two modes:
//   - LOCAL (single player or host): full simulation runs here.
//   - REMOTE (guest): no simulation; we just render snapshots from the host.

import * as THREE from "three";
import { LEVELS, difficultyForPlayers } from "./levels.js";
import { World, CELL_SIZE } from "./world.js";
import { Pet } from "./pets.js";
import { buildVacuum, animateVacuum, BRAND_PALETTE } from "./vacuum.js";
import {
  PowerupPickup, Bullet, Mine, POWERUP_KINDS, powerupMeta,
} from "./powerups.js";
import { spawnDamageBurst } from "./effects.js";

const VAC_RADIUS = 0.55;
const BASE_SPEED = 5.4;

export class Game {
  constructor(engine, opts) {
    this.engine = engine;
    this.opts = opts; // { mode, isHost, levelIndex, players: [{id,name,brand,color,isLocal}] }
    this.players = new Map();
    this.world = null;
    this.pets = [];
    this.pickups = [];
    this.bullets = [];
    this.mines = [];
    this.events = {};            // event listeners
    this.localPlayerId = null;
    this.elapsed = 0;
    this.dirtCleared = 0;
    this.status = "playing";     // "playing" | "cleared" | "failed" | "celebrating"
    this.powerupTimer = 0;
    this.nextPowerupAt = 4;
    this.bulletCooldownByPlayer = new Map();

    // Build players and world.
    for (const p of opts.players) this._spawnPlayer(p);
    this.setLevel(opts.levelIndex ?? 0);
  }

  on(event, cb) { (this.events[event] ||= []).push(cb); }
  emit(event, data) { (this.events[event] || []).forEach((cb) => cb(data)); }

  // -------------- Player lifecycle --------------

  _spawnPlayer({ id, name, brand, color, isLocal }) {
    const mesh = buildVacuum({ brand, color });
    this.engine.scene.add(mesh);
    const p = {
      id, name, brand, color,
      mesh,
      position: { x: 0, z: 0 },
      rotation: 0,
      facing: 0,
      velocity: { x: 0, z: 0 },
      score: 0,
      powerup: null,
      stunned: 0,
      speedUntil: 0,
      stealthUntil: 0,
      turretUntil: 0,
      turretCooldown: 0,
      active: true,
      isLocal,
      hp: 1,
    };
    this.players.set(id, p);
    if (isLocal) this.localPlayerId = id;
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.engine.scene.remove(p.mesh);
    this.players.delete(id);
  }

  // -------------- Level setup --------------

  setLevel(index) {
    this.levelIndex = index;
    const def = LEVELS[index] ?? LEVELS[0];
    this.levelDef = def;

    // Tear down old.
    if (this.world) this.world.dispose();
    this.pets.forEach((p) => this.engine.scene.remove(p.mesh));
    this.pets = [];
    this.pickups.forEach((pu) => pu.dispose());
    this.pickups = [];
    this.bullets.forEach((b) => b.kill());
    this.bullets = [];
    this.mines.forEach((m) => this.engine.scene.remove(m.mesh));
    this.mines = [];

    this.engine.applyMood(def.mood);

    this.world = new World(this.engine.scene, def);
    // Tell the engine the playable bounds so the camera stays inside.
    {
      const halfW = (this.world.cols * 1.0) / 2;
      const halfH = (this.world.rows * 1.0) / 2;
      this.engine.setLevelBounds(
        { x: -halfW, z: -halfH },
        { x:  halfW, z:  halfH },
      );
    }
    // Re-position players at spawns.
    let i = 0;
    for (const p of this.players.values()) {
      const spawn = this.world.spawns[i % this.world.spawns.length];
      const w = this.world.cellToWorld(spawn.c, spawn.r);
      p.position.x = w.x;
      p.position.z = w.z;
      p.mesh.position.set(w.x, 0, w.z);
      p.rotation = 0; p.facing = 0;
      p.score = 0; // per-room reset only in versus, persistent in coop
      i++;
    }

    // Spawn pets.
    const diff = difficultyForPlayers(this.players.size, this.opts.mode);
    let spawnIdx = 0;
    for (const group of def.pets) {
      for (let k = 0; k < group.count; k++) {
        const cell = this.world.petSpawns[spawnIdx % Math.max(1, this.world.petSpawns.length)] ||
                     this.world.spawns[0];
        const pet = new Pet(group.kind, this.world, cell, diff);
        this.pets.push(pet);
        spawnIdx++;
      }
    }

    this.dirtCleared = 0;
    this.status = "playing";
    this.elapsed = 0;
    this.powerupTimer = 0;
    this.nextPowerupAt = 3 + Math.random() * 3;

    this.emit("level-changed", { index, def });
  }

  nextLevel() {
    const ni = this.levelIndex + 1;
    if (ni >= LEVELS.length) {
      this.status = "celebrating";
      this.emit("game-complete", null);
      return;
    }
    this.setLevel(ni);
  }

  // -------------- Frame update --------------

  update(dt, input) {
    if (this.status !== "playing") {
      this.elapsed += dt;
      this.world?.update(dt, this.elapsed);
      // still animate vacuums + decorations
      for (const p of this.players.values()) animateVacuum(p.mesh, dt);
      return;
    }

    this.elapsed += dt;
    this.world.update(dt, this.elapsed);

    // Local player input → drive only the local player. Host applies remote
    // inputs through pushRemoteInput().
    const local = this.players.get(this.localPlayerId);
    if (local && input) {
      const raw = input.read();
      this._applyInput(local, dt, raw);
      if (input.consumeAction()) this._fireAction(local);
    }

    // Remote inputs (host side).
    if (this._remoteInputs) {
      for (const [pid, ri] of this._remoteInputs) {
        const p = this.players.get(pid);
        if (!p) continue;
        this._applyInput(p, dt, ri.axis);
        if (ri.action) { this._fireAction(p); ri.action = false; }
      }
    }

    // Pets.
    const playerList = [...this.players.values()];
    for (const pet of this.pets) {
      pet.update(dt, playerList);
      if (!pet.alive) continue;
      // Collide with players (stun).
      for (const p of playerList) {
        if (!p.active || p.stunned > 0) continue;
        if (p.stealthUntil > this.elapsed) continue;
        if (pet.stunPlayer(p.position)) {
          p.stunned = 2.0;
          p.score = Math.max(0, p.score - 25);
          this.emit("player-stunned", { player: p, pet });
          spawnDamageBurst(this.world, p.position.x, p.position.z, p.color);
          // Knockback
          const dx = p.position.x - pet.mesh.position.x;
          const dz = p.position.z - pet.mesh.position.z;
          const d = Math.hypot(dx, dz) || 1;
          p.velocity.x = (dx / d) * 4;
          p.velocity.z = (dz / d) * 4;
        }
      }
    }
    this.pets = this.pets.filter((p) => p.alive || p.mesh.parent);

    // Pickups.
    this.pickups.forEach((pu) => pu.update(dt));
    for (const pu of this.pickups) {
      if (!pu.alive) continue;
      for (const p of playerList) {
        if (!p.active || p.stunned > 0) continue;
        const dx = p.position.x - pu.mesh.position.x;
        const dz = p.position.z - pu.mesh.position.z;
        if (dx * dx + dz * dz <= 0.6 * 0.6) {
          if (pu.collect()) {
            this._grantPowerup(p, pu.kind);
          }
        }
      }
    }
    this.pickups = this.pickups.filter((p) => p.alive);

    // Bullets.
    for (const b of this.bullets) {
      b.update(dt);
      if (!b.alive) continue;
      for (const pet of this.pets) {
        if (!pet.alive) continue;
        if (b.hits(pet)) {
          pet.kill();
          b.kill();
          this._creditPetKill(b.ownerId);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);

    // Mines. Mines are lethal to anyone — including the player who dropped
    // them — once their (longer) self-arming delay expires. Pets and other
    // players trigger after the short normal arming delay.
    for (const m of this.mines) {
      m.update(dt);
      if (!m.alive) continue;
      let triggered = null;
      for (const target of this.pets) {
        if (!target.alive) continue;
        const pos = { x: target.mesh.position.x, z: target.mesh.position.z };
        if (m.triggers(pos)) { triggered = target; break; }
      }
      if (!triggered) {
        for (const target of playerList) {
          if (!target.active || target.stunned > 0) continue;
          if (target.id === m.ownerId) {
            if (m.triggers(target.position, true)) { triggered = target; break; }
          } else {
            if (m.triggers(target.position)) { triggered = target; break; }
          }
        }
      }
      if (triggered) {
        const killed = m.detonate(this.world, this.pets, playerList);
        for (const _ of killed) this._creditPetKill(m.ownerId);
        this.emit("explosion", { x: m.mesh.position.x, z: m.mesh.position.z, kind: m.kind });
        // Stun any player caught — including the owner.
        for (const p of playerList) {
          const dx = p.position.x - m.mesh.position.x;
          const dz = p.position.z - m.mesh.position.z;
          if (dx * dx + dz * dz <= m.radius * m.radius) {
            p.stunned = Math.max(p.stunned || 0, p.id === m.ownerId ? 1.6 : 1.2);
            p.score = Math.max(0, p.score - (p.id === m.ownerId ? 30 : 20));
            this.emit("player-stunned", { player: p, mine: true });
            spawnDamageBurst(this.world, p.position.x, p.position.z, p.color);
          }
        }
      }
    }
    this.mines = this.mines.filter((m) => m.alive);

    // Spawn powerups periodically.
    this.powerupTimer += dt;
    if (this.powerupTimer >= this.nextPowerupAt && this.pickups.length < (this.levelDef.powerups || 3)) {
      this.powerupTimer = 0;
      this.nextPowerupAt = 4 + Math.random() * 5;
      this._spawnRandomPowerup();
    }

    // Dirt collection + door unlock.
    let collectedSinceLast = 0;
    for (const p of playerList) {
      if (!p.active || p.stunned > 0) continue;
      const got = this.world.collectDirt(p.position.x, p.position.z, VAC_RADIUS * 1.05);
      if (got > 0) {
        const points = got * 10;
        p.score += points;
        this.dirtCleared += got;
        collectedSinceLast += got;
        if (p.isLocal) this.emit("dirt-collected", { count: got });
      }
    }
    if (collectedSinceLast > 0) this.emit("score-changed");

    if (this.world.remainingDirt() === 0 && !this.world.doorOpen) {
      this.world.openDoor();
      this.emit("door-open", { level: this.levelDef });
    }

    // Reach door / dock?
    if (this.world.doorOpen && this.world.dockCell) {
      const dock = this.world.cellToWorld(this.world.dockCell.c, this.world.dockCell.r);
      const reachedBy = playerList.find((p) => {
        if (!p.active) return false;
        const dx = p.position.x - dock.x;
        const dz = p.position.z - dock.z;
        return dx * dx + dz * dz < 0.7 * 0.7;
      });
      if (reachedBy) {
        this.status = "cleared";
        this.emit("level-cleared", { reachedBy, time: this.elapsed });
      }
    }

    // Animate per-player tweaks (vacuum brand spinners, stun timer, etc).
    for (const p of playerList) {
      if (p.stunned > 0) p.stunned = Math.max(0, p.stunned - dt);
      animateVacuum(p.mesh, dt);

      // Turret continuous firing.
      if (p.turretUntil > this.elapsed) {
        p.turretCooldown -= dt;
        if (p.turretCooldown <= 0) {
          p.turretCooldown = 0.22;
          this._spawnTurretShot(p);
        }
      }
    }

    // Camera follows local player.
    if (local) {
      this.engine.setFollow(local.position, local.rotation);
      // Hide the local vacuum's body in first-person (would obscure the view).
      const fp = this.engine.cameraMode === "first";
      local.mesh.visible = !fp;
    }
  }

  _applyInput(p, dt, axis) {
    if (p.stunned > 0) {
      // apply velocity drift only
      p.position.x += p.velocity.x * dt;
      p.position.z += p.velocity.z * dt;
      p.velocity.x *= Math.pow(0.0001, dt);
      p.velocity.z *= Math.pow(0.0001, dt);
      this._resolveCollision(p);
      p.mesh.position.set(p.position.x, 0, p.position.z);
      p.mesh.rotation.y = p.rotation + Math.PI;
      return;
    }
    let speedMul = 1;
    if (p.speedUntil > this.elapsed) speedMul = 1.5;
    const speed = BASE_SPEED * speedMul;

    let vx = axis.x * speed;
    let vz = axis.y * speed;
    // In third-person / first-person, W/A/S/D are camera-relative: W is
    // "where the camera looks", A/D strafes. Mouse rotates the bot's
    // facing, which the camera then follows. Critically we DO NOT
    // re-derive p.facing from movement direction below — that would fight
    // the mouse-driven rotation and make the camera shake.
    let cameraRelative = false;
    if (p.isLocal && this.engine.cameraMode !== "topdown") {
      cameraRelative = true;
      // Bake the mouse drag into the bot facing once per frame; reset.
      p.facing += this.engine.mouseYaw;
      this.engine.mouseYaw = 0;
      const yaw = p.facing;
      const fwd = -axis.y;            // W = forward
      const rht =  axis.x;            // D = strafe right
      // World-space velocity from camera basis. atan2(sin, cos) of the
      // result equals the camera yaw when fwd=1 / rht=0, so movement is
      // along the look axis.
      vx = (fwd * Math.sin(yaw) + rht * Math.cos(yaw)) * speed;
      vz = (fwd * Math.cos(yaw) - rht * Math.sin(yaw)) * speed;
    }
    const dx = vx * dt;
    const dz = vz * dt;

    // Move along x then z so we can slide along walls. Each axis: try the
    // step; if a pushable is in the way, attempt to shove it; if a wall is
    // in the way, just stop on that axis.
    const tryAxis = (axis, delta) => {
      if (delta === 0) return;
      const sign = Math.sign(delta);
      const probe = axis === "x"
        ? { x: p.position.x + delta + sign * VAC_RADIUS, z: p.position.z }
        : { x: p.position.x, z: p.position.z + delta + sign * VAC_RADIUS };
      const cell = this.world.worldToCell(probe.x, probe.z);
      if (this.world.isSolid(cell.c, cell.r)) return; // wall — blocked
      const pushable = this.world.pushableAt(cell.c, cell.r);
      if (pushable) {
        const moved = this.world.tryPush(
          pushable,
          axis === "x" ? sign : 0,
          axis === "z" ? sign : 0,
        );
        if (!moved) return;          // furniture jammed against wall
      }
      if (axis === "x") p.position.x += delta;
      else              p.position.z += delta;
    };
    tryAxis("x", dx);
    tryAxis("z", dz);

    // Topdown mode auto-rotates the bot toward its motion direction. In
    // camera-relative modes (3rd / FP) we keep facing locked to the
    // mouse-driven yaw so the player's input frame is stable.
    if (!cameraRelative && Math.hypot(vx, vz) > 0.01) {
      p.facing = Math.atan2(vx, vz);
    }
    // Smooth rotation. In FP/3rd modes use a much faster lerp so the bot
    // (and the camera that follows it) doesn't lag behind the mouse.
    let dr = p.facing - p.rotation;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    const lerp = cameraRelative ? Math.min(1, dt * 28) : Math.min(1, dt * 12);
    p.rotation += dr * lerp;
    p.mesh.position.set(p.position.x, 0, p.position.z);
    p.mesh.rotation.y = p.rotation;
  }

  _resolveCollision(p) {
    // After velocity-only push, ensure not inside a wall.
    const cell = this.world.worldToCell(p.position.x, p.position.z);
    if (this.world.isSolid(cell.c, cell.r)) {
      const w = this.world.cellToWorld(cell.c, cell.r);
      const dx = p.position.x - w.x;
      const dz = p.position.z - w.z;
      const d = Math.hypot(dx, dz) || 1;
      p.position.x = w.x + (dx / d) * (CELL_SIZE * 0.6);
      p.position.z = w.z + (dz / d) * (CELL_SIZE * 0.6);
    }
  }

  _spawnRandomPowerup() {
    if (!this.world) return;
    const slots = this.world.powerupSlots.filter((c) => {
      // not on a tile that already has a pickup, not too close to spawn or a player.
      for (const pu of this.pickups) {
        if (pu.cell.c === c.c && pu.cell.r === c.r) return false;
      }
      return true;
    });
    if (slots.length === 0) return;
    const cell = slots[Math.floor(Math.random() * slots.length)];
    const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
    const pu = new PowerupPickup(this.world, cell, kind);
    this.pickups.push(pu);
  }

  _grantPowerup(p, kind) {
    p.powerup = kind;
    this.emit("powerup-collected", { player: p, kind });
  }

  _fireAction(p) {
    if (!p.powerup || p.stunned > 0) return;
    const kind = p.powerup;
    p.powerup = null;
    if (kind === "speed") {
      p.speedUntil = this.elapsed + 5;
    } else if (kind === "stealth") {
      p.stealthUntil = this.elapsed + 4;
    } else if (kind === "turret") {
      p.turretUntil = this.elapsed + 8;
      p.turretCooldown = 0;
    } else if (kind === "mine" || kind === "bomb") {
      // Drop behind the vacuum.
      const back = -1;
      const x = p.position.x + Math.sin(p.rotation) * back * 0.7;
      const z = p.position.z + Math.cos(p.rotation) * back * 0.7;
      this.mines.push(new Mine(this.world, x, z, p.id, kind));
      this.emit("mine-dropped", { player: p, kind });
    }
    this.emit("powerup-used", { player: p, kind });
  }

  _spawnTurretShot(p) {
    this.emit("turret-fired", { player: p });
    // Find nearest pet.
    let nearest = null; let nearestD = 9999;
    for (const pet of this.pets) {
      if (!pet.alive) continue;
      const dx = pet.mesh.position.x - p.position.x;
      const dz = pet.mesh.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d < nearestD) { nearestD = d; nearest = pet; }
    }
    if (!nearest || nearestD > 9) {
      // fire forward
      const dx = Math.sin(p.rotation), dz = Math.cos(p.rotation);
      this.bullets.push(new Bullet(this.world, p.position.x, p.position.z, dx, dz, p.id));
      return;
    }
    const dx = nearest.mesh.position.x - p.position.x;
    const dz = nearest.mesh.position.z - p.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.bullets.push(new Bullet(this.world, p.position.x, p.position.z, dx / d, dz / d, p.id));
  }

  _creditPetKill(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.score += 50;
    this.emit("score-changed");
  }

  // -------------- Multiplayer hooks --------------

  pushRemoteInput(playerId, axis, action) {
    if (!this._remoteInputs) this._remoteInputs = new Map();
    const cur = this._remoteInputs.get(playerId) || { axis: { x: 0, y: 0 }, action: false };
    cur.axis = axis;
    if (action) cur.action = true;
    this._remoteInputs.set(playerId, cur);
  }

  // Build a snapshot for transmission.
  snapshot() {
    return {
      type: "snap",
      t: this.elapsed,
      level: this.levelIndex,
      status: this.status,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        n: p.name,
        b: p.brand,
        c: p.color,
        x: round(p.position.x), z: round(p.position.z), r: round(p.rotation),
        s: p.score, st: round(p.stunned),
        pu: p.powerup, su: round(p.speedUntil - this.elapsed),
        sl: round(p.stealthUntil - this.elapsed),
        tu: round(p.turretUntil - this.elapsed),
      })),
      pets: this.pets.map((pet) => ({
        k: pet.kind, x: round(pet.mesh.position.x), z: round(pet.mesh.position.z),
        a: pet.alive ? 1 : 0,
      })),
      dirt: this.world.dirt.map((d) => d.alive ? 1 : 0),
      pickups: this.pickups.map((pu) => ({
        k: pu.kind, x: round(pu.mesh.position.x), z: round(pu.mesh.position.z),
      })),
      mines: this.mines.map((m) => ({
        k: m.kind, x: round(m.mesh.position.x), z: round(m.mesh.position.z),
      })),
      doorOpen: !!this.world.doorOpen,
      dirtTotal: this.world.totalDirt(),
      dirtRemain: this.world.remainingDirt(),
    };
  }

  // Apply a remote snapshot (guest side).
  applySnapshot(snap) {
    if (snap.level !== this.levelIndex) {
      this.setLevel(snap.level);
    }
    this.elapsed = snap.t;
    // Update or create player meshes.
    const seen = new Set();
    for (const ps of snap.players) {
      seen.add(ps.id);
      let p = this.players.get(ps.id);
      if (!p) {
        p = this._spawnPlayer({
          id: ps.id, name: ps.n, brand: ps.b, color: ps.c,
          isLocal: ps.id === this.localPlayerId,
        });
      }
      // Smooth lerp toward target.
      p.position.x += (ps.x - p.position.x) * 0.55;
      p.position.z += (ps.z - p.position.z) * 0.55;
      p.rotation = lerpAngle(p.rotation, ps.r, 0.5);
      p.score = ps.s;
      p.stunned = ps.st;
      p.powerup = ps.pu;
      p.speedUntil = (ps.su || 0) + this.elapsed;
      p.stealthUntil = (ps.sl || 0) + this.elapsed;
      p.mesh.position.set(p.position.x, 0, p.position.z);
      p.mesh.rotation.y = p.rotation;
      animateVacuum(p.mesh, 0.016);
    }
    // Remove vanished players.
    for (const pid of [...this.players.keys()]) {
      if (!seen.has(pid)) this.removePlayer(pid);
    }
    // Reconcile dirt.
    for (let i = 0; i < snap.dirt.length && i < this.world.dirt.length; i++) {
      const d = this.world.dirt[i];
      const alive = !!snap.dirt[i];
      if (d.alive && !alive) {
        d.alive = false;
        d.mesh.visible = false;
      }
    }
    // Update door.
    if (snap.doorOpen && !this.world.doorOpen) this.world.openDoor();
    // Update pets (simple reconcile by index).
    for (let i = 0; i < snap.pets.length; i++) {
      const sp = snap.pets[i];
      let pet = this.pets[i];
      if (!pet) {
        // spawn
        pet = new Pet(sp.k, this.world, this.world.worldToCell(sp.x, sp.z), 1);
        this.pets[i] = pet;
      }
      if (sp.a) {
        pet.mesh.position.x += (sp.x - pet.mesh.position.x) * 0.6;
        pet.mesh.position.z += (sp.z - pet.mesh.position.z) * 0.6;
        const dx = sp.x - pet.mesh.position.x;
        const dz = sp.z - pet.mesh.position.z;
        if (Math.hypot(dx, dz) > 0.05) pet.mesh.rotation.y = Math.atan2(dx, dz);
      } else if (pet.alive) {
        pet.kill();
      }
    }
    // Local camera follow.
    const local = this.players.get(this.localPlayerId);
    if (local) {
      this.engine.setFollow(local.position, local.rotation);
      const fp = this.engine.cameraMode === "first";
      local.mesh.visible = !fp;
    }
    this.world?.update(0.016, this.elapsed);
  }

  destroy() {
    if (this.world) this.world.dispose();
    for (const p of this.players.values()) this.engine.scene.remove(p.mesh);
    for (const pu of this.pickups) pu.dispose();
    this.players.clear();
    this.pets = []; this.pickups = []; this.bullets = []; this.mines = [];
  }
}

function round(n) { return Math.round(n * 100) / 100; }
function lerpAngle(a, b, t) {
  let dr = b - a;
  while (dr > Math.PI) dr -= Math.PI * 2;
  while (dr < -Math.PI) dr += Math.PI * 2;
  return a + dr * t;
}
