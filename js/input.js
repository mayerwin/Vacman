// Input: keyboard + on-screen joystick. Produces a normalised axis vector
// and an "action" pulse when the player triggers their powerup.

export class Input {
  constructor() {
    this.keys = new Set();
    this.axis = { x: 0, y: 0 };       // -1..1 each axis
    this.actionPulse = false;          // consume in update()
    this.pausePulse = false;
    this.touchActive = false;
    this._touchOrigin = null;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k))
        e.preventDefault();
      this.keys.add(k);
      if (k === " " || k === "enter") this.actionPulse = true;
      if (k === "escape" || k === "p") this.pausePulse = true;
    };
    this._onKeyUp = (e) => { this.keys.delete(e.key.toLowerCase()); };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    // Touch joystick wiring.
    this.stick = document.getElementById("touch-stick");
    this.nub = document.getElementById("touch-nub");
    this.actionBtn = document.getElementById("touch-action");
    this.touchEl = document.getElementById("touch-controls");

    if (this.stick && this.nub) {
      const start = (e) => {
        e.preventDefault();
        const t = e.touches ? e.touches[0] : e;
        const rect = this.stick.getBoundingClientRect();
        this._touchOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        this.touchActive = true;
        this._moveStick(t.clientX, t.clientY);
      };
      const move = (e) => {
        if (!this.touchActive) return;
        e.preventDefault();
        const t = e.touches ? e.touches[0] : e;
        this._moveStick(t.clientX, t.clientY);
      };
      const end = (e) => {
        e.preventDefault();
        this.touchActive = false;
        this.axis.x = 0; this.axis.y = 0;
        this.nub.style.transform = "translate(-50%, -50%)";
      };
      this.stick.addEventListener("touchstart", start, { passive: false });
      this.stick.addEventListener("touchmove", move, { passive: false });
      this.stick.addEventListener("touchend", end);
      this.stick.addEventListener("touchcancel", end);
      this.stick.addEventListener("mousedown", start);
      window.addEventListener("mousemove", (e) => this.touchActive && move(e));
      window.addEventListener("mouseup", end);
    }
    if (this.actionBtn) {
      const fire = (e) => {
        e.preventDefault();
        this.actionPulse = true;
      };
      this.actionBtn.addEventListener("touchstart", fire, { passive: false });
      this.actionBtn.addEventListener("mousedown", fire);
    }
  }

  _moveStick(x, y) {
    const dx = x - this._touchOrigin.x;
    const dy = y - this._touchOrigin.y;
    const r = 50;
    const d = Math.hypot(dx, dy);
    const cap = Math.min(d, r);
    const nx = (dx / (d || 1)) * cap;
    const ny = (dy / (d || 1)) * cap;
    this.nub.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    this.axis.x = (dx / (d || 1)) * Math.min(d / r, 1);
    this.axis.y = (dy / (d || 1)) * Math.min(d / r, 1);
  }

  showTouch() {
    if (this.touchEl) this.touchEl.hidden = false;
  }
  hideTouch() {
    if (this.touchEl) this.touchEl.hidden = true;
  }

  // Returns { x, y } where x is right, y is down (screen-space).
  // The game converts to world (z is depth).
  read() {
    if (this.touchActive) return { x: this.axis.x, y: this.axis.y };
    let x = 0, y = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) x -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) x += 1;
    if (this.keys.has("arrowup") || this.keys.has("w")) y -= 1;
    if (this.keys.has("arrowdown") || this.keys.has("s")) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  consumeAction() {
    const v = this.actionPulse;
    this.actionPulse = false;
    return v;
  }
  consumePause() {
    const v = this.pausePulse;
    this.pausePulse = false;
    return v;
  }
}
