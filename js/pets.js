// Pets — the antagonists. Four breeds, each with a different behaviour.
//
// All pets share the same grid-walking pacman-style movement model:
//   - they always travel toward the centre of their next cell
//   - on arriving at a cell centre they pick a new direction
//   - direction choice is per-breed
//
// Parrots break the model: they fly free above walls.

import * as THREE from "three";

const DIRS = [
  { c:  1, r:  0 },
  { c: -1, r:  0 },
  { c:  0, r:  1 },
  { c:  0, r: -1 },
];

export const PET_TUNING = {
  cat:     { speed: 2.4, watchChance: 0.25, color: 0xff8c42, accent: 0xffd84d, sniff: 0xffd84d },
  dog:     { speed: 3.1, persistence: 0.85, color: 0xb98a55, accent: 0x6b4a2e, sniff: 0xff6b6b },
  hamster: { speed: 2.0, randomness: 0.7, color: 0xf5c89a, accent: 0xb98a55, sniff: 0xffd84d },
  parrot:  { speed: 2.7, color: 0xff3d8b, accent: 0x00ffc6, sniff: 0xff3d8b, fly: true },
};

function buildPetMesh(kind) {
  const tune = PET_TUNING[kind];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: tune.color, roughness: 0.55,
  });
  const accMat = new THREE.MeshStandardMaterial({
    color: tune.accent, roughness: 0.5,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: tune.sniff, emissiveIntensity: 0.7,
  });

  if (kind === "cat") {
    // Body: rounded box. Head: sphere with two ear cones. Tail: tapered cone.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.7), bodyMat);
    body.position.y = 0.22; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), bodyMat);
    head.position.set(0, 0.36, 0.34); head.castShadow = true; g.add(head);
    for (const x of [-0.1, 0.1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), bodyMat);
      ear.position.set(x, 0.55, 0.32); g.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.42, 8), bodyMat);
    tail.position.set(0, 0.34, -0.42); tail.rotation.x = Math.PI * 0.45; g.add(tail);
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
      eye.position.set(x, 0.4, 0.52); g.add(eye);
    }
  } else if (kind === "dog") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.85), bodyMat);
    body.position.y = 0.28; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.4), bodyMat);
    head.position.set(0, 0.42, 0.55); head.castShadow = true; g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), accMat);
    snout.position.set(0, 0.34, 0.78); g.add(snout);
    for (const x of [-0.13, 0.13]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.12), bodyMat);
      ear.position.set(x, 0.58, 0.5); g.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.4, 8), bodyMat);
    tail.position.set(0, 0.48, -0.48); tail.rotation.x = -Math.PI * 0.3; g.add(tail);
    for (const x of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
      eye.position.set(x, 0.5, 0.74); g.add(eye);
    }
  } else if (kind === "hamster") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), bodyMat);
    body.position.y = 0.32; body.castShadow = true; g.add(body);
    for (const x of [-0.12, 0.12]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bodyMat);
      ear.position.set(x, 0.55, 0.06); g.add(ear);
    }
    for (const x of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
      eye.position.set(x, 0.36, 0.27); g.add(eye);
    }
  } else if (kind === "parrot") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), bodyMat);
    body.position.y = 0.0; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), accMat);
    head.position.set(0, 0.16, 0.22); g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd84d, roughness: 0.4 }));
    beak.position.set(0, 0.12, 0.4); beak.rotation.x = Math.PI / 2; g.add(beak);
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), eyeMat);
      eye.position.set(x, 0.18, 0.36); g.add(eye);
    }
    // Wings
    const wingMat = new THREE.MeshStandardMaterial({ color: tune.accent, roughness: 0.4 });
    const wingGeo = new THREE.BoxGeometry(0.04, 0.16, 0.34);
    for (const x of [-0.28, 0.28]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(x, 0.05, 0);
      g.add(w);
    }
    g.userData.wings = g.children.filter((c) => c.geometry === wingGeo);
    // Levitate.
    g.position.y = 1.0;
  }

  return g;
}

export class Pet {
  constructor(kind, world, cell, difficulty = 1) {
    this.kind = kind;
    this.world = world;
    this.tune = PET_TUNING[kind];
    this.mesh = buildPetMesh(kind);
    this.cell = { ...cell };
    const w = world.cellToWorld(cell.c, cell.r);
    this.mesh.position.x = w.x;
    this.mesh.position.z = w.z;
    if (kind !== "parrot") this.mesh.position.y = 0;
    world.group.add(this.mesh);

    this.dir = pickRandom(DIRS);
    this.target = { ...this.cell };
    this.speed = this.tune.speed * difficulty;
    this.alive = true;
    this.kickback = 0;
    this.watchTimer = 0;
    this.bobPhase = Math.random() * Math.PI * 2;
  }

  // Walls list passed in so a parrot can ignore.
  _isPassable(c, r) {
    if (this.kind === "parrot") {
      if (c < 0 || r < 0 || c >= this.world.cols || r >= this.world.rows) return false;
      return true;
    }
    return !this.world.isSolid(c, r);
  }

  _pickDirection(players) {
    const me = this.cell;
    const candidates = DIRS.filter((d) => this._isPassable(me.c + d.c, me.r + d.r));
    if (candidates.length === 0) return null;

    const tune = this.tune;
    if (this.kind === "cat") {
      if (Math.random() < tune.watchChance) {
        this.watchTimer = 0.6 + Math.random() * 0.6;
      }
      const p = nearestPlayer(players, me, this.world);
      if (p) {
        candidates.sort((a, b) =>
          dist(me.c + a.c, me.r + a.r, p.cell.c, p.cell.r) -
          dist(me.c + b.c, me.r + b.r, p.cell.c, p.cell.r)
        );
        return Math.random() < 0.85 ? candidates[0] : pickRandom(candidates);
      }
    } else if (this.kind === "dog") {
      // Continue same direction if possible.
      if (this.dir && this._isPassable(me.c + this.dir.c, me.r + this.dir.r)
          && Math.random() < tune.persistence) {
        return this.dir;
      }
      const p = nearestPlayer(players, me, this.world);
      if (p) {
        candidates.sort((a, b) =>
          dist(me.c + a.c, me.r + a.r, p.cell.c, p.cell.r) -
          dist(me.c + b.c, me.r + b.r, p.cell.c, p.cell.r)
        );
        return candidates[0];
      }
    } else if (this.kind === "hamster") {
      // Mostly random; sometimes head toward a player.
      if (Math.random() > tune.randomness) {
        const p = nearestPlayer(players, me, this.world);
        if (p) {
          candidates.sort((a, b) =>
            dist(me.c + a.c, me.r + a.r, p.cell.c, p.cell.r) -
            dist(me.c + b.c, me.r + b.r, p.cell.c, p.cell.r)
          );
          return candidates[0];
        }
      }
      // No 180s if alternative exists.
      const noBack = candidates.filter((d) =>
        !(this.dir && d.c === -this.dir.c && d.r === -this.dir.r)
      );
      return pickRandom(noBack.length ? noBack : candidates);
    } else if (this.kind === "parrot") {
      // Beeline toward nearest player, ignoring walls.
      const p = nearestPlayer(players, me, this.world);
      if (p) {
        const dc = Math.sign(p.cell.c - me.c);
        const dr = Math.sign(p.cell.r - me.r);
        if (Math.abs(p.cell.c - me.c) > Math.abs(p.cell.r - me.r)) {
          return dc !== 0 ? { c: dc, r: 0 } : { c: 0, r: dr };
        }
        return dr !== 0 ? { c: 0, r: dr } : { c: dc, r: 0 };
      }
    }
    return pickRandom(candidates);
  }

  update(dt, players) {
    if (!this.alive) return;

    if (this.watchTimer > 0) {
      this.watchTimer -= dt;
      // little tail/ear twitch
      this.mesh.rotation.y += Math.sin(performance.now() * 0.01) * 0.005;
      return;
    }

    if (this.kickback > 0) this.kickback -= dt;

    // Move toward target cell centre.
    const t = this.world.cellToWorld(this.target.c, this.target.r);
    const dx = t.x - this.mesh.position.x;
    const dz = t.z - this.mesh.position.z;
    const dist2 = Math.hypot(dx, dz);

    const speed = this.kickback > 0 ? this.speed * 0.4 : this.speed;
    const step = speed * dt;

    if (dist2 <= step + 0.001) {
      this.mesh.position.x = t.x;
      this.mesh.position.z = t.z;
      this.cell = { ...this.target };
      const dir = this._pickDirection(players);
      if (dir) {
        const nc = this.cell.c + dir.c;
        const nr = this.cell.r + dir.r;
        if (this._isPassable(nc, nr)) {
          this.dir = dir;
          this.target = { c: nc, r: nr };
        } else {
          // stay; will retry next tick
          this.dir = pickRandom(DIRS);
        }
      }
    } else {
      this.mesh.position.x += (dx / dist2) * step;
      this.mesh.position.z += (dz / dist2) * step;
      // face direction
      const facing = Math.atan2(dx, dz);
      this.mesh.rotation.y = facing;
    }

    // Decorative bobbing.
    this.bobPhase += dt * 8;
    if (this.kind === "parrot") {
      this.mesh.position.y = 1.0 + Math.sin(this.bobPhase) * 0.1;
      // wing flap
      if (this.mesh.userData?.wings) {
        for (const w of this.mesh.userData.wings) {
          w.rotation.z = Math.sin(this.bobPhase * 1.5) * 0.5;
        }
      }
    } else if (this.kind === "hamster") {
      this.mesh.rotation.x += dt * 6; // rolls
    } else {
      this.mesh.position.y = 0 + Math.abs(Math.sin(this.bobPhase * 0.7)) * 0.04;
    }
  }

  hitByExplosion(x, z, radius) {
    const dx = this.mesh.position.x - x;
    const dz = this.mesh.position.z - z;
    if (dx * dx + dz * dz <= radius * radius) {
      this.kill();
      return true;
    }
    return false;
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    // Quick puff/scale out.
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 350);
      this.mesh.scale.setScalar(1 - t);
      this.mesh.rotation.y += 0.4;
      if (t < 1) requestAnimationFrame(tick);
      else this.world.group.remove(this.mesh);
    };
    tick();
  }

  stunPlayer(playerPos) {
    const dx = this.mesh.position.x - playerPos.x;
    const dz = this.mesh.position.z - playerPos.z;
    return dx * dx + dz * dz <= 0.55 * 0.55;
  }
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function dist(c1, r1, c2, r2) {
  const dc = c1 - c2; const dr = r1 - r2;
  return Math.hypot(dc, dr);
}

function nearestPlayer(players, fromCell, world) {
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    if (!p.active || p.stealthUntil > performance.now() / 1000) continue;
    const cell = world.worldToCell(p.position.x, p.position.z);
    const d = dist(cell.c, cell.r, fromCell.c, fromCell.r);
    if (d < bestD) { bestD = d; best = { player: p, cell }; }
  }
  return best;
}
