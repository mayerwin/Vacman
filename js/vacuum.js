// Vacuum factory: builds a stylised 3D vacuum bot keyed by brand + LED colour.
//
// Each vacuum is a Group at world-y 0. Children:
//   - body (low cylinder)
//   - top dome / brand-specific feature (LiDAR tower, fan, etc.)
//   - LED ring (the player's chosen colour, glows)
//   - eye / sensor strip (emissive)
//   - drive wheels (decorative)
//
// We don't bake the LED colour into a material — we set it per build so
// each player can customise.

import * as THREE from "three";

export const BRAND_PALETTE = {
  roborock: {
    name: "Roborock",
    chassis: 0x1a1a1f,
    accent: 0x222228,
    decal: 0x32d196,
    feature: "lidar",
  },
  dreame: {
    name: "Dreame",
    chassis: 0xeeeef2,
    accent: 0xc8c8d0,
    decal: 0xff6f00,
    feature: "ring",
  },
  irobot: {
    name: "iRobot",
    chassis: 0x4a4a52,
    accent: 0x2a2a30,
    decal: 0xffd84d,
    feature: "brushes",
  },
  dyson: {
    name: "Dyson",
    chassis: 0xfff4d0,
    accent: 0x6a3eb0,
    decal: 0x6a3eb0,
    feature: "cyclone",
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
const BODY_HEIGHT = 0.32;

// Reusable geometries / materials cached per brand to keep things cheap.
const cache = new Map();

function getCachedGeo(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

export function buildVacuum({ brand = "roborock", color = 0x00ffc6 } = {}) {
  const def = BRAND_PALETTE[brand] ?? BRAND_PALETTE.roborock;
  const group = new THREE.Group();
  group.name = `vacuum_${brand}`;

  // Body (slightly chamfered cylinder via a lathe geometry for a softer silhouette)
  const bodyGeo = getCachedGeo("vac_body", () => {
    const points = [];
    const segs = 16;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * BODY_HEIGHT;
      // Slight bulge in the middle, top edge softened.
      let r = BODY_RADIUS;
      if (t < 0.1) r = BODY_RADIUS * (0.92 + t);
      else if (t > 0.85) r = BODY_RADIUS * (1 - (t - 0.85) * 1.4);
      points.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(points, 48);
  });

  const bodyMat = new THREE.MeshStandardMaterial({
    color: def.chassis,
    roughness: 0.45,
    metalness: 0.18,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Top accent disc.
  const topDisc = new THREE.Mesh(
    getCachedGeo("vac_top", () => new THREE.CircleGeometry(BODY_RADIUS * 0.92, 48)),
    new THREE.MeshStandardMaterial({
      color: def.accent,
      roughness: 0.35,
      metalness: 0.25,
    })
  );
  topDisc.rotation.x = -Math.PI / 2;
  topDisc.position.y = BODY_HEIGHT + 0.001;
  topDisc.castShadow = true;
  group.add(topDisc);

  // LED ring around the rim — player-coloured, additively bright.
  const ringGeo = getCachedGeo("vac_ring", () => {
    return new THREE.TorusGeometry(BODY_RADIUS * 0.99, 0.045, 12, 64);
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: color,
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.0,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = BODY_HEIGHT * 0.55;
  group.add(ring);

  // Sensor "eye" strip — front of the bot, emissive of brand decal colour.
  const eyeGeo = getCachedGeo("vac_eye", () => new THREE.BoxGeometry(0.42, 0.06, 0.02));
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: def.decal,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.set(0, BODY_HEIGHT * 0.45, BODY_RADIUS - 0.01);
  group.add(eye);

  // Brand-specific feature on top.
  const feature = buildBrandFeature(def, color);
  feature.position.y = BODY_HEIGHT;
  group.add(feature);

  // Two side wheels (tiny, mostly hidden — adds chunk).
  const wheelGeo = getCachedGeo("vac_wheel", () =>
    new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12)
  );
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.6 });
  for (const x of [-BODY_RADIUS + 0.05, BODY_RADIUS - 0.05]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.08, 0);
    group.add(w);
  }

  // A subtle tinted glow disc on the floor under the bot.
  const glowGeo = getCachedGeo("vac_glow", () => new THREE.CircleGeometry(BODY_RADIUS * 1.35, 48));
  const glowMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.01;
  group.add(glow);

  // Stash references the game can poke (LED colour change, brushes spin).
  group.userData = { ring, feature, brand, color };
  return group;
}

function buildBrandFeature(def, ledColor) {
  const g = new THREE.Group();
  switch (def.feature) {
    case "lidar": {
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.14, 24),
        new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.5 })
      );
      tower.position.y = 0.07;
      tower.castShadow = true;
      g.add(tower);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24),
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: def.decal,
          emissiveIntensity: 0.7,
          roughness: 0.3,
        })
      );
      cap.position.y = 0.16;
      g.add(cap);
      g.userData.spinner = tower;
      break;
    }
    case "ring": {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.04, 12, 48),
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: def.decal,
          emissiveIntensity: 0.9,
        })
      );
      torus.rotation.x = Math.PI / 2;
      torus.position.y = 0.04;
      g.add(torus);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 16, 12),
        new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.4 })
      );
      knob.position.y = 0.05;
      g.add(knob);
      break;
    }
    case "brushes": {
      // iRobot homage: brand badge + two tiny spinning side brushes (visible from above).
      const badge = new THREE.Mesh(
        new THREE.CircleGeometry(0.18, 32),
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: def.decal,
          emissiveIntensity: 0.6,
        })
      );
      badge.rotation.x = -Math.PI / 2;
      badge.position.y = 0.005;
      g.add(badge);
      const brushGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
      const brushMat = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.4 });
      const brushes = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const b = new THREE.Mesh(brushGeo, brushMat);
        b.position.set(Math.cos(angle) * 0.18, -0.09, Math.sin(angle) * 0.18);
        b.rotation.z = Math.PI / 2;
        brushes.add(b);
      }
      brushes.position.set(BODY_RADIUS * 0.6, 0, BODY_RADIUS * 0.4);
      g.add(brushes);
      const brushes2 = brushes.clone();
      brushes2.position.set(-BODY_RADIUS * 0.6, 0, BODY_RADIUS * 0.4);
      g.add(brushes2);
      g.userData.spinner = brushes;
      g.userData.spinner2 = brushes2;
      break;
    }
    case "cyclone": {
      const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.06, 24),
        new THREE.MeshStandardMaterial({
          color: def.accent,
          emissive: def.decal,
          emissiveIntensity: 0.4,
          metalness: 0.6,
          roughness: 0.3,
        })
      );
      fan.position.y = 0.03;
      g.add(fan);
      // 8 fan blades
      const blades = new THREE.Group();
      const bladeGeo = new THREE.BoxGeometry(0.32, 0.012, 0.05);
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(bladeGeo, bladeMat);
        b.rotation.y = (i / 8) * Math.PI * 2;
        blades.add(b);
      }
      blades.position.y = 0.05;
      g.add(blades);
      g.userData.spinner = blades;
      break;
    }
    default: {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 12),
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: ledColor,
          emissiveIntensity: 0.8,
        })
      );
      dot.position.y = 0.04;
      g.add(dot);
    }
  }
  return g;
}

// Animate brand-specific bits (call each frame).
export function animateVacuum(vacuum, dt) {
  const f = vacuum.userData?.feature;
  if (!f) return;
  if (f.userData?.spinner) f.userData.spinner.rotation.y += dt * 6;
  if (f.userData?.spinner2) f.userData.spinner2.rotation.y -= dt * 6;
  // Ring shimmer.
  const ring = vacuum.userData.ring;
  if (ring) {
    const t = performance.now() / 1000;
    ring.material.emissiveIntensity = 1.1 + Math.sin(t * 4) * 0.25;
  }
}
