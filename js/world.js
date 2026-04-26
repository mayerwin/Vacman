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

// Per-room wall paint colour + a touch of grain so it doesn't look flat.
function makeWallTexture(kind) {
  const PAL = {
    wood:     { base: "#3a2e2e", grain: "#1a1a26" }, // living: warm taupe
    tile:     { base: "#dde4ec", grain: "#a8b3c0" }, // kitchen: pale blue/grey
    carpet:   { base: "#322048", grain: "#1d1230" }, // bedroom: deep violet
    concrete: { base: "#3c3c44", grain: "#222226" }, // garage: industrial
    dock:     { base: "#0e1a1a", grain: "#001a16" }, // dock: dark teal
  };
  const pal = PAL[kind] ?? PAL.wood;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = pal.base;
  g.fillRect(0, 0, 256, 256);
  // Subtle vertical streaks
  g.globalAlpha = 0.22;
  for (let i = 0; i < 30; i++) {
    g.fillStyle = pal.grain;
    g.fillRect(Math.random() * 256, 0, 0.6, 256);
  }
  // Speckle noise
  g.globalAlpha = 0.45;
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  // Dim the bottom and top edges for a subtle vignette
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "rgba(0,0,0,0.35)");
  grad.addColorStop(0.4, "rgba(0,0,0,0)");
  grad.addColorStop(0.8, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.25)");
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
    this.pushables = []; // light furniture the player can shove around

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

    // Walls: per-room paint colour + subtle procedural noise + a contrast
    // baseboard + a faint neon trim line at the floor.
    const wallTex = makeWallTexture(this.level.floor);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.78,
      metalness: 0.03,
    });
    const baseboardMat = new THREE.MeshStandardMaterial({
      color: 0x16161e, roughness: 0.5,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x00ffc6,
      emissive: 0x00ffc6,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    });
    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const trimGeo = new THREE.BoxGeometry(CELL_SIZE * 1.02, 0.05, CELL_SIZE * 1.02);

    // Detect connected `+` regions BEFORE the per-cell loop so we can render
    // each region as a single coherent prop (sofa / kitchen island / bed /
    // bathtub / workbench), keyed off the room style.
    const furnRegions = this._findFurnitureRegions();
    for (const region of furnRegions) {
      this._buildFurniturePiece(region);
    }

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
            // Add a contrast baseboard on every face that touches floor.
            for (const [dc, dr, sx, sz, off] of [
              [ 1, 0, 0.06, CELL_SIZE * 0.96,  CELL_SIZE * 0.5],
              [-1, 0, 0.06, CELL_SIZE * 0.96, -CELL_SIZE * 0.5],
              [ 0, 1, CELL_SIZE * 0.96, 0.06,  CELL_SIZE * 0.5],
              [ 0,-1, CELL_SIZE * 0.96, 0.06, -CELL_SIZE * 0.5],
            ]) {
              const nc = c + dc, nr = r + dr;
              if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
              if (this.cells[nr][nc] === "#") continue;
              const baseboard = new THREE.Mesh(
                new THREE.BoxGeometry(sx, 0.18, sz), baseboardMat,
              );
              baseboard.position.set(
                w.x + (dc !== 0 ? dc * (CELL_SIZE * 0.5 - 0.03) : 0),
                0.09,
                w.z + (dr !== 0 ? dr * (CELL_SIZE * 0.5 - 0.03) : 0),
              );
              baseboard.receiveShadow = true;
              this.group.add(baseboard);
            }
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
            // Furniture meshes were built above as one piece per region.
            // Cell still marked solid for collision.
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
          case "c": {
            // Pushable lightweight furniture (a stool / waste bin / chair).
            // The grid slot stays passable for pets but tracks which cell
            // currently holds the pushable via `pushableAt()`.
            this.grid[r][c] = 0;
            this._spawnPushable(c, r);
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

    // Reachability check: floodfill from every player spawn and prune any
    // dirt that's trapped behind solid cells. Otherwise the level can be
    // impossible to clear.
    this._pruneUnreachableDirt();
  }

  _pruneUnreachableDirt() {
    const reachable = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
    const q = [];
    for (const s of this.spawns) {
      if (s.c >= 0 && s.r >= 0 && s.c < this.cols && s.r < this.rows && !reachable[s.r][s.c]) {
        reachable[s.r][s.c] = 1;
        q.push(s);
      }
    }
    while (q.length) {
      const cell = q.shift();
      for (const d of [{c:1,r:0},{c:-1,r:0},{c:0,r:1},{c:0,r:-1}]) {
        const nc = cell.c + d.c;
        const nr = cell.r + d.r;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        if (reachable[nr][nc]) continue;
        const v = this.grid[nr][nc];
        // Walls and furniture are blockers; doors will open later so treat
        // them as passable for reachability purposes.
        if (v === 1 || v === 2) continue;
        reachable[nr][nc] = 1;
        q.push({ c: nc, r: nr });
      }
    }
    let pruned = 0;
    for (const d of this.dirt) {
      if (!d.alive) continue;
      const { c, r } = d.cell;
      if (!reachable[r][c]) {
        d.alive = false;
        d.mesh.visible = false;
        pruned++;
      }
    }
    if (pruned > 0) {
      console.info(`[Vacman] level ${this.level.id}: pruned ${pruned} unreachable dirt`);
    }
  }

  _spawnDirt(c, r) {
    const w = this.cellToWorld(c, r);
    // 3 dirt flavours: dust bunny (fluffy spheres), hairball (a small
    // torus knot — looks like coiled hair), crumb (a flat disc). All
    // get a soft warm emissive so they're spottable from above.
    const flavour = Math.random();
    let mesh;
    if (flavour < 0.55) {
      // Dust bunny: cluster of tiny spheres.
      mesh = new THREE.Group();
      const fluffMat = new THREE.MeshStandardMaterial({
        color: 0x9b9685,
        emissive: 0xc8a04a,
        emissiveIntensity: 0.45,
        roughness: 0.95,
      });
      for (let i = 0; i < 4; i++) {
        const r1 = 0.06 + Math.random() * 0.05;
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(r1, 8, 6), fluffMat,
        );
        ball.position.set(
          (Math.random() - 0.5) * 0.16,
          r1 + Math.random() * 0.06,
          (Math.random() - 0.5) * 0.16,
        );
        mesh.add(ball);
      }
    } else if (flavour < 0.85) {
      // Crumb: flat disc with crisp emissive edge.
      const geo = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 12);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xb89058,
        emissive: 0xffb04a,
        emissiveIntensity: 0.55,
        roughness: 0.7,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = (Math.random() - 0.5) * 0.4;
      mesh.rotation.z = (Math.random() - 0.5) * 0.4;
    } else {
      // Hairball: small torus (coiled hair).
      const geo = new THREE.TorusGeometry(0.1, 0.025, 6, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a2018,
        emissive: 0x6a4a20,
        emissiveIntensity: 0.4,
        roughness: 0.9,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    }
    mesh.position.set(w.x, 0.13, w.z);
    mesh.userData = {
      spin: (Math.random() - 0.5) * 3,
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

    // Ceiling — a single plane just above wall height. Only visible in
    // first-person / chase camera (where the player actually looks up);
    // hidden in top-down so it doesn't occlude the room.
    if (!this.level.isFinal) {
      const ceilingMat = new THREE.MeshStandardMaterial({
        color: 0x18181f, roughness: 0.9, side: THREE.BackSide,
      });
      const ceiling = new THREE.Mesh(
        new THREE.PlaneGeometry(this.cols * CELL_SIZE, this.rows * CELL_SIZE),
        ceilingMat,
      );
      ceiling.rotation.x = -Math.PI / 2;
      ceiling.position.set(cx, WALL_HEIGHT + 0.01, cz);
      ceiling.visible = false;
      this.ceiling = ceiling;
      this.group.add(ceiling);
    }

    // Wall art / decorations along the perimeter walls. Different per
    // room style so first-person players see something interesting.
    this._buildWallArt();

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

  // ---------------- Furniture region detection + building ----------------

  _findFurnitureRegions() {
    const seen = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
    const isFurn = (c, r) => {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
      const ch = this.cells[r][c];
      // 'o' inside a + region acts as inner-floor of the furniture (e.g.
      // the seat space inside a sofa rectangle), so include it in the
      // region so the rendered prop covers it.
      return ch === "+" || ch === "o";
    };
    const isPlus = (c, r) => isFurn(c, r) && this.cells[r][c] === "+";
    const regions = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (seen[r][c] || !isPlus(c, r)) continue;
        // BFS over connected (+/o) cells reachable through +.
        const stack = [{ c, r }];
        const cells = [];
        let cmin = c, cmax = c, rmin = r, rmax = r;
        while (stack.length) {
          const cur = stack.pop();
          if (seen[cur.r][cur.c]) continue;
          if (!isFurn(cur.c, cur.r)) continue;
          // Don't expand THROUGH inner 'o' cells unless they touch a '+'.
          // Easier: include 'o' in the region but only walk if the cell
          // has a + neighbour (covered automatically for connected sofas).
          seen[cur.r][cur.c] = 1;
          cells.push({ c: cur.c, r: cur.r, ch: this.cells[cur.r][cur.c] });
          if (cur.c < cmin) cmin = cur.c;
          if (cur.c > cmax) cmax = cur.c;
          if (cur.r < rmin) rmin = cur.r;
          if (cur.r > rmax) rmax = cur.r;
          for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nc = cur.c + d[0], nr = cur.r + d[1];
            if (seen[nr]?.[nc]) continue;
            if (!isFurn(nc, nr)) continue;
            stack.push({ c: nc, r: nr });
          }
        }
        regions.push({
          cmin, cmax, rmin, rmax,
          width: cmax - cmin + 1,
          depth: rmax - rmin + 1,
          cells,
        });
      }
    }
    return regions;
  }

  _buildFurniturePiece(region) {
    const cx = this.originX + (region.cmin + region.cmax + 1) / 2 * CELL_SIZE;
    const cz = this.originZ + (region.rmin + region.rmax + 1) / 2 * CELL_SIZE;
    const w = region.width * CELL_SIZE;
    const d = region.depth * CELL_SIZE;
    const kind = this.level.floor;
    let prop;
    if (kind === "wood")          prop = buildLivingFurniture(w, d, region);
    else if (kind === "tile" && this.level.id === "kitchen")
                                   prop = buildKitchenIsland(w, d, region);
    else if (kind === "tile")     prop = buildBathtub(w, d, region);
    else if (kind === "carpet")   prop = buildBed(w, d, region);
    else if (kind === "concrete") prop = buildWorkbench(w, d, region);
    else                          prop = buildGenericTable(w, d, region);
    prop.position.set(cx, 0, cz);
    this.group.add(prop);
  }

  _spawnPushable(c, r) {
    const w = this.cellToWorld(c, r);
    // Per-room flavour: stool in living, trash bin in kitchen, hamper in
    // bedroom, laundry basket in bathroom, jerry-can in garage.
    const flavour = {
      wood:     { color: 0x6b4a2e, top: 0x8a6d4b, kind: "stool" },
      tile:     { color: 0x2a2a30, top: 0x44444a, kind: "bin" },
      carpet:   { color: 0x6f4d8a, top: 0x8a6db0, kind: "hamper" },
      concrete: { color: 0xc88838, top: 0xddaa5c, kind: "jerrycan" },
      dock:     { color: 0x2a4a44, top: 0x4a8e80, kind: "stool" },
    }[this.level.floor] || { color: 0x6b4a2e, top: 0x8a6d4b, kind: "stool" };
    const g = new THREE.Group();
    if (flavour.kind === "stool") {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.32, 0.06, 18),
        new THREE.MeshStandardMaterial({ color: flavour.top, roughness: 0.7 })
      );
      seat.position.y = 0.46;
      seat.castShadow = true;
      g.add(seat);
      const legMat = new THREE.MeshStandardMaterial({ color: flavour.color, roughness: 0.6 });
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 8), legMat);
        leg.position.set(dx, 0.23, dz);
        g.add(leg);
      }
    } else if (flavour.kind === "bin") {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.28, 0.55, 20),
        new THREE.MeshStandardMaterial({ color: flavour.color, roughness: 0.5, metalness: 0.4 })
      );
      body.position.y = 0.275;
      body.castShadow = true;
      g.add(body);
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20),
        new THREE.MeshStandardMaterial({ color: flavour.top, roughness: 0.4, metalness: 0.5 })
      );
      lid.position.y = 0.57;
      g.add(lid);
    } else if (flavour.kind === "hamper") {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.3, 0.55, 18),
        new THREE.MeshStandardMaterial({ color: flavour.color, roughness: 0.85 })
      );
      body.position.y = 0.275;
      body.castShadow = true;
      g.add(body);
      // wicker stripes (just decorative thin tori)
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.32, 0.012, 6, 24),
          new THREE.MeshStandardMaterial({ color: flavour.top, roughness: 0.7 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.12 + i * 0.16;
        g.add(ring);
      }
    } else if (flavour.kind === "jerrycan") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.55, 0.28),
        new THREE.MeshStandardMaterial({ color: flavour.color, roughness: 0.45, metalness: 0.4 })
      );
      body.position.y = 0.275;
      body.castShadow = true;
      g.add(body);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.6, roughness: 0.4 })
      );
      cap.position.set(0.12, 0.58, 0);
      g.add(cap);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.6, roughness: 0.4 })
      );
      handle.position.set(-0.18, 0.55, 0);
      handle.rotation.z = -Math.PI / 2;
      g.add(handle);
    }
    g.position.set(w.x, 0, w.z);
    this.group.add(g);

    const pushable = {
      cell: { c, r },
      mesh: g,
      target: { x: w.x, z: w.z },   // grid-aligned target for visual lerp
    };
    this.pushables.push(pushable);
    // Powerups shouldn't drop on top of a pushable.
    this.powerupSlots = this.powerupSlots.filter((s) => !(s.c === c && s.r === r));
  }

  // Toggle pieces of geometry that only make sense in certain camera modes.
  setCameraMode(mode) {
    if (this.ceiling) this.ceiling.visible = (mode !== "topdown");
  }

  pushableAt(c, r) {
    for (const p of this.pushables) {
      if (p.cell.c === c && p.cell.r === r) return p;
    }
    return null;
  }

  // Try to slide a pushable from its current cell by (dc, dr). Returns
  // true if it moved.
  tryPush(pushable, dc, dr) {
    const nc = pushable.cell.c + dc;
    const nr = pushable.cell.r + dr;
    if (this.isSolid(nc, nr)) return false;
    if (this.pushableAt(nc, nr)) return false;
    pushable.cell = { c: nc, r: nr };
    const w = this.cellToWorld(nc, nr);
    pushable.target.x = w.x;
    pushable.target.z = w.z;
    return true;
  }

  // Find a few inner-facing wall cells (cells with floor neighbour) and
  // attach a piece of art / appliance / sign appropriate to the room.
  _buildWallArt() {
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c] !== "#") continue;
        // Check each side for inner-facing floor.
        for (const [dc, dr, normal] of [
          [ 1, 0, [ 1, 0]],
          [-1, 0, [-1, 0]],
          [ 0, 1, [ 0, 1]],
          [ 0,-1, [ 0,-1]],
        ]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const ch = this.cells[nr][nc];
          if (ch === "#") continue;       // not facing inside
          candidates.push({ c, r, normal });
        }
      }
    }
    if (candidates.length === 0) return;
    // Pick a small handful spread out across the perimeter.
    const wantCount = Math.min(6, Math.max(3, Math.floor(candidates.length / 18)));
    const picks = [];
    const stride = Math.floor(candidates.length / wantCount);
    for (let i = 0; i < wantCount; i++) {
      picks.push(candidates[(i * stride) % candidates.length]);
    }
    for (const p of picks) {
      this._attachWallArt(p);
    }
  }

  _attachWallArt(spot) {
    const w = this.cellToWorld(spot.c, spot.r);
    const [nx, nz] = spot.normal;
    const offset = CELL_SIZE * 0.49;
    const x = w.x + nx * offset;
    const z = w.z + nz * offset;
    const yaw = Math.atan2(nx, nz);

    const kind = this.level.floor;
    let art;
    if (kind === "wood")          art = pickArt(["painting", "tv", "shelf"]);
    else if (kind === "tile" && this.level.id === "kitchen")
                                   art = pickArt(["clock", "calendar"]);
    else if (kind === "tile")     art = pickArt(["mirror", "towel"]);
    else if (kind === "carpet")   art = pickArt(["painting", "shelf"]);
    else if (kind === "concrete") art = pickArt(["calendar", "tools"]);
    else                          art = pickArt(["painting"]);

    const mesh = buildArtMesh(art);
    mesh.position.set(x, 1.05, z);
    mesh.rotation.y = yaw;
    this.group.add(mesh);
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

  // Like isSolid but also blocks on pushable furniture. Pets use this so
  // they don't walk through chairs.
  isBlockedForPet(c, r) {
    if (this.isSolid(c, r)) return true;
    if (this.pushableAt(c, r)) return true;
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
      d.mesh.rotation.y += (d.mesh.userData?.spin ?? 1.2) * dt;
      d.mesh.position.y = 0.13 + Math.sin(t * 2 + (d.mesh.userData?.bobOffset || 0)) * 0.03;
    }
    if (this.dockRing) this.dockRing.rotation.z += dt * 1.2;
    // Pushable furniture lerps toward its grid-aligned target so it slides
    // visibly when shoved. Also a tiny wobble for "knocked-over" feel.
    for (const p of this.pushables) {
      const dx = p.target.x - p.mesh.position.x;
      const dz = p.target.z - p.mesh.position.z;
      const k = Math.min(1, dt * 14);
      p.mesh.position.x += dx * k;
      p.mesh.position.z += dz * k;
      const wobble = Math.hypot(dx, dz);
      p.mesh.rotation.x = Math.sin(t * 16) * wobble * 0.3;
      p.mesh.rotation.z = Math.cos(t * 16) * wobble * 0.3;
    }
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

// =====================================================================
// Per-room furniture builders. Each takes the world-space bounding box
// (width, depth) and the region info, and returns a centred Three.js
// Group. They lean recognisable rather than photoreal — readable from
// 5m up while still feeling like a real piece of furniture.
// =====================================================================

function buildLivingFurniture(w, d, region) {
  const g = new THREE.Group();
  // Heuristic: very long & narrow → sofa; short & wide → coffee table; tall
  // narrow → TV stand / bookcase; otherwise armchair.
  const ratio = w / d;
  if (Math.max(w, d) >= 3 && Math.min(w, d) <= 1.5) {
    return buildSofa(w, d);
  }
  if (Math.min(w, d) >= 2 && Math.max(w, d) <= 3.2) {
    return buildCoffeeTable(w, d);
  }
  if ((w >= 4 && d <= 2) || (d >= 4 && w <= 2)) {
    return buildSofa(w, d);
  }
  return buildCoffeeTable(w, d);
}

function buildSofa(w, d) {
  const g = new THREE.Group();
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const orientLong = w >= d; // sofa runs along X if w wider
  const sx = orientLong ? long : short;
  const sz = orientLong ? short : long;

  const upholstery = new THREE.MeshStandardMaterial({
    color: 0x4a3a55, roughness: 0.85,
  });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2718, roughness: 0.7 });

  // Base
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 0.95, 0.3, sz * 0.95), upholstery,
  );
  base.position.y = 0.15;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  // Seat cushion (subdivided into N cushions along the long axis)
  const cushionMat = new THREE.MeshStandardMaterial({
    color: 0x6f4d8a, roughness: 0.9,
  });
  const cushions = Math.max(1, Math.round(long / 1.0));
  const cushW = (orientLong ? sx : sz) * 0.93 / cushions;
  for (let i = 0; i < cushions; i++) {
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(
        orientLong ? cushW * 0.92 : sx * 0.7,
        0.2,
        orientLong ? sz * 0.7 : cushW * 0.92,
      ),
      cushionMat,
    );
    const offset = -((cushions - 1) / 2 - i) * cushW;
    cushion.position.set(
      orientLong ? offset : 0,
      0.4,
      orientLong ? sz * 0.05 : offset,
    );
    cushion.castShadow = true;
    g.add(cushion);
  }
  // Backrest
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(
      orientLong ? sx * 0.95 : sx * 0.18,
      0.62,
      orientLong ? sz * 0.18 : sz * 0.95,
    ),
    upholstery,
  );
  back.position.set(
    orientLong ? 0 : -sx * 0.4,
    0.6,
    orientLong ? -sz * 0.4 : 0,
  );
  back.castShadow = true;
  g.add(back);
  // Two arms
  const armW = orientLong ? sx * 0.08 : sx * 0.92;
  const armD = orientLong ? sz * 0.92 : sz * 0.08;
  const armH = 0.5;
  const armA = new THREE.Mesh(new THREE.BoxGeometry(armW, armH, armD), upholstery);
  armA.position.set(
    orientLong ? -sx * 0.46 : 0,
    armH / 2 + 0.1,
    orientLong ? 0 : -sz * 0.46,
  );
  armA.castShadow = true;
  g.add(armA);
  const armB = armA.clone();
  armB.position.set(
    orientLong ? sx * 0.46 : 0,
    armH / 2 + 0.1,
    orientLong ? 0 : sz * 0.46,
  );
  g.add(armB);
  // Tiny wooden feet
  const footGeo = new THREE.BoxGeometry(0.08, 0.1, 0.08);
  for (const dx of [-sx * 0.4, sx * 0.4]) for (const dz of [-sz * 0.4, sz * 0.4]) {
    const f = new THREE.Mesh(footGeo, wood);
    f.position.set(dx, 0.05, dz);
    g.add(f);
  }
  return g;
}

function buildCoffeeTable(w, d) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6b4a2e, roughness: 0.5, metalness: 0.05,
  });
  const top = new THREE.MeshStandardMaterial({
    color: 0xa68250, roughness: 0.4, metalness: 0.05,
  });
  const tabletop = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.92, 0.06, d * 0.92), top,
  );
  tabletop.position.y = 0.45;
  tabletop.castShadow = true; tabletop.receiveShadow = true;
  g.add(tabletop);
  const legGeo = new THREE.BoxGeometry(0.1, 0.45, 0.1);
  for (const dx of [-w * 0.4, w * 0.4]) for (const dz of [-d * 0.4, d * 0.4]) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(dx, 0.225, dz);
    leg.castShadow = true;
    g.add(leg);
  }
  // A small stack of magazines / decor box on top.
  const deco = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.32, 0.04, d * 0.4),
    new THREE.MeshStandardMaterial({ color: 0xff8c42, roughness: 0.5 })
  );
  deco.position.set(w * 0.12, 0.5, -d * 0.05);
  g.add(deco);
  return g;
}

function buildKitchenIsland(w, d) {
  const g = new THREE.Group();
  const cabinet = new THREE.MeshStandardMaterial({
    color: 0xeeeae0, roughness: 0.55, metalness: 0.05,
  });
  const counter = new THREE.MeshStandardMaterial({
    color: 0x1d1d22, roughness: 0.25, metalness: 0.4,
  });
  // Cabinets
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.96, 0.78, d * 0.96), cabinet,
  );
  body.position.y = 0.39;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // Marble counter top with slight overhang
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.02, 0.06, d * 1.02), counter,
  );
  top.position.y = 0.81;
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  // Cabinet handles (thin horizontal bars on the long faces)
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0xcfcfd6, metalness: 0.85, roughness: 0.25,
  });
  const handleGeo = new THREE.BoxGeometry(0.18, 0.02, 0.02);
  const cellsAcross = Math.max(1, Math.round(w / 1));
  for (let i = 0; i < cellsAcross; i++) {
    const x = -w / 2 + (i + 0.5) * (w / cellsAcross);
    const h1 = new THREE.Mesh(handleGeo, handleMat);
    h1.position.set(x, 0.55, d * 0.495);
    g.add(h1);
    const h2 = h1.clone();
    h2.position.z = -d * 0.495;
    g.add(h2);
  }
  // A pair of bar-stools at the long edge if the island is wide enough.
  if (Math.max(w, d) >= 4) {
    const stoolMat = new THREE.MeshStandardMaterial({
      color: 0x222226, metalness: 0.5, roughness: 0.4,
    });
    for (const xs of [-w * 0.2, w * 0.2]) {
      const s = new THREE.Group();
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.16, 0.04, 16), stoolMat
      );
      seat.position.y = 0.72;
      s.add(seat);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.04, 0.7, 10), stoolMat
      );
      stem.position.y = 0.36;
      s.add(stem);
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.025, 16), stoolMat
      );
      foot.position.y = 0.012;
      s.add(foot);
      s.position.set(xs, 0, d * 0.7);
      g.add(s);
    }
  }
  return g;
}

function buildBed(w, d) {
  const g = new THREE.Group();
  const orientLong = d >= w;
  const sx = orientLong ? w : d;
  const sz = orientLong ? d : w;
  const frame = new THREE.MeshStandardMaterial({
    color: 0x3a2718, roughness: 0.55,
  });
  const sheet = new THREE.MeshStandardMaterial({
    color: 0xe9dfff, roughness: 0.85,
  });
  const blanket = new THREE.MeshStandardMaterial({
    color: 0xa088c8, roughness: 0.85,
  });
  const pillow = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95,
  });
  // Frame base
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 0.96, 0.3, sz * 0.96), frame,
  );
  base.position.y = 0.15;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  // Mattress
  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 0.92, 0.18, sz * 0.92), sheet,
  );
  mattress.position.y = 0.4;
  g.add(mattress);
  // Folded blanket covering the lower 60%
  const blanketMesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 0.92, 0.04, sz * 0.55), blanket,
  );
  blanketMesh.position.set(0, 0.51, sz * 0.18);
  g.add(blanketMesh);
  // Two pillows at the head
  const pw = sx * 0.42, pd = 0.22;
  const pa = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.08, pd), pillow);
  pa.position.set(-sx * 0.2, 0.5, -sz * 0.32);
  g.add(pa);
  const pb = pa.clone();
  pb.position.x = sx * 0.2;
  g.add(pb);
  // Headboard
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 0.96, 0.55, 0.08), frame,
  );
  head.position.set(0, 0.45, -sz * 0.48);
  head.castShadow = true;
  g.add(head);
  return g;
}

function buildBathtub(w, d) {
  const g = new THREE.Group();
  const porcelain = new THREE.MeshStandardMaterial({
    color: 0xfafafa, roughness: 0.2, metalness: 0.05,
  });
  const water = new THREE.MeshStandardMaterial({
    color: 0xa8e0ff, roughness: 0.1, metalness: 0.0,
    transparent: true, opacity: 0.55,
  });
  const tub = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.94, 0.5, d * 0.94), porcelain,
  );
  tub.position.y = 0.25;
  tub.castShadow = true; tub.receiveShadow = true;
  g.add(tub);
  // Inner cavity (slightly smaller box on top to look like a basin lip)
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.78, 0.04, d * 0.78),
    new THREE.MeshStandardMaterial({ color: 0xeaeaef, roughness: 0.3 })
  );
  inner.position.y = 0.5;
  g.add(inner);
  // Water surface
  const wg = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.74, 0.02, d * 0.74), water,
  );
  wg.position.y = 0.46;
  g.add(wg);
  // Tap/faucet at one end
  const tap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.85, roughness: 0.2 })
  );
  tap.position.set(-w * 0.42, 0.6, 0);
  tap.rotation.z = Math.PI / 2;
  g.add(tap);
  const spout = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.08, 10),
    new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.85, roughness: 0.2 })
  );
  spout.position.set(-w * 0.4, 0.55, 0);
  g.add(spout);
  return g;
}

function buildWorkbench(w, d) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x44444a, metalness: 0.6, roughness: 0.45,
  });
  const top = new THREE.MeshStandardMaterial({
    color: 0x6e553a, roughness: 0.7,
  });
  const tabletop = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.94, 0.08, d * 0.94), top,
  );
  tabletop.position.y = 0.78;
  tabletop.castShadow = true; tabletop.receiveShadow = true;
  g.add(tabletop);
  // Steel legs
  const legGeo = new THREE.BoxGeometry(0.08, 0.78, 0.08);
  for (const dx of [-w * 0.42, w * 0.42]) for (const dz of [-d * 0.42, d * 0.42]) {
    const leg = new THREE.Mesh(legGeo, metal);
    leg.position.set(dx, 0.39, dz);
    g.add(leg);
  }
  // A few "tools" scattered on top — boxes of various sizes coloured to
  // suggest a vise / paint can / wrench tray.
  const items = [
    { col: 0xa83a1a, sz: [0.18, 0.16, 0.18], offsetX: -0.2, offsetZ: -0.05 },
    { col: 0x2a2a30, sz: [0.34, 0.06, 0.18], offsetX: 0.1,  offsetZ: 0.0 },
    { col: 0x7a5e2a, sz: [0.12, 0.12, 0.12], offsetX: 0.32, offsetZ: -0.15 },
  ];
  for (const it of items) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...it.sz),
      new THREE.MeshStandardMaterial({ color: it.col, roughness: 0.55 })
    );
    m.position.set(it.offsetX * w * 0.5, 0.78 + it.sz[1] / 2 + 0.04, it.offsetZ * d * 0.5);
    g.add(m);
  }
  return g;
}

// ---- Wall art ----

function pickArt(opts) { return opts[Math.floor(Math.random() * opts.length)]; }

function buildArtMesh(kind) {
  const g = new THREE.Group();
  if (kind === "painting") {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.45, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x3a2718, roughness: 0.55 }),
    );
    g.add(frame);
    const canvas = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.35, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x6d8aa8 + Math.floor(Math.random() * 0x202020),
        emissive: 0x224466, emissiveIntensity: 0.15,
        roughness: 0.7,
      }),
    );
    g.add(canvas);
    // A few brush-stroke shapes
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.04, 0.06),
        new THREE.MeshStandardMaterial({
          color: [0xff8c42, 0x32d196, 0xffd84d][i],
          roughness: 0.5,
        }),
      );
      stripe.position.set(
        (Math.random() - 0.5) * 0.2,
        (i - 1) * 0.08,
        0.04,
      );
      g.add(stripe);
    }
  } else if (kind === "tv") {
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.85, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.4 }),
    );
    g.add(bezel);
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(1.32, 0.78, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: 0x4a90ff, emissiveIntensity: 0.55,
        roughness: 0.2,
      }),
    );
    g.add(screen);
    // Wall mount
    const mount = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.06, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x222226 }),
    );
    mount.position.set(0, -0.6, -0.01);
    g.add(mount);
  } else if (kind === "shelf") {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.04, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.6 }),
    );
    g.add(shelf);
    // A few "books" / decor objects
    const decoMats = [0xff8c42, 0x32d196, 0xffd84d, 0xa0e8ff].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }),
    );
    for (let i = 0; i < 4; i++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.2 + Math.random() * 0.08, 0.12),
        decoMats[i % decoMats.length],
      );
      book.position.set(-0.3 + i * 0.18, 0.12, 0.01);
      g.add(book);
    }
  } else if (kind === "clock") {
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24),
      new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.3 }),
    );
    back.rotation.x = Math.PI / 2;
    g.add(back);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.025, 8, 36),
      new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.6, roughness: 0.3 }),
    );
    g.add(ring);
    const hand1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.18, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x111114 }),
    );
    hand1.position.set(0, 0.05, 0.03);
    g.add(hand1);
    const hand2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.12, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xa83a1a }),
    );
    hand2.position.set(0.03, 0.0, 0.03);
    hand2.rotation.z = -Math.PI / 4;
    g.add(hand2);
  } else if (kind === "calendar") {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.65, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xfaf2dc, roughness: 0.7 }),
    );
    g.add(board);
    // Header strip
    const hdr = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, 0.025),
      new THREE.MeshStandardMaterial({ color: 0xa83a1a, roughness: 0.5 }),
    );
    hdr.position.set(0, 0.26, 0.005);
    g.add(hdr);
    // Grid markings
    const gridMat = new THREE.MeshStandardMaterial({ color: 0x222226 });
    for (let i = 1; i < 5; i++) {
      const ln = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.005, 0.02),
        gridMat,
      );
      ln.position.set(0, 0.18 - i * 0.08, 0.012);
      g.add(ln);
    }
  } else if (kind === "mirror") {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.85, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.85, roughness: 0.25 }),
    );
    g.add(frame);
    const mirror = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.75, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x9cb8d8, metalness: 0.95, roughness: 0.05,
        emissive: 0x18283a, emissiveIntensity: 0.2,
      }),
    );
    g.add(mirror);
  } else if (kind === "towel") {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.7, 12),
      new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.85, roughness: 0.25 }),
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 0.2;
    g.add(rod);
    const towel = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.4, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xa0e8ff, roughness: 0.95 }),
    );
    towel.position.set(0, 0.0, 0.03);
    g.add(towel);
  } else if (kind === "tools") {
    // Pegboard with hanging tools
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.6, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xb8854a, roughness: 0.7 }),
    );
    g.add(board);
    const tool = (x, y, sz, col) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sz, 0.06, 0.02),
        new THREE.MeshStandardMaterial({ color: col, metalness: 0.6, roughness: 0.4 })
      );
      m.position.set(x, y, 0.025);
      g.add(m);
    };
    tool(-0.3, 0.2, 0.18, 0xcfcfd6); // hammer
    tool(-0.05, 0.18, 0.22, 0x222226); // wrench
    tool(0.25, 0.15, 0.16, 0xa83a1a); // screwdriver
  }
  return g;
}

function buildGenericTable(w, d) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.6 });
  const t = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.06, d * 0.9), mat);
  t.position.y = 0.6;
  g.add(t);
  return g;
}
