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

    // Perspective chase camera tuned for an arcade top-down feel. resize()
    // re-tunes the offset for portrait/landscape.
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camera.position.set(0, 16, 11);
    this.camera.lookAt(0, 0, 0);

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

    // Camera follow target.
    this.followTarget = new THREE.Vector3();
    this.cameraOffset = new THREE.Vector3(0, 14, 9);
    this.cameraTilt = 0.78; // 0 = top-down, 1 = chase

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

  setFollow(pos) {
    if (!pos) return;
    this.followTarget.set(pos.x, 0, pos.z);
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

      // Camera follow with soft clamping so we never frame open void.
      let tx = this.followTarget.x;
      let tz = this.followTarget.z;
      if (this.levelBounds) {
        const margin = 5;
        tx = Math.max(this.levelBounds.min.x + margin,
              Math.min(this.levelBounds.max.x - margin, tx));
        tz = Math.max(this.levelBounds.min.z + margin,
              Math.min(this.levelBounds.max.z - margin, tz));
      }
      const desired = new THREE.Vector3(
        tx + this.cameraOffset.x,
        this.cameraOffset.y,
        tz + this.cameraOffset.z
      );
      this.camera.position.lerp(desired, 0.08);
      this.camera.lookAt(tx, 0.5, tz);

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
