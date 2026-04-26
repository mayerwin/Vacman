// UI controller — handles the DOM screens, HUD, garage preview canvas,
// toast notifications, and player customisation state.

import * as THREE from "three";
import { BRAND_PALETTE, PLAYER_COLORS, buildVacuum, animateVacuum } from "./vacuum.js";
import { powerupMeta } from "./powerups.js";

const NAMES_FALLBACK = [
  "Dustbuster", "Suckmaster", "Whirly", "Fuzz", "Boba",
  "Lint Vader", "Pebble", "Vroom", "Fluff", "Roo",
];

function $(id) { return document.getElementById(id); }
function $$(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); }

export class UI {
  constructor() {
    this.screens = {};
    $$(".screen").forEach((el) => {
      const k = el.dataset.screen;
      this.screens[k] = el;
    });

    this.toastEl = $("toast");
    this._toastTimer = null;

    this.profile = this._loadProfile();
    this.handlers = {};

    this._wireHowto();
    this._wirePause();
    this._wireResults();

    // Number key shortcuts on title screen.
    window.addEventListener("keydown", (e) => {
      if (this.current !== "title") return;
      if (e.key === "1") this._click('[data-action="solo"]');
      if (e.key === "2") this._click('[data-action="host"]');
      if (e.key === "3") this._click('[data-action="join"]');
      if (e.key === "?") this._click('[data-action="howto"]');
    });
  }

  on(event, cb) { this.handlers[event] = cb; }
  emit(e, d) { if (this.handlers[e]) this.handlers[e](d); }

  // ---------- Screens ----------
  show(name) {
    this.current = name;
    for (const k of Object.keys(this.screens)) {
      this.screens[k].hidden = k !== name;
    }
    if (name === "garage") this._renderGarage();
  }
  hideAll() {
    this.current = null;
    for (const k of Object.keys(this.screens)) this.screens[k].hidden = true;
  }

  // ---------- Title ----------
  bindTitle({ onSolo, onHost, onJoin, onHowto }) {
    $$('[data-action="solo"]', this.screens.title).forEach((b) => b.addEventListener("click", onSolo));
    $$('[data-action="host"]', this.screens.title).forEach((b) => b.addEventListener("click", onHost));
    $$('[data-action="join"]', this.screens.title).forEach((b) => b.addEventListener("click", onJoin));
    $$('[data-action="howto"]', this.screens.title).forEach((b) => b.addEventListener("click", onHowto));
  }

  _wireHowto() {
    $$('[data-action="back-title"]').forEach((b) => {
      b.addEventListener("click", () => this.show("title"));
    });
  }

  // ---------- Garage ----------
  _renderGarage() {
    const canvas = $("garage-canvas");
    if (!canvas) return;

    if (!this._garage) {
      this._garage = setupGarageScene(canvas);
      const ro = new ResizeObserver(() => this._garage.resize());
      ro.observe(canvas);
    }
    this._garage.setBrand(this.profile.brand);
    this._garage.setColor(this.profile.color);

    // Brand buttons.
    const brandRow = $("garage-brands");
    brandRow.innerHTML = "";
    for (const key of Object.keys(BRAND_PALETTE)) {
      const def = BRAND_PALETTE[key];
      const b = document.createElement("button");
      b.className = "brand";
      b.dataset.brand = key;
      b.innerHTML = `<span>${def.name}</span>`;
      b.setAttribute("aria-pressed", String(this.profile.brand === key));
      b.addEventListener("click", () => {
        this.profile.brand = key;
        this._saveProfile();
        $("garage-badge").textContent = def.name;
        this._garage.setBrand(key);
        $$(".brand", brandRow).forEach((bb) =>
          bb.setAttribute("aria-pressed", String(bb.dataset.brand === key))
        );
      });
      brandRow.appendChild(b);
    }
    $("garage-badge").textContent = BRAND_PALETTE[this.profile.brand].name;

    // Colour swatches.
    const row = $("garage-colors");
    row.innerHTML = "";
    PLAYER_COLORS.forEach((hex) => {
      const sw = document.createElement("button");
      sw.className = "swatch";
      sw.style.background = "#" + hex.toString(16).padStart(6, "0");
      sw.style.color = "#" + hex.toString(16).padStart(6, "0");
      sw.setAttribute("aria-pressed", String(this.profile.color === hex));
      sw.addEventListener("click", () => {
        this.profile.color = hex;
        this._saveProfile();
        this._garage.setColor(hex);
        $$(".swatch", row).forEach((s) =>
          s.setAttribute("aria-pressed", String(parseInt(s.style.color.replace(/[^0-9a-f]/gi, "").slice(-6), 16) === hex))
        );
      });
      row.appendChild(sw);
    });

    // Name input.
    const nameInput = $("garage-name");
    nameInput.value = this.profile.name;
    nameInput.addEventListener("input", () => {
      this.profile.name = nameInput.value.trim().slice(0, 14);
      this._saveProfile();
    });

    // Confirm and back.
    $$('[data-action="confirm-garage"]').forEach((b) => {
      b.onclick = () => this.emit("garage-confirm", this.profile);
    });
    $$('[data-action="back-title"]').forEach((b) => {
      b.onclick = () => this.show("title");
    });
  }

  // ---------- Mode ----------
  bindMode({ onMode }) {
    $$(".mode-card").forEach((b) => {
      b.onclick = () => onMode(b.dataset.mode);
    });
    $$('[data-action="back-garage"]').forEach((b) => {
      b.onclick = () => this.show("garage");
    });
  }

  // ---------- Lobby ----------
  showLobby({ role, mode, code }) {
    this.show("lobby");
    $("lobby-title").textContent =
      role === "host" ? "Hosting · " + (mode === "coop" ? "Co-op" : "Versus")
      : role === "guest" ? "Joining a game"
      : "Lobby";
    $("lobby-code-block").hidden = role !== "host";
    $("lobby-join-block").hidden = role !== "guest";
    $("lobby-start").hidden = role !== "host";
    $("lobby-waiting").hidden = role === "host";
    if (role === "host" && code) {
      $("lobby-code").textContent = code;
      const link = `${location.origin}${location.pathname}?join=${code}`;
      $("lobby-copy").onclick = () => {
        navigator.clipboard?.writeText(link);
        this.toast(`Invite link copied`, "good");
      };
    }
    if (role === "guest") {
      $("lobby-join-input").value = "";
      $("lobby-join-status").textContent = "";
      $("lobby-join-input").focus();
    }
    $$('[data-action="back-mode"]').forEach((b) => {
      b.onclick = () => this.show("mode");
    });
  }

  bindLobby({ onJoinSubmit, onStart }) {
    $("lobby-join-btn").onclick = () => {
      const code = ($("lobby-join-input").value || "").toUpperCase().trim();
      if (code.length !== 4) {
        $("lobby-join-status").textContent = "Codes are 4 characters.";
        return;
      }
      $("lobby-join-status").textContent = "Connecting…";
      onJoinSubmit(code);
    };
    $("lobby-join-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("lobby-join-btn").click();
    });
    $("lobby-start").onclick = () => onStart();
  }

  setLobbyJoinStatus(msg) { $("lobby-join-status").textContent = msg; }

  setLobbyPlayers(players) {
    const list = $("lobby-players");
    list.innerHTML = "";
    for (const p of players) {
      const li = document.createElement("li");
      li.className = "lobby__player-row";
      li.innerHTML = `
        <span class="lobby__player-dot" style="background:#${p.color.toString(16).padStart(6,"0")}; color:#${p.color.toString(16).padStart(6,"0")}"></span>
        <span class="lobby__player-name">${escapeHtml(p.name)}</span>
        <span class="lobby__player-tag">${BRAND_PALETTE[p.brand]?.name || p.brand}${p.isHost ? " · Host" : ""}${p.isLocal ? " · You" : ""}</span>
      `;
      list.appendChild(li);
    }
    $("lobby-count").textContent = `${players.length}/8`;
  }

  // ---------- HUD ----------
  showHUD() { $("hud").hidden = false; }
  hideHUD() { $("hud").hidden = true; }
  updateHUD({ levelName, progress, time, players, localPlayer }) {
    if (levelName) $("hud-room").textContent = levelName;
    if (typeof progress === "number") {
      $("hud-progress-fill").style.width = `${Math.round(progress * 100)}%`;
      $("hud-progress-text").textContent = `${Math.round(progress * 100)}%`;
    }
    if (typeof time === "number") {
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      $("hud-time").textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    if (players) {
      const pl = $("hud-players");
      pl.innerHTML = "";
      for (const p of players) {
        const pill = document.createElement("div");
        pill.className = "hud__player-pill" + (p.isLocal ? " hud__player-pill--self" : "") + (p.stunned > 0 ? " hud__player-pill--stunned" : "");
        pill.innerHTML = `
          <span class="lobby__player-dot" style="background:#${p.color.toString(16).padStart(6,"0")}; color:#${p.color.toString(16).padStart(6,"0")}"></span>
          <span>${escapeHtml(p.name)}</span>
          <span class="hud__player-score">${p.score}</span>
        `;
        pl.appendChild(pill);
      }
    }
    if (localPlayer) {
      const meta = localPlayer.powerup ? powerupMeta(localPlayer.powerup) : null;
      const wrap = $("hud-powerup");
      const icon = $("hud-powerup-icon");
      const name = $("hud-powerup-name");
      if (meta) {
        wrap.classList.add("hud__powerup--armed");
        icon.textContent = meta.icon;
        icon.style.color = "#" + meta.color.toString(16).padStart(6, "0");
        name.textContent = meta.name + " ready";
      } else {
        wrap.classList.remove("hud__powerup--armed");
        icon.textContent = "·";
        icon.style.color = "";
        name.textContent = "No power-up";
      }
    }
  }

  bindHUD({ onLeave, onCameraToggle, onSoundToggle }) {
    $("hud-leave").onclick = onLeave;
    $("hud-camera").onclick = onCameraToggle;
    $("hud-sound").onclick = onSoundToggle;
  }

  setCameraLabel(mode) {
    const icon = $("hud-camera-icon");
    if (!icon) return;
    if (mode === "topdown") icon.textContent = "▦";
    else if (mode === "third") icon.textContent = "◗";
    else if (mode === "first") icon.textContent = "👁";
    icon.parentElement.title = `Camera: ${mode} (V to cycle)`;
  }
  setSoundLabel(on) {
    const icon = $("hud-sound-icon");
    if (!icon) return;
    icon.textContent = on ? "♪" : "✕";
    icon.parentElement.classList.toggle("hud__icon--active", !!on);
  }

  // ---------- Pause ----------
  showPause() { this.show("pause"); }
  _wirePause() {
    $$('[data-action="resume"]').forEach((b) => {
      b.onclick = () => this.emit("pause-resume", null);
    });
  }
  bindPause({ onResume, onLeave }) {
    this.on("pause-resume", onResume);
    $$('[data-action="leave-game"]').forEach((b) => {
      b.onclick = () => onLeave();
    });
  }

  // ---------- Results ----------
  showResults({ title, sub, players, isFinal, isWin }) {
    this.show("results");
    $("results-title").textContent = title;
    $("results-sub").textContent = sub || "";
    const board = $("results-board");
    board.innerHTML = "";
    const sorted = [...players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "results__row" + (i === 0 ? " results__row--winner" : "");
      row.innerHTML = `
        <span class="results__rank">${i + 1}</span>
        <span class="lobby__player-dot" style="background:#${p.color.toString(16).padStart(6,"0")}; color:#${p.color.toString(16).padStart(6,"0")}"></span>
        <span class="results__name">${escapeHtml(p.name)}</span>
        <span class="results__score">${p.score}</span>
      `;
      board.appendChild(row);
    });
    const next = $("results-next");
    if (isFinal) {
      next.textContent = "Back to title";
    } else {
      next.textContent = "Next room →";
    }
  }
  _wireResults() {}
  bindResults({ onNext }) {
    $("results-next").onclick = onNext;
  }

  // ---------- Toast ----------
  toast(msg, kind = "") {
    const el = this.toastEl;
    el.textContent = msg;
    el.className = "toast toast--show" + (kind ? " toast--" + kind : "");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.className = "toast" + (kind ? " toast--" + kind : "");
    }, 2200);
  }

  // ---------- Profile persistence ----------
  _loadProfile() {
    try {
      const stored = JSON.parse(localStorage.getItem("vacman:profile") || "null");
      if (stored && stored.name) return stored;
    } catch (_) {}
    return {
      name: NAMES_FALLBACK[Math.floor(Math.random() * NAMES_FALLBACK.length)],
      brand: "roborock",
      color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
    };
  }
  _saveProfile() {
    try { localStorage.setItem("vacman:profile", JSON.stringify(this.profile)); } catch (_) {}
  }

  _click(sel) {
    const el = document.querySelector(sel);
    if (el) el.click();
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])
  );
}

// ----------------- Garage preview scene -----------------

function setupGarageScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0x8888ff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.PointLight(0x00ffc6, 1.4, 8);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  const rim2 = new THREE.PointLight(0xff3d8b, 1.0, 8);
  rim2.position.set(3, 1.5, 3);
  scene.add(rim2);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(2.2, 2.2, 2.6);
  camera.lookAt(0, 0.3, 0);

  // Floor disc.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 64),
    new THREE.MeshBasicMaterial({
      color: 0x00ffc6, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0;
  scene.add(disc);

  let vacuum = null;
  const turntable = new THREE.Group();
  scene.add(turntable);

  function setBrand(brand) {
    if (vacuum) turntable.remove(vacuum);
    vacuum = buildVacuum({ brand, color: state.color });
    vacuum.scale.setScalar(1.4);
    turntable.add(vacuum);
    state.brand = brand;
  }
  function setColor(color) {
    state.color = color;
    if (vacuum) {
      // The new LED is a basic-material ring + glow; just swap their colour.
      if (vacuum.userData.led)  vacuum.userData.led.material.color.setHex(color);
      if (vacuum.userData.glow) vacuum.userData.glow.material.color.setHex(color);
      vacuum.userData.color = color;
    }
  }
  const state = { brand: "roborock", color: 0x00ffc6 };

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    turntable.rotation.y += dt * 0.4;
    if (vacuum) animateVacuum(vacuum, dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { setBrand, setColor, resize };
}
