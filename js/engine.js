// Three.js engine: scene + renderer + camera + lighting + the per-frame loop.
//
// Exposes a small API so the game code can stay framework-agnostic.

import * as THREE from "three";

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.alive = false;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      this.renderer.setClearColor(0x07070f, 1);
      this.alive = true;
    } catch (err) {
      console.warn("WebGL unavailable — running in UI-only mode:", err);
      // Stub renderer so the rest of the engine still runs without crashing.
      this.renderer = {
        setPixelRatio() {},
        setSize() {},
        render() {},
        outputColorSpace: null,
        toneMapping: 0,
        toneMappingExposure: 1,
        shadowMap: { enabled: false, type: 0 },
      };
      this._warnNoGl();
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050a);
    this.scene.fog = new THREE.FogExp2(0x05050a, 0.022);

    // Perspective camera. Three modes are supported, switched via
    // setCameraMode(): "topdown" (the default arcade view), "third" (chase
    // camera behind the bot, FPS-style), "first" (mounted on the bot).
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
    this.camera.position.set(0, 16, 11);
    this.camera.lookAt(0, 0, 0);
    this.cameraMode = "topdown";
    this.mouseYaw = 0;     // additional rotation from mouse drag (radians)
    this.mousePitch = 0;

    // Lighting rig: warm key + cool fill + neon accents.
    this.ambient = new THREE.AmbientLight(0x37274a, 0.95);
    this.scene.add(this.ambient);

    this.key = new THREE.DirectionalLight(0xffd9a8, 1.7);
    this.key.position.set(12, 24, 8);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -28;
    this.key.shadow.camera.right = 28;
    this.key.shadow.camera.top = 28;
    this.key.shadow.camera.bottom = -28;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 60;
    this.key.shadow.bias = -0.0005;
    this.scene.add(this.key);

    this.fill = new THREE.DirectionalLight(0x6b4cff, 0.55);
    this.fill.position.set(-14, 12, -10);
    this.scene.add(this.fill);

    this.rim = new THREE.HemisphereLight(0xb6e4ff, 0x140820, 0.25);
    this.scene.add(this.rim);

    // Camera follow target = local player world position. The follow
    // entity (a Player object) supplies extra info — facing rotation — so
    // chase/first-person cams orient correctly.
    this.followTarget = new THREE.Vector3();
    this.followFacing = 0;
    this.cameraOffset = new THREE.Vector3(0, 14, 9);

    this._wireMouseLook();

    this.callbacks = [];
    this.last = performance.now();
    this.running = false;

    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Pull camera back further in portrait so we keep the room in frame.
    if (h > w) {
      this.cameraOffset.set(0, 21, 14);
    } else {
      this.cameraOffset.set(0, 16, 11);
    }
  }

  // Optional bounds the camera can clamp its follow target to so it never
  // looks beyond the playable area.
  setLevelBounds(min, max) {
    this.levelBounds = { min, max };
  }

  // (legacy — referenced from earlier ortho experiment; kept as a no-op so
  // any straggler call is harmless.)
  _refitCamera() {}

  _updateCamera() {
    const mode = this.cameraMode;
    if (mode === "topdown") {
      // Original arcade view, with optional mouse yaw/pitch overlay.
      let tx = this.followTarget.x;
      let tz = this.followTarget.z;
      if (this.levelBounds) {
        const margin = 5;
        tx = Math.max(this.levelBounds.min.x + margin,
              Math.min(this.levelBounds.max.x - margin, tx));
        tz = Math.max(this.levelBounds.min.z + margin,
              Math.min(this.levelBounds.max.z - margin, tz));
      }
      // Apply yaw rotation around target (mouse drag).
      const sin = Math.sin(this.mouseYaw), cos = Math.cos(this.mouseYaw);
      const ox = this.cameraOffset.x * cos - this.cameraOffset.z * sin;
      const oz = this.cameraOffset.x * sin + this.cameraOffset.z * cos;
      const heightBias = this.mousePitch * 6;
      const desired = new THREE.Vector3(
        tx + ox,
        this.cameraOffset.y + heightBias,
        tz + oz,
      );
      this.camera.position.lerp(desired, 0.12);
      this.camera.lookAt(tx, 0.5, tz);
    } else if (mode === "third") {
      // Chase camera behind and slightly above the bot.
      const yaw = this.followFacing + Math.PI; // behind bot
      const pitch = 0.22 + this.mousePitch * 0.4;
      const dist = 3.8;
      const tx = this.followTarget.x;
      const tz = this.followTarget.z;
      let cx = tx + Math.sin(yaw) * dist * Math.cos(pitch);
      let cz = tz + Math.cos(yaw) * dist * Math.cos(pitch);
      let cy = 1.5 + Math.sin(pitch) * 1.6;
      // Keep the camera inside the playable area. When the desired
      // position would clip beyond the wall, raise the camera up
      // proportionally so we tilt into a top-down view instead of
      // squishing the bot at the screen.
      if (this.levelBounds) {
        const m = 1.2;
        const cxClamped = Math.max(this.levelBounds.min.x + m,
          Math.min(this.levelBounds.max.x - m, cx));
        const czClamped = Math.max(this.levelBounds.min.z + m,
          Math.min(this.levelBounds.max.z - m, cz));
        const xPenalty = Math.abs(cxClamped - cx);
        const zPenalty = Math.abs(czClamped - cz);
        const penalty = Math.hypot(xPenalty, zPenalty);
        cx = cxClamped;
        cz = czClamped;
        cy += penalty * 0.6;
      }
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(tx, 0.85, tz);
    } else if (mode === "first") {
      // First-person: camera at the sensor on top of the bot, looking
      // along the bot's facing. Movement comes from p.facing (driven by
      // mouse), no extra mouseYaw needed here.
      const yaw = this.followFacing;
      const pitch = -0.05 + this.mousePitch * 0.5;
      const tx = this.followTarget.x;
      const tz = this.followTarget.z;
      const cy = 0.55;
      // Forward unit vector in world XZ for facing yaw:
      //   atan2(vx, vz) = facing  →  forward = (sin(facing), cos(facing))
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      this.camera.position.set(tx + fx * 0.12, cy, tz + fz * 0.12);
      const lookAhead = 8;
      this.camera.lookAt(
        tx + fx * lookAhead,
        cy + Math.sin(pitch) * lookAhead,
        tz + fz * lookAhead,
      );
    }
  }

  applyMood(mood) {
    if (!mood) return;
    this.ambient.color.setHex(mood.ambient);
    this.key.color.setHex(mood.key);
    this.fill.color.setHex(mood.fill);
    // Fog and background stay near-black; distant geometry fades into the
    // void so the room reads as a stage in the dark.
    this.scene.fog.color.setHex(0x05050a);
    this.scene.background.setHex(0x05050a);
    this.renderer.setClearColor?.(0x05050a, 1);
  }

  setFollow(pos, facing) {
    if (!pos) return;
    this.followTarget.set(pos.x, 0, pos.z);
    if (typeof facing === "number") this.followFacing = facing;
  }

  setCameraMode(mode) {
    if (!["topdown", "third", "first"].includes(mode)) return;
    this.cameraMode = mode;
    // Reset accumulated mouse rotation so a switch feels predictable.
    if (mode === "topdown") { this.mouseYaw = 0; this.mousePitch = 0; }
  }

  _wireMouseLook() {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", (e) => {
      // Only start drag if pointer is over the canvas itself (not a UI panel).
      if (e.target !== canvas) return;
      // In topdown, mouse drag isn't used for look; allow it but it's a
      // no-op rotation.
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener("pointerup", (e) => {
      dragging = false;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener("pointercancel", () => { dragging = false; });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      this.mouseYaw -= dx * 0.005;
      this.mousePitch -= dy * 0.004;
      // Clamp pitch so we don't roll over.
      this.mousePitch = Math.max(-0.8, Math.min(0.8, this.mousePitch));
    });
    // Reset mouse offset on right-click.
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.mouseYaw = 0; this.mousePitch = 0;
    });
  }

  onFrame(cb) { this.callbacks.push(cb); }
  offFrame(cb) { this.callbacks = this.callbacks.filter((c) => c !== cb); }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;

      this._updateCamera();

      for (const cb of this.callbacks) cb(dt, now / 1000);

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.running = false; }

  _warnNoGl() {
    // Soft on-screen banner so users aren't left wondering.
    const div = document.createElement("div");
    div.textContent = "WebGL is required to play. Try a different browser or update graphics drivers.";
    Object.assign(div.style, {
      position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
      padding: "10px 16px", background: "#ff3d8b", color: "#0a0a14", borderRadius: "999px",
      fontFamily: "system-ui, sans-serif", fontWeight: "700", zIndex: 999,
    });
    document.body.appendChild(div);
  }

  clearWorld(group) {
    // Recursively dispose meshes.
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    group.clear();
  }
}
