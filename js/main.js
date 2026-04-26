// Vacman — entry point. Wires the title/garage/lobby flow to the Game,
// and bridges PeerJS multiplayer messages.

import * as THREE from "three";
import { Engine } from "./engine.js";
import { UI } from "./ui.js";
import { Input } from "./input.js";
import { Game } from "./game.js";
import { Net } from "./multiplayer.js";
import { buildVacuum, animateVacuum, BRAND_PALETTE, PLAYER_COLORS } from "./vacuum.js";
import { sound } from "./audio.js";
import { screenFlash } from "./effects.js";

const canvas = document.getElementById("game-canvas");
const engine = new Engine(canvas);
const ui = new UI();
const input = new Input();
const net = new Net();

// Title scene state lives here so the `spawnTitleVacuum()` call below the
// boot block doesn't hit the temporal dead zone on a let binding.
let titleScene = null;
let paused = false;

// Touch detection for mobile joystick.
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
if (isTouch) input.showTouch();

// Audio context can only resume after a user gesture. Wire it to the first
// click anywhere on the page.
const unlockAudio = () => {
  sound.unlock();
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
};
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

let game = null;
let mode = "solo";  // "solo" | "coop" | "versus"
let role = "solo";  // "solo" | "host" | "guest"
let myId = "p_" + Math.random().toString(36).slice(2, 8);
let lobbyPlayers = [];      // [{id, name, brand, color, isHost, isLocal}]
let snapshotInterval = null;

// ---------- Boot ----------
ui.show("title");
engine.start();

// Background "title" scene: a single roaming vacuum on a dark plane.
spawnTitleVacuum();

// ?join=CODE deep link auto-open.
const url = new URL(location.href);
const joinCode = url.searchParams.get("join");

ui.bindTitle({
  onSolo:   () => { role = "solo"; mode = "solo"; ui.show("garage"); },
  onHost:   () => { role = "host"; ui.show("garage"); },
  onJoin:   () => { role = "guest"; ui.show("garage"); },
  onHowto:  () => { ui.show("howto"); },
});

ui.on("garage-confirm", (profile) => {
  if (role === "solo") {
    startGame({ levelIndex: 0 });
    return;
  }
  if (role === "host" || role === "guest") {
    ui.show("mode");
    if (role === "guest") {
      // skip mode for guest — host decides. Send straight to lobby.
      enterLobby();
    }
  }
});

ui.bindMode({
  onMode: (m) => {
    mode = m;
    enterLobby();
  },
});

async function enterLobby() {
  if (role === "host") {
    try {
      const { code } = await net.host();
      ui.showLobby({ role: "host", mode, code });
      lobbyPlayers = [{
        id: myId, name: ui.profile.name, brand: ui.profile.brand,
        color: ui.profile.color, isHost: true, isLocal: true,
      }];
      ui.setLobbyPlayers(lobbyPlayers);
    } catch (err) {
      ui.toast("Could not host: " + (err?.type || err), "bad");
      ui.show("title");
    }
  } else if (role === "guest") {
    ui.showLobby({ role: "guest" });
    if (joinCode && !net.peer) {
      // Pre-fill from deep link.
      document.getElementById("lobby-join-input").value = joinCode;
    }
  }
}

ui.bindLobby({
  onJoinSubmit: async (code) => {
    try {
      await net.join(code);
      ui.setLobbyJoinStatus(`Connected as “${ui.profile.name}”. Waiting for host…`);
      // Identify ourselves.
      net.sendToHost({
        type: "hello",
        id: myId,
        name: ui.profile.name,
        brand: ui.profile.brand,
        color: ui.profile.color,
      });
    } catch (err) {
      ui.setLobbyJoinStatus("Could not join: " + (err?.type || err));
    }
  },
  onStart: () => {
    if (role !== "host") return;
    if (lobbyPlayers.length < 1) return;
    // Tell guests we're starting.
    net.sendToAll({ type: "start", mode, level: 0, players: lobbyPlayers });
    startGame({ levelIndex: 0, players: lobbyPlayers });
  },
});

// ---------- Multiplayer events (host) ----------

net.on("hosted", () => {/* ui already updated */});
net.on("guest-connected", ({ id }) => {
  ui.toast("A pilot is connecting…");
});
net.on("from-guest", ({ id, msg }) => {
  if (msg.type === "hello") {
    if (lobbyPlayers.length >= 8) {
      net.connections.get(id)?.send({ type: "lobby-full" });
      return;
    }
    // Strip duplicate ids defensively.
    if (lobbyPlayers.find((p) => p.id === msg.id)) return;
    lobbyPlayers.push({
      id: msg.id, name: msg.name, brand: msg.brand,
      color: msg.color, isHost: false, isLocal: false, peerId: id,
    });
    ui.setLobbyPlayers(lobbyPlayers);
    // Echo lobby roster back to all.
    net.sendToAll({ type: "lobby", players: lobbyPlayers, mode });
    ui.toast(`${msg.name} joined`, "good");
  } else if (msg.type === "input" && game) {
    // Map peer id back to player id.
    const player = lobbyPlayers.find((p) => p.peerId === id);
    if (player) game.pushRemoteInput(player.id, msg.axis || { x: 0, y: 0 }, !!msg.action);
  }
});
net.on("guest-disconnected", ({ id }) => {
  const i = lobbyPlayers.findIndex((p) => p.peerId === id);
  if (i >= 0) {
    const [removed] = lobbyPlayers.splice(i, 1);
    ui.setLobbyPlayers(lobbyPlayers);
    if (game) game.removePlayer(removed.id);
    ui.toast(`${removed.name} disconnected`, "bad");
    net.sendToAll({ type: "lobby", players: lobbyPlayers, mode });
  }
});

// ---------- Multiplayer events (guest) ----------

net.on("joined", () => {});
net.on("from-host", (msg) => {
  if (msg.type === "lobby") {
    lobbyPlayers = msg.players.map((p) => ({ ...p, isLocal: p.id === myId }));
    ui.setLobbyPlayers(lobbyPlayers);
    if (msg.mode) mode = msg.mode;
  } else if (msg.type === "lobby-full") {
    ui.setLobbyJoinStatus("Lobby is full (8 max).");
    net.destroy();
  } else if (msg.type === "start") {
    mode = msg.mode;
    lobbyPlayers = msg.players.map((p) => ({ ...p, isLocal: p.id === myId }));
    startGame({ levelIndex: msg.level, players: lobbyPlayers, asGuest: true });
  } else if (msg.type === "snap" && game) {
    game.applySnapshot(msg);
    refreshHUD();
  } else if (msg.type === "level-cleared" && game) {
    showResults(msg.payload, !!msg.isFinal);
  } else if (msg.type === "next-level" && game) {
    ui.show(null); ui.hideAll(); ui.showHUD();
    game.setLevel(msg.level);
  } else if (msg.type === "back-to-title") {
    leaveGame();
  }
});
net.on("error", (e) => {
  console.warn("net error", e);
});
net.on("disconnected", () => {
  ui.toast("Lost connection to host", "bad");
  leaveGame();
});

// ---------- Game lifecycle ----------

function startGame({ levelIndex = 0, players = null, asGuest = false } = {}) {
  if (game) { game.destroy(); game = null; }
  removeTitleVacuum();

  let participants;
  if (role === "solo" || (!players)) {
    participants = [{
      id: myId, name: ui.profile.name, brand: ui.profile.brand,
      color: ui.profile.color, isLocal: true,
    }];
  } else {
    participants = players.map((p) => ({
      id: p.id, name: p.name, brand: p.brand, color: p.color,
      isLocal: p.id === myId,
    }));
  }

  game = new Game(engine, {
    mode: role === "solo" ? "solo" : mode,
    isHost: role === "host" || role === "solo",
    levelIndex,
    players: participants,
  });

  ui.hideAll();
  ui.showHUD();

  // Wire HUD controls.
  ui.bindHUD({
    onLeave: () => leaveGame(true),
    onCameraToggle: cycleCamera,
    onSoundToggle: toggleSound,
  });
  ui.setCameraLabel(engine.cameraMode);
  ui.setSoundLabel(sound.enabled);
  // Apply current camera mode to the freshly-built world (toggles ceiling).
  game.world?.setCameraMode?.(engine.cameraMode);
  ui.bindPause({
    onResume: () => { ui.hideAll(); ui.showHUD(); paused = false; },
    onLeave:  () => leaveGame(true),
  });
  ui.bindResults({
    onNext: () => {
      const isFinal = game.levelIndex >= 5;
      if (isFinal) { leaveGame(true); return; }
      if (role === "host" || role === "solo") {
        const next = game.levelIndex + 1;
        if (role === "host") net.sendToAll({ type: "next-level", level: next });
        ui.hideAll(); ui.showHUD();
        game.setLevel(next);
      }
      // guests will receive "next-level" message
    },
  });

  // Game events.
  game.on("score-changed", refreshHUD);
  game.on("level-changed", () => {
    refreshHUD();
    game.world?.setCameraMode?.(engine.cameraMode);
  });
  game.on("level-cleared", ({ reachedBy, time }) => {
    sound.win();
    if (role !== "guest") {
      const payload = computeResultsPayload(reachedBy, time);
      const isFinal = game.levelIndex >= 5;
      if (role === "host") net.sendToAll({ type: "level-cleared", payload, isFinal });
      showResults(payload, isFinal);
    }
  });
  game.on("powerup-collected", ({ player, kind }) => {
    sound.pickup();
    if (player.isLocal) ui.toast(`Picked up ${kind.toUpperCase()}`, "good");
  });
  game.on("door-open", ({ level }) => {
    sound.doorOpen();
    ui.toast(`Door unlocked — head for the dock!`, "good");
  });
  game.on("player-stunned", ({ player, mine }) => {
    sound.hurt();
    if (player.isLocal) {
      screenFlash("#ff3d8b", 0.45, 0.4);
      ui.toast(mine ? "Boom! Mine got you" : "Ow! Stunned for 2s", "bad");
    }
  });
  game.on("dirt-collected", () => sound.collect());
  game.on("explosion", () => sound.explode());
  game.on("mine-dropped", () => sound.mineDrop());
  game.on("turret-fired", () => sound.turretShot());
  game.on("pet-cry", ({ kind }) => sound.petCry(kind));

  // If host, push snapshots periodically.
  if (role === "host") {
    snapshotInterval = setInterval(() => {
      if (!game) return;
      net.sendToAll(game.snapshot());
    }, 80);
  }
  // If guest, push input periodically.
  if (role === "guest") {
    snapshotInterval = setInterval(() => {
      if (!game) return;
      const a = input.read();
      const action = input.consumeAction();
      net.sendToHost({ type: "input", axis: { x: a.x, y: a.y }, action });
    }, 60);
  }

  paused = false;
  refreshHUD();
}

function computeResultsPayload(reachedBy, time) {
  const players = [...game.players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, score: p.score,
  }));
  return { players, time, finishedBy: reachedBy?.id, level: game.levelIndex };
}

function showResults(payload, isFinal) {
  const sub = isFinal
    ? `You made it to the dock — ${formatTime(payload.time)}.`
    : `Cleared in ${formatTime(payload.time)}`;
  const winner = [...payload.players].sort((a, b) => b.score - a.score)[0];
  const title = isFinal
    ? "All clean!"
    : (game.opts.mode === "versus"
        ? `${winner.name} took the room`
        : `Room cleared!`);
  ui.hideHUD();
  ui.showResults({
    title, sub, players: payload.players, isFinal,
  });
}

function leaveGame(stop = false) {
  if (snapshotInterval) clearInterval(snapshotInterval);
  snapshotInterval = null;
  if (role === "host") net.sendToAll({ type: "back-to-title" });
  if (game) { game.destroy(); game = null; }
  net.destroy();
  role = "solo"; mode = "solo";
  ui.hideHUD();
  ui.show("title");
  spawnTitleVacuum();
}

// ---------- HUD ----------

function refreshHUD() {
  if (!game) return;
  const players = [...game.players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, score: p.score,
    isLocal: p.isLocal, stunned: p.stunned,
  }));
  const local = game.players.get(myId) || game.players.get(game.localPlayerId);
  ui.updateHUD({
    levelName: game.levelDef.name,
    progress: game.world ? game.world.progress() : 0,
    time: game.elapsed,
    players,
    localPlayer: local,
  });
}

// ---------- Settings: camera mode + sound ----------

const CAMERA_CYCLE = ["topdown", "third", "first"];
function cycleCamera() {
  const i = CAMERA_CYCLE.indexOf(engine.cameraMode);
  const next = CAMERA_CYCLE[(i + 1) % CAMERA_CYCLE.length];
  engine.setCameraMode(next);
  ui.setCameraLabel(next);
  game?.world?.setCameraMode?.(next);
  try { localStorage.setItem("vacman:camera", next); } catch (_) {}
  ui.toast(`Camera: ${next}`, "good");
}
function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  ui.setSoundLabel(sound.enabled);
  try { localStorage.setItem("vacman:sound", sound.enabled ? "1" : "0"); } catch (_) {}
}
// Restore prefs.
try {
  const cam = localStorage.getItem("vacman:camera");
  if (cam) engine.setCameraMode(cam);
  const snd = localStorage.getItem("vacman:sound");
  if (snd === "0") sound.setEnabled(false);
} catch (_) {}

// Keyboard shortcuts.
window.addEventListener("keydown", (e) => {
  if (e.key === "v" || e.key === "V") cycleCamera();
  else if (e.key === "m" || e.key === "M") toggleSound();
});

// ---------- Game loop integration ----------

let petCryAccum = 0;

engine.onFrame((dt) => {
  if (game && !paused) {
    if (role === "guest") {
      // Guests don't simulate — they only animate world bits and the camera.
      game.world?.update(dt, game.elapsed);
    } else {
      game.update(dt, input);
    }
    refreshHUD();

    // Drive engine drone from local input magnitude.
    const a = input.read();
    sound.setEngineSpeed(Math.hypot(a.x, a.y));

    // Random ambient pet cries (every 4-9s).
    petCryAccum += dt;
    if (petCryAccum > 4 + Math.random() * 5) {
      petCryAccum = 0;
      const pets = game.pets?.filter((p) => p.alive) || [];
      if (pets.length) {
        const p = pets[Math.floor(Math.random() * pets.length)];
        sound.petCry(p.kind);
      }
    }
  } else if (titleScene) {
    titleSceneTick(dt);
    sound.setEngineSpeed(0);
  }
  sound.tick(dt);

  if (input.consumePause() && game && !paused) {
    paused = true;
    ui.showPause();
  } else if (input.consumePause() && paused) {
    paused = false;
    ui.hideAll(); ui.showHUD();
  }
});

// ---------- Title scene background ----------
function spawnTitleVacuum() {
  if (titleScene) return;
  titleScene = new THREE.Group();
  engine.scene.add(titleScene);

  // Subtle floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x070710, roughness: 0.8 })
  );
  floor.rotation.x = -Math.PI / 2;
  titleScene.add(floor);

  // Some scattered dirt particles for vibe.
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 0),
      new THREE.MeshStandardMaterial({
        color: 0x444450, emissive: 0xffd84d, emissiveIntensity: 0.6,
        roughness: 0.6,
      })
    );
    m.position.set((Math.random() - 0.5) * 30, 0.2, (Math.random() - 0.5) * 30);
    m.userData.bob = Math.random() * Math.PI * 2;
    titleScene.add(m);
  }

  // Fleet of demo vacuums roaming.
  const brands = Object.keys(BRAND_PALETTE);
  titleScene.userData = { vacs: [], _animateVacuum: animateVacuum };
  for (let i = 0; i < 4; i++) {
    const v = buildVacuum({ brand: brands[i], color: PLAYER_COLORS[i] });
    v.position.set(Math.cos((i / 4) * Math.PI * 2) * 4, 0, Math.sin((i / 4) * Math.PI * 2) * 4);
    v.userData.angle = (i / 4) * Math.PI * 2;
    v.userData.radius = 4 + i * 0.4;
    v.userData.speed = 0.5 + i * 0.08;
    titleScene.add(v);
    titleScene.userData.vacs.push(v);
  }

  engine.cameraOffset.set(0, 16, 14);
  engine.followTarget.set(0, 0, 0);
}

function removeTitleVacuum() {
  if (!titleScene) return;
  engine.clearWorld(titleScene);
  engine.scene.remove(titleScene);
  titleScene = null;
}

function titleSceneTick(dt) {
  if (!titleScene || !titleScene.userData?.vacs) return;
  const t = performance.now() / 1000;
  for (const v of titleScene.userData.vacs) {
    v.userData.angle += dt * v.userData.speed;
    v.position.x = Math.cos(v.userData.angle) * v.userData.radius;
    v.position.z = Math.sin(v.userData.angle) * v.userData.radius;
    v.rotation.y = v.userData.angle + Math.PI / 2;
    titleScene.userData._animateVacuum?.(v, dt);
  }
  // Bob the dirt.
  for (const child of titleScene.children) {
    if (child.userData.bob !== undefined) {
      child.position.y = 0.2 + Math.sin(t * 1.5 + child.userData.bob) * 0.05;
      child.rotation.y += dt * 0.6;
    }
  }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Auto-deep-link.
if (joinCode) {
  setTimeout(() => {
    role = "guest";
    ui.show("garage");
  }, 250);
}
