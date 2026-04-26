// Builds the playable room from a Level definition. Owns:
//   - the floor and walls
//   - dirt particles (collectible)
//   - powerup pickups
//   - the locked door (and its open state)
//   - grid collision queries
//
// World coordinates: (x, z) in metres. Cell (col, row) → world via cellToWorld().

import * as THREE from "three";

export const CELL_SIZE = 1.0;
export const WALL_HEIGHT = 1.6;
export const FURN_HEIGHT = 0.7;

const FLOOR_PALETTES = {
  wood:     { base: 0x6b4a2e, accent: 0x4a3220, line: 0x2a1b10 },
  tile:     { base: 0xe8e8f0, accent: 0xc8c8d4, line: 0x9a9aaa },
  carpet:   { base: 0x402a55, accent: 0x32214a, line: 0x281840 },
  concrete: { base: 0x4a4a52, accent: 0x3a3a44, line: 0x2a2a30 },
  dock:     { base: 0x102220, accent: 0x0a1a18, line: 0x00ffc6 },
};

function makeFloorMaterial(kind) {
  const pal = FLOOR_PALETTES[kind] ?? FLOOR_PALETTES.wood;
  // Procedural canvas texture so floors have visual character.
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");

  // base
  g.fillStyle = "#" + pal.base.toString(16).padStart(6, "0");
  g.fillRect(0, 0, 256, 256);

  if (kind === "wood") {
    // Plank stripes with subtle grain noise.
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = "#" + pal.accent.toString(16).padStart(6, "0");
      g.globalAlpha = 0.35;
      g.fillRect(0, y, 256, 1);
      g.globalAlpha = 0.18;
      for (let x = 0; x < 256; x += 4) {
        g.fillStyle = `rgba(${(pal.line >> 16) & 255},${(pal.line >> 8) & 255},${pal.line & 255},${Math.random() * 0.18})`;
        g.fillRect(x, y + 1, 4, 30);
      }
    }
  } else if (kind === "tile") {
    g.strokeStyle = "#" + pal.line.toString(16).padStart(6, "0");
    g.globalAlpha = 0.45;
    g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
  } else if (kind === "carpet") {
    // Soft noise.
    g.globalAlpha = 0.5;
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.fillStyle = `rgba(${(pal.accent >> 16) & 255},${(pal.accent >> 8) & 255},${pal.accent & 255},${Math.random() * 0.4})`;
      g.fillRect(x, y, 1.5, 1.5);
    }
  } else if (kind === "concrete") {
    g.globalAlpha = 0.6;
    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.fillStyle = Math.random() > 0.5
        ? `rgba(255,255,255,${Math.random() * 0.06})`
        : `rgba(0,0,0,${Math.random() * 0.18})`;
      g.fillRect(x, y, 2, 2);
    }
  } else if (kind === "dock") {
    g.fillStyle = "#" + pal.accent.toString(16).padStart(6, "0");
    g.globalAlpha = 0.6;
    g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 1;
    g.strokeStyle = "#" + pal.line.toString(16).padStart(6, "0");
    g.lineWidth = 2;
    g.beginPath();
    g.arc(128, 128, 80, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(128, 128, 50, 0, Math.PI * 2);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: kind === "tile" ? 0.4 : kind === "concrete" ? 0.85 : 0.7,
    metalness: kind === "tile" ? 0.05 : 0,
  });
}

export class World {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.group = new THREE.Group();
    this.group.name = `world_${level.id}`;
    scene.add(this.group);

    // Parse map. Some rows may be ragged in the source — pad them out.
    const rawRows = level.map;
    const cols = Math.max(...rawRows.map((r) => r.length));
    const rows = rawRows.map((r) => r.padEnd(cols, "#"));
    this.cols = cols;
    this.rows = rows.length;
    this.cells = rows;

    // Centre the level around origin.
    this.originX = -(cols * CELL_SIZE) / 2;
    this.originZ = -(rows.length * CELL_SIZE) / 2;

    // collision grid: 0 = passable, 1 = wall, 2 = furniture, 3 = door (locked)
    this.grid = Array.from({ length: rows.length }, () => new Uint8Array(cols));

    this.spawns = [];
    this.petSpawns = [];
    this.dirt = []; // [{ mesh, alive, cell }]
    this.powerupSlots = []; // candidate cells where powerups can spawn
    this.doorMeshes = [];
    this.dockCell = null;

    this._build();
  }

  cellToWorld(c, r) {
    return {
      x: this.originX + (c + 0.5) * CELL_SIZE,
      z: this.originZ + (r + 0.5) * CELL_SIZE,
    };
  }

  worldToCell(x, z) {
    const c = Math.floor((x - this.originX) / CELL_SIZE);
    const r = Math.floor((z - this.originZ) / CELL_SIZE);
    return { c, r };
  }

  _build() {
    // Atmospheric backdrop: a large dim plane well beyond the playable area
    // so the camera never sees the empty fog-coloured void.
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({
        color: 0x040408,
        roughness: 0.9,
      })
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.set(
      this.originX + (this.cols * CELL_SIZE) / 2,
      -0.05,
      this.originZ + (this.rows * CELL_SIZE) / 2
    );
    backdrop.receiveShadow = true;
    this.group.add(backdrop);

    // Subtle neon perimeter trim — a thin glowing rectangle around the
    // outside of the playable area. Adds an "arcade stage" feel without
    // blocking the view.
    const rimColor = (this.level.mood?.fill ?? 0x00ffc6);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: rimColor,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    });
    const cx = this.originX + (this.cols * CELL_SIZE) / 2;
    const cz = this.originZ + (this.rows * CELL_SIZE) / 2;
    const halfW = (this.cols * CELL_SIZE) / 2 + 0.6;
    const halfD = (this.rows * CELL_SIZE) / 2 + 0.6;
    const rimGeoH = new THREE.BoxGeometry(halfW * 2, 0.06, 0.08);
    const rimGeoV = new THREE.BoxGeometry(0.08, 0.06, halfD * 2);
    const r1 = new THREE.Mesh(rimGeoH, rimMat); r1.position.set(cx, 0.04, cz - halfD); this.group.add(r1);
    const r2 = new THREE.Mesh(rimGeoH, rimMat); r2.position.set(cx, 0.04, cz + halfD); this.group.add(r2);
    const r3 = new THREE.Mesh(rimGeoV, rimMat); r3.position.set(cx - halfW, 0.04, cz); this.group.add(r3);
    const r4 = new THREE.Mesh(rimGeoV, rimMat); r4.position.set(cx + halfW, 0.04, cz); this.group.add(r4);

    // Outer "decorative" rim plane so the room appears to sit on a stage.
    const stageRadius = Math.max(this.cols, this.rows) * 0.85;
    const stage = new THREE.Mesh(
      new THREE.CircleGeometry(stageRadius, 96),
      new THREE.MeshStandardMaterial({
        color: 0x0a0a16,
        roughness: 0.6,
        metalness: 0.1,
      })
    );
    stage.rotation.x = -Math.PI / 2;
    stage.position.set(
      this.originX + (this.cols * CELL_SIZE) / 2,
      -0.025,
      this.originZ + (this.rows * CELL_SIZE) / 2
    );
    this.group.add(stage);

    // Floor: one big plane covers the whole bounds + a slight border.
    const floorMat = makeFloorMaterial(this.level.floor);
    floorMat.map.repeat.set(this.cols / 4, this.rows / 4);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.cols * CELL_SIZE + 4, this.rows * CELL_SIZE + 4),
      floorMat
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(
      this.originX + (this.cols * CELL_SIZE) / 2,
      0,
      this.originZ + (this.rows * CELL_SIZE) / 2
    );
    floor.receiveShadow = true;
    this.group.add(floor);

    // Skirting / ambient grid lines on floor for guidance — extremely subtle.
    const gridHelper = new THREE.GridHelper(
      Math.max(this.cols, this.rows) * CELL_SIZE,
      Math.max(this.cols, this.rows),
      0x000000,
      0x000000
    );
    gridHelper.material.opacity = 0.06;
    gridHelper.material.transparent = true;
    gridHelper.position.set(
      this.originX + (this.cols * CELL_SIZE) / 2,
      0.005,
      this.originZ + (this.rows * CELL_SIZE) / 2
    );
    this.group.add(gridHelper);

    // Wall + furniture geometries (cached/instanced for perf).
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x12121e,
      roughness: 0.6,
      metalness: 0.1,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x00ffc6,
      emissive: 0x00ffc6,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    });
    // Per-room furniture palette so each room reads as a different space.
    const FURN = {
      wood:     { base: 0x6b4a2e, top: 0xa68250, topRoughness: 0.8 },   // living
      tile:     { base: 0xe6e6ec, top: 0xfff8e8, topRoughness: 0.4 },   // kitchen
      carpet:   { base: 0x3a2a4a, top: 0x6f4d8a, topRoughness: 0.95 },  // bedroom
      concrete: { base: 0x3a3a40, top: 0x4a4a52, topRoughness: 0.7 },   // garage
      dock:     { base: 0x1a2a28, top: 0x2a4a44, topRoughness: 0.5 },   // dock
    };
    const furn = FURN[this.level.floor] ?? FURN.wood;
    const furnBaseMat = new THREE.MeshStandardMaterial({
      color: furn.base, roughness: 0.55, metalness: 0.15,
    });
    const furnTopMat = new THREE.MeshStandardMaterial({
      color: furn.top, roughness: furn.topRoughness, metalness: 0.05,
    });

    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const trimGeo = new THREE.BoxGeometry(CELL_SIZE * 1.02, 0.05, CELL_SIZE * 1.02);
    const furnBaseGeo = new THREE.BoxGeometry(CELL_SIZE * 0.94, FURN_HEIGHT * 0.7, CELL_SIZE * 0.94);
    const furnTopGeo = new THREE.BoxGeometry(CELL_SIZE * 0.96, FURN_HEIGHT * 0.18, CELL_SIZE * 0.96);

    for (let r = 0; r < this.rows; r++) {
      const row = this.cells[r];
      for (let c = 0; c < this.cols; c++) {
        const ch = row[c];
        const w = this.cellToWorld(c, r);

        switch (ch) {
          case "#": {
            const m = new THREE.Mesh(wallGeo, wallMat);
            m.position.set(w.x, WALL_HEIGHT / 2, w.z);
            m.castShadow = true;
            m.receiveShadow = true;
            this.group.add(m);
            // Neon trim along outer edge — only on cells touching the floor below.
            if (r + 1 < this.rows && this.cells[r + 1][c] !== "#") {
              const t = new THREE.Mesh(trimGeo, trimMat);
              t.position.set(w.x, 0.025, w.z + CELL_SIZE * 0.5);
              this.group.add(t);
            }
            this.grid[r][c] = 1;
            break;
          }
          case "+": {
            // Two-tier furniture: a wood/metal base + a softer cushion or
            // counter top. Reads as a sofa segment / counter / bed-piece /
            // shelf depending on the room's palette.
            const baseHeight = FURN_HEIGHT * 0.7;
            const f = new THREE.Mesh(furnBaseGeo, furnBaseMat);
            f.position.set(w.x, baseHeight / 2, w.z);
            f.castShadow = true; f.receiveShadow = true;
            this.group.add(f);
            const top = new THREE.Mesh(furnTopGeo, furnTopMat);
            top.position.set(w.x, baseHeight + (FURN_HEIGHT * 0.18) / 2 + 0.005, w.z);
            top.castShadow = true; top.receiveShadow = true;
            this.group.add(top);
            this.grid[r][c] = 2;
            break;
          }
          case "D": {
            // Door — visible bar across the gap.
            const door = new THREE.Mesh(
              new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT * 0.95, CELL_SIZE * 0.25),
              new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: 0xff3d8b,
                emissiveIntensity: 1.0,
                roughness: 0.3,
              })
            );
            door.position.set(w.x, WALL_HEIGHT * 0.475, w.z);
            this.group.add(door);
            this.doorMeshes.push(door);
            this.grid[r][c] = 3;
            this.dockCell = { c, r };
            break;
          }
          case ".": {
            this.grid[r][c] = 0;
            this._spawnDirt(c, r);
            this.powerupSlots.push({ c, r });
            break;
          }
          case "S": {
            this.grid[r][c] = 0;
            this.spawns.push({ c, r });
            break;
          }
          case "P": {
            this.grid[r][c] = 0;
            this.petSpawns.push({ c, r });
            break;
          }
          case "O": {
            // 'O' (capital o) used in dock for cosmetic charging pad cells.
            this.grid[r][c] = 0;
            break;
          }
          case " ":
          case "o": {
            this.grid[r][c] = 0;
            break;
          }
          default: {
            // Unknown chars (e.g. the literal "DOCK" label) — treat as floor.
            this.grid[r][c] = 0;
          }
        }
      }
    }

    // Final-room: drop a charging dock decoration in the middle.
    if (this.level.isFinal) {
      this._buildDock();
    }

    // Decorative props: a ceiling lamp casting a warm pool of light, plus a
    // potted plant or two in the corners. Don't block movement.
    this._buildAmbientProps();

    // Always spawn at least one player spawn.
    if (this.spawns.length === 0) {
      this.spawns.push({ c: Math.floor(this.cols / 2), r: Math.floor(this.rows / 2) });
    }
  }

  _spawnDirt(c, r) {
    const w = this.cellToWorld(c, r);
    // Small tetrahedral dust bunny with neon emissive.
    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x666660,
      emissive: 0xffd84d,
      emissiveIntensity: 0.8,
      roughness: 0.6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(w.x, 0.18, w.z);
    mesh.userData = {
      spin: (Math.random() - 0.5) * 4,
      bobOffset: Math.random() * Math.PI * 2,
    };
    this.group.add(mesh);
    this.dirt.push({ mesh, alive: true, cell: { c, r } });
  }

  _buildDock() {
    const cx = this.originX + (this.cols * CELL_SIZE) / 2;
    const cz = this.originZ + (this.rows * CELL_SIZE) / 2;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.12, 64),
      new THREE.MeshStandardMaterial({
        color: 0x080808,
        emissive: 0x00ffc6,
        emissiveIntensity: 0.4,
        roughness: 0.4,
      })
    );
    base.position.set(cx, 0.06, cz);
    base.receiveShadow = true;
    this.group.add(base);

    // Animated ring (we'll spin in update())
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.06, 16, 64),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xff3d8b,
        emissiveIntensity: 1.5,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, 0.18, cz);
    this.group.add(ring);
    this.dockCenter = { x: cx, z: cz };
    this.dockRing = ring;

    // A point light over the dock for warmth.
    const light = new THREE.PointLight(0x00ffc6, 1.5, 14, 2);
    light.position.set(cx, 4, cz);
    this.group.add(light);
  }

  _buildAmbientProps() {
    const cx = this.originX + (this.cols * CELL_SIZE) / 2;
    const cz = this.originZ + (this.rows * CELL_SIZE) / 2;
    // Ceiling lamp above the room — a small pendant + warm point light.
    if (!this.level.isFinal) {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x101014 })
      );
      cord.position.set(cx, 3.0, cz);
      this.group.add(cord);
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 0.3, 24, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x2a2a36, side: THREE.DoubleSide,
          roughness: 0.4, metalness: 0.6,
        })
      );
      shade.position.set(cx, 2.4, cz);
      this.group.add(shade);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 12),
        new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0xffd9a8, emissiveIntensity: 1.6,
        })
      );
      bulb.position.set(cx, 2.32, cz);
      this.group.add(bulb);
      const lamp = new THREE.PointLight(0xffd9a8, 1.4, 16, 2.0);
      lamp.position.set(cx, 2.3, cz);
      this.group.add(lamp);
    }

    // Find a few empty floor cells near the corners and drop a plant there.
    const plantCount = this.level.isFinal ? 0 : 2;
    const corners = [
      { c: 2, r: 2 },
      { c: this.cols - 3, r: 2 },
      { c: 2, r: this.rows - 3 },
      { c: this.cols - 3, r: this.rows - 3 },
    ];
    let placed = 0;
    for (const corner of corners) {
      if (placed >= plantCount) break;
      if (this.grid[corner.r] && this.grid[corner.r][corner.c] === 0) {
        const w = this.cellToWorld(corner.c, corner.r);
        this._spawnPlant(w.x, w.z);
        placed++;
      }
    }
  }

  _spawnPlant(x, z) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.16, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a4a20, roughness: 0.7 })
    );
    pot.position.y = 0.09;
    pot.castShadow = true; pot.receiveShadow = true;
    g.add(pot);
    // A few leafy cones forming foliage.
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x3a8a4a, roughness: 0.6,
    });
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.34, 6),
        leafMat
      );
      const ang = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(ang) * 0.06, 0.36, Math.sin(ang) * 0.06);
      leaf.rotation.z = Math.cos(ang) * 0.4;
      leaf.rotation.x = Math.sin(ang) * 0.4;
      leaf.castShadow = true;
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    // remove dirt that would otherwise be underneath
    this.dirt = this.dirt.filter((d) => {
      const dx = d.mesh.position.x - x;
      const dz = d.mesh.position.z - z;
      if (dx * dx + dz * dz < 0.36) { d.alive = false; d.mesh.visible = false; return false; }
      return true;
    });
    this.group.add(g);
  }

  isPassable(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    const v = this.grid[r][c];
    return v === 0 || v === 3 && this.doorOpen;
  }

  // Wall-only test (door always blocking even when open we still allow movement through it).
  isWall(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return true;
    const v = this.grid[r][c];
    return v === 1 || v === 2;
  }

  // Treat everything except open paths and (open) doors as solid.
  isSolid(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return true;
    const v = this.grid[r][c];
    if (v === 1 || v === 2) return true;
    if (v === 3 && !this.doorOpen) return true;
    return false;
  }

  collectDirt(x, z, radius = 0.45) {
    let collected = 0;
    for (const d of this.dirt) {
      if (!d.alive) continue;
      const dx = d.mesh.position.x - x;
      const dz = d.mesh.position.z - z;
      if (dx * dx + dz * dz <= radius * radius) {
        d.alive = false;
        d.mesh.visible = false;
        collected++;
      }
    }
    return collected;
  }

  remainingDirt() { return this.dirt.filter((d) => d.alive).length; }
  totalDirt() { return this.dirt.length; }
  progress() { return this.totalDirt() === 0 ? 1 : 1 - this.remainingDirt() / this.totalDirt(); }

  openDoor() {
    if (this.doorOpen) return;
    this.doorOpen = true;
    for (const d of this.doorMeshes) {
      d.material.emissive.setHex(0x00ffc6);
      d.material.color.setHex(0x00ffc6);
      // animate the door sliding down
      const start = performance.now();
      const startY = d.position.y;
      const targetY = -WALL_HEIGHT;
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / 600);
        d.position.y = startY + (targetY - startY) * t;
        if (t < 1) requestAnimationFrame(tick);
      };
      tick();
    }
  }

  update(dt, t) {
    for (const d of this.dirt) {
      if (!d.alive) continue;
      d.mesh.rotation.y += d.userData?.spin * dt || dt * 1.2;
      d.mesh.position.y = 0.18 + Math.sin(t * 2 + (d.mesh.userData.bobOffset || 0)) * 0.04;
    }
    if (this.dockRing) this.dockRing.rotation.z += dt * 1.2;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}
