// Vacuum factory: builds a stylised 3D vacuum bot keyed by brand + LED colour.
//
// Each brand silhouette nods to the real flagship product:
//   - Roborock  → tall LiDAR turret, matte black body, green accent
//   - Dreame    → low profile, no turret, thin sensor strip
//   - iRobot    → grey puck with three top buttons + front camera bump
//   - Dyson     → navy + copper, oblong with a hemispherical 360° dome
//
// All bots share the same diameter so collision tuning stays the same.
// The user-coloured LED ring is rendered as an underglow halo so it never
// fights with the brand's colour palette.

import * as THREE from "three";

export const BRAND_PALETTE = {
  roborock: {
    name: "Roborock",
    chassis: 0x111114,
    accent: 0x1a1a1f,
    decal: 0x32d196,
    feature: "lidar",
  },
  dreame: {
    name: "Dreame",
    chassis: 0xeeeae0,
    accent: 0xc8c4b8,
    decal: 0xff6f00,
    feature: "puck",
  },
  irobot: {
    name: "iRobot",
    chassis: 0x3a3a40,
    accent: 0x222226,
    decal: 0xc88838,
    feature: "buttons",
  },
  dyson: {
    name: "Dyson",
    chassis: 0x18203a,
    accent: 0xb87333,
    decal: 0xb87333,
    feature: "dome",
  },
};

export const PLAYER_COLORS = [
  0x00ffc6, // mint
  0xff3d8b, // pink
  0xffb13d, // amber
  0x8b5cf6, // violet
  0x38bdf8, // sky
  0xff6b6b, // coral
  0xb5ff3d, // lime
  0xff9ad8, // pastel pink
];

const BODY_RADIUS = 0.6;
const BODY_HEIGHT = 0.36;

const cache = new Map();
function getCachedGeo(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

export function buildVacuum({ brand = "roborock", color = 0x00ffc6 } = {}) {
  const def = BRAND_PALETTE[brand] ?? BRAND_PALETTE.roborock;
  const group = new THREE.Group();
  group.name = `vacuum_${brand}`;

  // Soft chamfered cylinder via lathe, slightly squashed for a low puck
  // silhouette (or taller for Roborock to accommodate the turret).
  const heightMul = def.feature === "lidar" ? 1.0
    : def.feature === "dome" ? 1.0 : 0.85;
  const bodyHeight = BODY_HEIGHT * heightMul;

  const points = [];
  const segs = 18;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * bodyHeight;
    let r = BODY_RADIUS;
    if (t < 0.08) r = BODY_RADIUS * (0.92 + t);
    else if (t > 0.85) r = BODY_RADIUS * (1 - (t - 0.85) * 1.4);
    points.push(new THREE.Vector2(r, y));
  }
  const bodyGeo = new THREE.LatheGeometry(points, 56);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: def.chassis,
    roughness: 0.45,
    metalness: 0.18,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Top accent disc — slightly recessed
  const topDisc = new THREE.Mesh(
    getCachedGeo("vac_top", () => new THREE.CircleGeometry(BODY_RADIUS * 0.94, 56)),
    new THREE.MeshStandardMaterial({
      color: def.accent,
      roughness: 0.3,
      metalness: 0.35,
    })
  );
  topDisc.rotation.x = -Math.PI / 2;
  topDisc.position.y = bodyHeight + 0.001;
  topDisc.castShadow = true;
  group.add(topDisc);

  // Subtle thin equator ring in the chassis colour for a "two-tone" look.
  const equator = new THREE.Mesh(
    getCachedGeo("vac_eq", () =>
      new THREE.TorusGeometry(BODY_RADIUS * 0.995, 0.012, 8, 64)
    ),
    new THREE.MeshStandardMaterial({
      color: def.accent, roughness: 0.4, metalness: 0.4,
    })
  );
  equator.rotation.x = Math.PI / 2;
  equator.position.y = bodyHeight * 0.55;
  group.add(equator);

  // ----- Brand-specific top features -----
  const feature = buildBrandFeature(def);
  feature.position.y = bodyHeight;
  group.add(feature);

  // Underbody LED ring — player colour shines on the floor as a halo so the
  // brand's chassis colour stays clean on top.
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending,
  });
  const led = new THREE.Mesh(
    getCachedGeo("vac_underring", () =>
      new THREE.RingGeometry(BODY_RADIUS * 0.7, BODY_RADIUS * 1.05, 56)
    ),
    ringMat
  );
  led.rotation.x = -Math.PI / 2;
  led.position.y = 0.015;
  group.add(led);

  // Floor halo splash
  const glow = new THREE.Mesh(
    getCachedGeo("vac_glow", () =>
      new THREE.CircleGeometry(BODY_RADIUS * 1.5, 48)
    ),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.01;
  group.add(glow);

  // Two small visible drive wheels on the bottom edge.
  const wheelGeo = getCachedGeo("vac_wheel", () =>
    new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12)
  );
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.6 });
  for (const x of [-BODY_RADIUS + 0.05, BODY_RADIUS - 0.05]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.08, 0);
    group.add(w);
  }

  // Two side brushes (just decorative on most brands; central on iRobot).
  const brushHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10),
    new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5 })
  );
  const brushBristles = new THREE.Group();
  const bristleGeo = new THREE.BoxGeometry(0.12, 0.005, 0.012);
  const bristleMat = new THREE.MeshStandardMaterial({ color: def.decal, roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(bristleGeo, bristleMat);
    b.rotation.y = (i / 5) * Math.PI * 2;
    brushBristles.add(b);
  }
  brushHub.add(brushBristles);
  brushHub.position.set(BODY_RADIUS * 0.55, 0.04, BODY_RADIUS * 0.55);
  group.add(brushHub);
  const brush2 = brushHub.clone();
  brush2.position.x = -BODY_RADIUS * 0.55;
  group.add(brush2);

  group.userData = {
    led, glow, feature, brand, color,
    sideBrushA: brushBristles,
    sideBrushB: brush2.children[0],
  };
  return group;
}

function buildBrandFeature(def) {
  const g = new THREE.Group();
  switch (def.feature) {
    case "lidar": {
      // Roborock LiDAR turret: black cylinder + dark glass cap.
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.16, 28),
        new THREE.MeshStandardMaterial({
          color: 0x0c0c10, roughness: 0.4, metalness: 0.4,
        })
      );
      tower.position.y = 0.08;
      tower.castShadow = true;
      g.add(tower);
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 0.04, 28),
        new THREE.MeshStandardMaterial({
          color: 0x000000, roughness: 0.1, metalness: 0.7,
          emissive: 0x004433, emissiveIntensity: 0.4,
        })
      );
      glass.position.y = 0.18;
      g.add(glass);
      // Small green accent strip — the famous Roborock sensor LED.
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.01, 0.018),
        new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0x32d196, emissiveIntensity: 1.4,
        })
      );
      accent.position.set(0, 0.005, BODY_RADIUS * 0.85);
      g.add(accent);
      g.userData.spinner = tower;
      break;
    }
    case "puck": {
      // Dreame: flat puck, only a thin horizontal sensor strip and a small
      // brand mark.
      const sensor = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.02, 0.04),
        new THREE.MeshStandardMaterial({
          color: 0x0a0a0a, roughness: 0.3, metalness: 0.6,
        })
      );
      sensor.position.set(0, 0.012, BODY_RADIUS * 0.6);
      g.add(sensor);
      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 12, 8),
        new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0xff6f00, emissiveIntensity: 1.0,
        })
      );
      lens.position.set(0, 0.018, BODY_RADIUS * 0.6 + 0.02);
      g.add(lens);
      // tiny dot brand mark
      const mark = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 24),
        new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0xff6f00, emissiveIntensity: 0.4,
        })
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.005;
      g.add(mark);
      break;
    }
    case "buttons": {
      // iRobot: three round buttons in a row (CLEAN/HOME/SPOT) + a small
      // camera dome at the front.
      const buttonMat = new THREE.MeshStandardMaterial({
        color: 0x18181c, roughness: 0.5, metalness: 0.3,
      });
      const cleanBtn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.025, 24),
        new THREE.MeshStandardMaterial({
          color: 0x18181c,
          emissive: def.decal, emissiveIntensity: 0.6,
          roughness: 0.4,
        })
      );
      cleanBtn.position.set(0, 0.014, -0.05);
      g.add(cleanBtn);
      const sideBtn = (x) => {
        const b = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 0.02, 18),
          buttonMat
        );
        b.position.set(x, 0.012, -0.05);
        g.add(b);
      };
      sideBtn(-0.22);
      sideBtn(0.22);
      // Front camera/sensor bump.
      const cam = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: 0x101014, roughness: 0.3, metalness: 0.6,
        })
      );
      cam.position.set(0, 0.005, BODY_RADIUS * 0.65);
      g.add(cam);
      const camLens = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 12, 8),
        new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0xffd84d, emissiveIntensity: 1.2,
        })
      );
      camLens.position.set(0, 0.06, BODY_RADIUS * 0.65 + 0.02);
      g.add(camLens);
      break;
    }
    case "dome": {
      // Dyson 360 Vis Nav homage: a copper-rim dome on top with a thin
      // blue camera ring inside.
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: 0x101430, roughness: 0.25, metalness: 0.6,
        })
      );
      dome.position.y = 0.0;
      g.add(dome);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.18, 0.022, 12, 36),
        new THREE.MeshStandardMaterial({
          color: def.accent, roughness: 0.25, metalness: 0.95,
        })
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.0;
      g.add(rim);
      const inner = new THREE.Mesh(
        new THREE.TorusGeometry(0.11, 0.012, 8, 32),
        new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0x38bdf8, emissiveIntensity: 1.0,
        })
      );
      inner.rotation.x = Math.PI / 2;
      inner.position.y = 0.13;
      g.add(inner);
      // Front grille dots.
      const dotGeo = new THREE.SphereGeometry(0.012, 6, 6);
      const dotMat = new THREE.MeshStandardMaterial({ color: 0x222226 });
      for (let i = -2; i <= 2; i++) {
        const d = new THREE.Mesh(dotGeo, dotMat);
        d.position.set(i * 0.06, 0.005, BODY_RADIUS * 0.85);
        g.add(d);
      }
      g.userData.spinner = inner;
      break;
    }
  }
  return g;
}

// Animate per-frame brand widgets + side-brush spin.
export function animateVacuum(vacuum, dt) {
  const ud = vacuum.userData;
  if (!ud) return;
  const f = ud.feature;
  if (f?.userData?.spinner) f.userData.spinner.rotation.y += dt * 6;
  if (ud.sideBrushA) ud.sideBrushA.rotation.y += dt * 8;
  if (ud.sideBrushB) ud.sideBrushB.rotation.y -= dt * 8;
  // LED breath: slowly modulate the underglow opacity.
  if (ud.led) {
    const t = performance.now() / 1000;
    ud.led.material.opacity = 0.65 + Math.sin(t * 3) * 0.15;
  }
}
