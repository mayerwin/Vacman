// Power-ups + projectiles + mines + explosions.
//
// Powerup pickups float above the floor. When picked up, the player gets one
// charge of the matching ability they can fire later with Space.

import * as THREE from "three";

export const POWERUP_KINDS = ["speed", "turret", "mine", "bomb", "stealth"];

const POWERUP_META = {
  speed:   { name: "Turbo",       icon: "⚡", color: 0xffd84d },
  turret:  { name: "Turret",      icon: "🔫", color: 0xff6b6b },
  mine:    { name: "Mine",        icon: "💣", color: 0xb388ff },
  bomb:    { name: "Big bomb",    icon: "💥", color: 0xff8c42 },
  stealth: { name: "Stealth",     icon: "🤫", color: 0x38bdf8 },
};

export function powerupMeta(kind) { return POWERUP_META[kind]; }

function buildPickupMesh(kind) {
  const meta = POWERUP_META[kind];
  const g = new THREE.Group();
  // Floating geo: octahedron core + thin halo torus.
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28, 0),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: meta.color,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.4,
    })
  );
  core.position.y = 0.5;
  g.add(core);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.025, 12, 48),
    new THREE.MeshBasicMaterial({
      color: meta.color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.5;
  g.add(halo);
  // Ground glow sprite.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 32),
    new THREE.MeshBasicMaterial({
      color: meta.color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  g.add(glow);

  g.userData = { core, halo, glow, kind };
  return g;
}

export class PowerupPickup {
  constructor(world, cell, kind) {
    this.world = world;
    this.cell = { ...cell };
    this.kind = kind;
    this.mesh = buildPickupMesh(kind);
    const w = world.cellToWorld(cell.c, cell.r);
    this.mesh.position.set(w.x, 0, w.z);
    world.group.add(this.mesh);
    this.alive = true;
    this.t = 0;
  }
  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    this.mesh.userData.core.rotation.y += dt * 1.2;
    this.mesh.userData.core.rotation.x += dt * 0.7;
    this.mesh.userData.halo.rotation.z += dt * 1.5;
    this.mesh.userData.core.position.y = 0.5 + Math.sin(this.t * 2) * 0.1;
  }
  collect() {
    if (!this.alive) return false;
    this.alive = false;
    // Pop animation
    const start = performance.now();
    const m = this.mesh;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 250);
      m.scale.setScalar(1 + t * 0.5);
      m.userData.core.material.opacity = 1 - t;
      m.userData.core.material.transparent = true;
      if (t < 1) requestAnimationFrame(tick);
      else this.world.group.remove(m);
    };
    tick();
    return true;
  }
  dispose() {
    this.alive = false;
    this.world.group.remove(this.mesh);
  }
}

// --------- Bullets (turret + handheld fire) ---------

export class Bullet {
  constructor(world, x, z, dirX, dirZ, ownerId) {
    this.world = world;
    this.ownerId = ownerId;
    this.dirX = dirX; this.dirZ = dirZ;
    this.speed = 12;
    this.life = 1.4;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: 0xffd84d, emissiveIntensity: 2.5,
      })
    );
    this.mesh.position.set(x, 0.4, z);
    world.group.add(this.mesh);
    this.alive = true;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.kill(); return; }
    this.mesh.position.x += this.dirX * this.speed * dt;
    this.mesh.position.z += this.dirZ * this.speed * dt;
    // wall test
    const cell = this.world.worldToCell(this.mesh.position.x, this.mesh.position.z);
    if (this.world.isWall(cell.c, cell.r)) this.kill();
  }
  hits(pet) {
    const dx = pet.mesh.position.x - this.mesh.position.x;
    const dz = pet.mesh.position.z - this.mesh.position.z;
    return dx * dx + dz * dz <= 0.36;
  }
  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.world.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --------- Mines / bombs (stationary, explode on contact) ---------

export class Mine {
  constructor(world, x, z, ownerId, kind = "mine") {
    this.world = world;
    this.ownerId = ownerId;
    this.kind = kind;
    this.armed = false;
    this.armTimer = 0.6; // brief delay so you don't blow yourself up
    this.alive = true;
    const colour = kind === "bomb" ? 0xff8c42 : 0xb388ff;
    const radius = kind === "bomb" ? 0.32 : 0.22;
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x12121a, roughness: 0.4, metalness: 0.5 })
    );
    body.position.y = radius;
    this.mesh.add(body);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.3, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: colour, emissiveIntensity: 1.2,
      })
    );
    led.position.set(0, radius * 1.6, 0);
    this.mesh.add(led);
    this.led = led;
    this.mesh.position.set(x, 0, z);
    world.group.add(this.mesh);
    this.colour = colour;
    this.radius = kind === "bomb" ? 2.6 : 1.4;
  }
  update(dt) {
    if (!this.alive) return;
    if (this.armTimer > 0) {
      this.armTimer -= dt;
      if (this.armTimer <= 0) this.armed = true;
    }
    // pulse
    const t = performance.now() / 1000;
    this.led.material.emissiveIntensity = 1 + Math.sin(t * 8) * 0.5;
  }
  triggers(pos) {
    if (!this.armed) return false;
    const dx = this.mesh.position.x - pos.x;
    const dz = this.mesh.position.z - pos.z;
    return dx * dx + dz * dz <= 0.55 * 0.55;
  }
  detonate(world, pets, players) {
    if (!this.alive) return [];
    this.alive = false;
    const x = this.mesh.position.x;
    const z = this.mesh.position.z;
    spawnExplosion(world, x, z, this.radius, this.colour);
    world.group.remove(this.mesh);
    const killed = [];
    for (const pet of pets) {
      if (pet.alive && pet.hitByExplosion(x, z, this.radius)) killed.push(pet);
    }
    // Stun players caught in the blast (except owner).
    for (const p of players) {
      if (p.id === this.ownerId) continue;
      const dx = p.position.x - x;
      const dz = p.position.z - z;
      if (dx * dx + dz * dz <= this.radius * this.radius) {
        p.stunned = Math.max(p.stunned || 0, 1.2);
      }
    }
    return killed;
  }
}

function spawnExplosion(world, x, z, radius, color = 0xff8c42) {
  // Expanding ring + flash.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.1, 48),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  world.group.add(ring);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 16, 12),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending,
    })
  );
  flash.position.set(x, 0.4, z);
  world.group.add(flash);

  const start = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / 500);
    const r = 0.1 + (radius - 0.1) * t;
    ring.scale.setScalar(r * 10);
    ring.material.opacity = 1 - t;
    flash.scale.setScalar(1 + t * 6);
    flash.material.opacity = 0.9 * (1 - t);
    if (t < 1) requestAnimationFrame(tick);
    else {
      world.group.remove(ring); world.group.remove(flash);
      ring.geometry.dispose(); ring.material.dispose();
      flash.geometry.dispose(); flash.material.dispose();
    }
  };
  tick();
}
