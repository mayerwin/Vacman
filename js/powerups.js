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

  // Per-kind iconic mesh.
  const iconGroup = new THREE.Group();
  if (kind === "speed") {
    // Stylised lightning bolt: two angled wedges.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff4a8, emissive: meta.color, emissiveIntensity: 1.4,
      metalness: 0.6, roughness: 0.2,
    });
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.3, 4),
      mat
    );
    top.position.set(0.04, 0.18, 0); top.rotation.z = -0.5;
    iconGroup.add(top);
    const bot = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.3, 4),
      mat
    );
    bot.position.set(-0.04, -0.18, 0); bot.rotation.z = -0.5 + Math.PI;
    iconGroup.add(bot);
  } else if (kind === "turret") {
    // Mini turret: base cylinder + barrel.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a1010, metalness: 0.7, roughness: 0.4 })
    );
    iconGroup.add(base);
    const turret = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x4a1a1a, emissive: meta.color, emissiveIntensity: 0.4,
        metalness: 0.6, roughness: 0.4,
      })
    );
    turret.position.y = 0.06;
    iconGroup.add(turret);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.32, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.85, roughness: 0.25 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.12, 0.18);
    iconGroup.add(barrel);
  } else if (kind === "mine") {
    // Mini naval mine.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a223a, emissive: meta.color, emissiveIntensity: 0.55,
      metalness: 0.55, roughness: 0.45,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12), mat);
    iconGroup.add(body);
    const spikeGeo = new THREE.ConeGeometry(0.03, 0.09, 6);
    const dirs = [
      [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
      [0.7,0.7,0],[0.7,-0.7,0],[-0.7,0.7,0],[-0.7,-0.7,0],
    ];
    for (const d of dirs) {
      const s = new THREE.Mesh(spikeGeo, mat);
      const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      s.position.copy(dir.clone().multiplyScalar(0.21));
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      iconGroup.add(s);
    }
  } else if (kind === "bomb") {
    // Cartoon bomb with fuse.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 20, 14),
      new THREE.MeshStandardMaterial({
        color: 0x141420, emissive: meta.color, emissiveIntensity: 0.35,
        metalness: 0.8, roughness: 0.3,
      })
    );
    iconGroup.add(body);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.07, 12),
      new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.3 })
    );
    cap.position.y = 0.23;
    iconGroup.add(cap);
    const fuse = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a4a20, roughness: 0.7 })
    );
    fuse.rotation.z = -0.3;
    fuse.position.set(0.04, 0.32, 0);
    iconGroup.add(fuse);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffd84d, emissive: 0xff8c42, emissiveIntensity: 2.5,
      })
    );
    spark.position.set(0.075, 0.4, 0);
    iconGroup.add(spark);
  } else if (kind === "stealth") {
    // Translucent ghost shape.
    const ghost = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 18, 14),
      new THREE.MeshStandardMaterial({
        color: 0xa0e8ff,
        emissive: meta.color,
        emissiveIntensity: 0.7,
        transparent: true, opacity: 0.55,
        roughness: 0.2, metalness: 0.1,
      })
    );
    iconGroup.add(ghost);
    const skirt = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.2, 18, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xa0e8ff, transparent: true, opacity: 0.4,
        emissive: meta.color, emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
      })
    );
    skirt.position.y = -0.18;
    iconGroup.add(skirt);
    const eye1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.2 })
    );
    eye1.position.set(-0.07, 0.07, 0.18); iconGroup.add(eye1);
    const eye2 = eye1.clone(); eye2.position.x = 0.07; iconGroup.add(eye2);
  } else {
    // fallback: glowing cube
    iconGroup.add(new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2, 0),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: meta.color, emissiveIntensity: 1.3,
      })
    ));
  }
  iconGroup.position.y = 0.55;
  g.add(iconGroup);

  // Halo torus + ground glow stay the same.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.025, 12, 48),
    new THREE.MeshBasicMaterial({
      color: meta.color, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.5;
  g.add(halo);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 32),
    new THREE.MeshBasicMaterial({
      color: meta.color, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  g.add(glow);

  g.userData = { core: iconGroup, halo, glow, kind };
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
    this.mesh.userData.halo.rotation.z += dt * 1.5;
    this.mesh.userData.core.position.y = 0.55 + Math.sin(this.t * 2) * 0.1;
  }
  collect() {
    if (!this.alive) return false;
    this.alive = false;
    // Pop animation — scale up + fade out the whole group.
    const start = performance.now();
    const m = this.mesh;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 250);
      m.scale.setScalar(1 + t * 0.6);
      m.traverse((obj) => {
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            mat.transparent = true;
            mat.opacity = 1 - t;
          }
        }
      });
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

// Build a more recognisable mine / bomb mesh.
function buildMineMesh(kind) {
  const g = new THREE.Group();
  if (kind === "bomb") {
    // Cartoony cannonball with fuse: matte black sphere, copper fuse cap.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 24, 16),
      new THREE.MeshStandardMaterial({
        color: 0x0a0a10, roughness: 0.35, metalness: 0.6,
      })
    );
    body.position.y = 0.34;
    body.castShadow = true;
    g.add(body);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.3 })
    );
    cap.position.y = 0.7;
    g.add(cap);
    const fuse = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.18, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b3a16, roughness: 0.8 })
    );
    fuse.position.set(0.04, 0.85, 0);
    fuse.rotation.z = -0.3;
    g.add(fuse);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffd84d, emissive: 0xff8c42, emissiveIntensity: 2.5,
      })
    );
    spark.position.set(0.075, 0.94, 0);
    g.add(spark);
    g.userData.spark = spark;
  } else {
    // Naval-mine spheroid with conical spikes.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 20, 14),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a2a, roughness: 0.45, metalness: 0.55,
      })
    );
    body.position.y = 0.26;
    body.castShadow = true;
    g.add(body);
    const spikeGeo = new THREE.ConeGeometry(0.04, 0.13, 8);
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0x32324a, roughness: 0.5, metalness: 0.5,
    });
    const dirs = [
      [0, 1, 0], [1, 0.4, 0], [-1, 0.4, 0], [0, 0.4, 1], [0, 0.4, -1],
      [0.7, 0.4, 0.7], [-0.7, 0.4, 0.7], [0.7, 0.4, -0.7], [-0.7, 0.4, -0.7],
    ];
    for (const d of dirs) {
      const s = new THREE.Mesh(spikeGeo, spikeMat);
      s.position.set(d[0] * 0.3, 0.26 + d[1] * 0.3, d[2] * 0.3);
      // Point cone outward.
      const tipDir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipDir);
      g.add(s);
    }
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: 0xff3d8b, emissiveIntensity: 1.6,
      })
    );
    led.position.set(0, 0.62, 0);
    g.add(led);
    g.userData.led = led;
  }
  return g;
}

export class Mine {
  constructor(world, x, z, ownerId, kind = "mine") {
    this.world = world;
    this.ownerId = ownerId;
    this.kind = kind;
    this.armed = false;
    this.armTimer = 0.6;        // others can trigger after 0.6s
    this.selfArmTimer = 1.6;    // owner can trigger after 1.6s
    this.alive = true;
    this.lastBeep = 0;
    this.colour = kind === "bomb" ? 0xff8c42 : 0xff3d8b;
    this.mesh = buildMineMesh(kind);
    this.mesh.position.set(x, 0, z);
    world.group.add(this.mesh);
    this.radius = kind === "bomb" ? 2.6 : 1.4;
  }
  update(dt) {
    if (!this.alive) return;
    if (this.armTimer > 0) {
      this.armTimer -= dt;
      if (this.armTimer <= 0) this.armed = true;
    }
    if (this.selfArmTimer > 0) this.selfArmTimer -= dt;
    // pulse / glow
    const t = performance.now() / 1000;
    const intensity = 1 + Math.sin(t * 8) * 0.5;
    if (this.mesh.userData.led) this.mesh.userData.led.material.emissiveIntensity = intensity;
    if (this.mesh.userData.spark) {
      this.mesh.userData.spark.scale.setScalar(0.85 + Math.sin(t * 22) * 0.25);
    }
  }
  triggers(pos, isOwner = false) {
    if (!this.armed) return false;
    if (isOwner && this.selfArmTimer > 0) return false;
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
