// Particle / one-shot visual effects: damage smoke, sparks, screen flash.
// All effects auto-clean themselves up.

import * as THREE from "three";

export function spawnDamageBurst(world, x, z, color = 0xff6b6b) {
  const grp = new THREE.Group();
  world.group.add(grp);

  // Sparks: bright tiny dots flying out radially.
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffd84d, blending: THREE.AdditiveBlending, transparent: true,
  });
  const sparkGeo = new THREE.SphereGeometry(0.05, 6, 4);
  const sparks = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Mesh(sparkGeo, sparkMat.clone());
    s.position.set(x, 0.5, z);
    const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 4 + Math.random() * 3;
    s.userData = {
      vx: Math.cos(angle) * speed,
      vy: 2 + Math.random() * 2,
      vz: Math.sin(angle) * speed,
      life: 0.55,
    };
    grp.add(s);
    sparks.push(s);
  }

  // Smoke puffs: soft semi-translucent spheres rising slowly.
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x44444a, transparent: true, opacity: 0.6, depthWrite: false,
  });
  const smokeGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const smokes = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
    s.position.set(x + (Math.random() - 0.5) * 0.4, 0.4, z + (Math.random() - 0.5) * 0.4);
    s.userData = {
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0.7 + Math.random() * 0.5,
      vz: (Math.random() - 0.5) * 0.5,
      scale: 1.0 + Math.random() * 0.4,
      life: 1.4,
    };
    grp.add(s);
    smokes.push(s);
  }

  // Quick red flash sphere at impact point.
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending,
    })
  );
  flash.position.set(x, 0.5, z);
  grp.add(flash);
  flash.userData = { life: 0.25 };

  let lastT = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    lastT = now;
    let alive = false;
    for (const s of sparks) {
      if (!s.parent) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { grp.remove(s); continue; }
      alive = true;
      s.position.x += s.userData.vx * dt;
      s.position.y += s.userData.vy * dt;
      s.position.z += s.userData.vz * dt;
      s.userData.vy -= 6 * dt;
      s.material.opacity = Math.max(0, s.userData.life / 0.55);
    }
    for (const s of smokes) {
      if (!s.parent) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { grp.remove(s); continue; }
      alive = true;
      s.position.x += s.userData.vx * dt;
      s.position.y += s.userData.vy * dt;
      s.position.z += s.userData.vz * dt;
      s.userData.vx *= 0.96;
      s.userData.vz *= 0.96;
      s.scale.setScalar(s.userData.scale * (1 + (1.4 - s.userData.life) * 0.6));
      s.material.opacity = Math.max(0, (s.userData.life / 1.4) * 0.6);
    }
    if (flash.parent) {
      flash.userData.life -= dt;
      if (flash.userData.life <= 0) { grp.remove(flash); }
      else {
        alive = true;
        flash.scale.setScalar(1 + (0.25 - flash.userData.life) * 6);
        flash.material.opacity = Math.max(0, flash.userData.life / 0.25 * 0.6);
      }
    }
    if (alive) requestAnimationFrame(tick);
    else world.group.remove(grp);
  };
  requestAnimationFrame(tick);
}

// Screen flash overlay (DOM, not 3D) — for the local player taking damage.
let _flashEl = null;
export function screenFlash(color = "#ff3d8b", intensity = 0.45, duration = 0.35) {
  if (!_flashEl) {
    _flashEl = document.createElement("div");
    Object.assign(_flashEl.style, {
      position: "fixed", inset: "0", pointerEvents: "none", zIndex: "8",
      mixBlendMode: "screen", opacity: "0", transition: "opacity 0.2s",
    });
    document.body.appendChild(_flashEl);
  }
  _flashEl.style.background = color;
  _flashEl.style.opacity = String(intensity);
  setTimeout(() => { _flashEl.style.opacity = "0"; }, duration * 1000);
}
