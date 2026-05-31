import { CONFIG } from "./config.js";
import { NetworkClient, resolveServerUrl } from "./net.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export class Game {
  constructor({ canvas, audio }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.audio = audio;
    this.network = null;
    this.callbacks = {};

    this.running = false;
    this.connected = false;

    this.world = {
      width: CONFIG.WORLD_WIDTH,
      height: CONFIG.WORLD_HEIGHT
    };

    this.view = {
      width: 0,
      height: 0,
      dpr: Math.max(1, Math.min('ontouchstart' in window ? 1 : 2, window.devicePixelRatio || 1))
    };

    this.camera = { x: this.world.width / 2, y: this.world.height / 2 };

    this.local = this.makeLocalState();
    this.remote = new Map();
    this.effects = [];
    this.particles = [];
    this.notifications = [];
    this.lastFrame = 0;
    this.lastInputSend = 0;
    this.lastPingAt = 0;
    this.fpsSamples = [];
    this.mouse = { x: 0, y: 0 };
    this.keys = { up: false, down: false, left: false, right: false };

    this.socketRoom = "arena";
    this.username = "Player";
    this.pendingAttackUntil = 0;
    this.pendingDashUntil = 0;
    this.cachedVigGrad = null;
    this.atkBtnCenter = { x: 0, y: 0 };
    this.mapData = null;        // loaded from server
    this.mode = "mp";   // "sp" | "mp"
    this.bots = [];

    // Static arena structures
    const cx = CONFIG.WORLD_WIDTH / 2;
    const cy = CONFIG.WORLD_HEIGHT / 2;
    this.structures = [
      { x: cx,       y: cy,       r: 55, fill: "rgba(255,200,50,0.25)",  stroke: "rgba(255,200,50,0.9)"  },
      { x: cx-250,   y: cy-250,   r: 32, fill: "rgba(255,80,120,0.28)",  stroke: "rgba(255,80,120,0.9)"  },
      { x: cx+250,   y: cy-250,   r: 32, fill: "rgba(80,255,180,0.28)",  stroke: "rgba(80,255,180,0.9)"  },
      { x: cx-250,   y: cy+250,   r: 32, fill: "rgba(80,180,255,0.28)",  stroke: "rgba(80,180,255,0.9)"  },
      { x: cx+250,   y: cy+250,   r: 32, fill: "rgba(255,140,40,0.28)",  stroke: "rgba(255,140,40,0.9)"  },
      { x: cx,       y: cy-320,   r: 22, fill: "rgba(200,80,255,0.28)",  stroke: "rgba(200,80,255,0.9)"  },
      { x: cx,       y: cy+320,   r: 22, fill: "rgba(200,80,255,0.28)",  stroke: "rgba(200,80,255,0.9)"  },
      { x: cx-320,   y: cy,       r: 22, fill: "rgba(80,220,255,0.28)",  stroke: "rgba(80,220,255,0.9)"  },
      { x: cx+320,   y: cy,       r: 22, fill: "rgba(80,220,255,0.28)",  stroke: "rgba(80,220,255,0.9)"  },
    ];

    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks || {};
  }

  makeLocalState() {
    return {
      id: null,
      username: "Player",
      x: this.world.width / 2,
      y: this.world.height / 2,
      vx: 0,
      vy: 0,
      angle: 0,
      hp: 100,
      stamina: 100,
      kills: 0,
      deaths: 0,
      alive: true,
      respawnAt: 0,
      attackReadyAt: 0,
      dashReadyAt: 0
    };
  }

  startMultiplayer(username, roomId) {
    this.mode = "mp";
    this.bots = [];
    this.remote.clear();
    this.username = username;
    this.socketRoom = roomId || "ns-global-online";
    this.local.username = username;
    this._resetLocal();

    this.network = new NetworkClient();
    this.bindNetwork();
    this.network.connect(username, this.socketRoom);

    this.running = true;
    this.lastFrame = performance.now();
    this.loop(this.lastFrame);
    this.callbacks.onConnection?.("connecting");
  }

  startSinglePlayer(username) {
    this.mode = "sp";
    this.username = username;
    this.socketRoom = "single-player";
    this.local.username = username;
    this._resetLocal();
    this.remote.clear();

    // Spawn bots
    this.bots = [];
    const botNames = ["CYBER-X", "GHOST-7", "NEON-K", "BLADE-9", "VOID-3"];
    const BOT_COUNT = 3;
    for (let i = 0; i < BOT_COUNT; i++) {
      const angle = (i / BOT_COUNT) * Math.PI * 2;
      const r = 280 + Math.random() * 120;
      const bot = {
        id: "bot-" + i,
        username: botNames[i % botNames.length],
        x: CONFIG.WORLD_WIDTH / 2 + Math.cos(angle) * r,
        y: CONFIG.WORLD_HEIGHT / 2 + Math.sin(angle) * r,
        targetX: CONFIG.WORLD_WIDTH / 2,
        targetY: CONFIG.WORLD_HEIGHT / 2,
        hp: 100, maxHp: 100,
        alive: true, angle: 0,
        kills: 0, deaths: 0, stamina: 100,
        _state: "WANDER",
        _wanderAngle: Math.random() * Math.PI * 2,
        _wanderTimer: 0,
        _atkCd: 0,
        _respawnTimer: 0,
        _speed: 200,
        _strafeDir: 1
      };
      this.bots.push(bot);
      this.remote.set(bot.id, bot);
    }

    this.running = true;
    this.lastFrame = performance.now();
    this.loop(this.lastFrame);
    this.callbacks.onRoom?.("Single Player");
    this.callbacks.onStats?.({
      hp: 100, stamina: 100, kills: 0, deaths: 0,
      fps: 0, room: "Single Player", players: BOT_COUNT + 1
    });
  }

  stop() {
    this.running = false;
    this.network?.disconnect?.();
    this.network = null;
    this.bots = [];
    this.remote.clear();
    this.effects = [];
    this.particles = [];
    this._resetLocal();
  }

  _resetLocal() {
    this.local.x = CONFIG.WORLD_WIDTH / 2 + (Math.random() - 0.5) * 100;
    this.local.y = CONFIG.WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 100;
    this.local.vx = 0; this.local.vy = 0;
    this.local.hp = 100; this.local.stamina = 100;
    this.local.alive = true;
    this.local.kills = 0; this.local.deaths = 0;
    this.local.id = null;
    this.camera.x = this.local.x;
    this.camera.y = this.local.y;
  }

  bindNetwork() {
    this.network.on("connect", () => {
      this.callbacks.onConnection?.("online");
    });

    this.network.on("welcome", data => {
      this.local.id = data.id;
      if (data.map) this.mapData = data.map;
      this.socketRoom = data.roomId;
      this.callbacks.onRoom?.(data.roomId);
      this.callbacks.onConnection?.("joined");
    });

    this.network.on("snapshot", snapshot => {
      this.applySnapshot(snapshot);
    });

    this.network.on("ping", ms => {
      this.callbacks.onPing?.(Math.max(0, Math.round(ms)));
    });

    this.network.socket?.on("map-update", data => {
      this.mapData = data;
      this.callbacks.onNotify?.("🗺 Map updated!");
    });

    this.network.on("disconnect", reason => {
      this.callbacks.onConnection?.(`offline: ${reason}`);
      this.running = false;
    });

    this.network.on("error", message => {
      this.callbacks.onNotify?.(message || "Connection error");
    });
  }

  bindInput() {
    window.addEventListener("keydown", e => {
      if (e.repeat) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) e.preventDefault();

      if (e.code === "KeyW") this.keys.up = true;
      if (e.code === "KeyS") this.keys.down = true;
      if (e.code === "KeyA") this.keys.left = true;
      if (e.code === "KeyD") this.keys.right = true;

      if (e.code === "Space") {
        this.requestDash();
      }
    });

    window.addEventListener("keyup", e => {
      if (e.code === "KeyW") this.keys.up = false;
      if (e.code === "KeyS") this.keys.down = false;
      if (e.code === "KeyA") this.keys.left = false;
      if (e.code === "KeyD") this.keys.right = false;
    });

    window.addEventListener("mousemove", e => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });

    window.addEventListener("mousedown", e => {
      if (e.button === 0) this.requestAttack();
    });

    window.addEventListener("contextmenu", e => e.preventDefault());

    // Touch support for mobile
    this.touchLeft = null;
    this.touchRight = null;

    this.canvas.addEventListener("touchstart", e => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        const rect = this.canvas.getBoundingClientRect();
        const tx = touch.clientX - rect.left;
        const ty = touch.clientY - rect.top;
        if (tx < this.view.width / 2) {
          this.touchLeft = { id: touch.identifier, startX: tx, startY: ty, x: tx, y: ty };
        } else {
          const atkCx = this.atkBtnCenter.x;
          const atkCy = this.atkBtnCenter.y;
          this.touchRight = { id: touch.identifier, x: tx, y: ty, startX: atkCx || tx, startY: atkCy || ty };
          this.mouse.x = tx;
          this.mouse.y = ty;
          this.requestAttack();
        }
      }
    }, { passive: false });

    this.canvas.addEventListener("touchmove", e => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        const rect = this.canvas.getBoundingClientRect();
        const tx = touch.clientX - rect.left;
        const ty = touch.clientY - rect.top;
        if (this.touchLeft && touch.identifier === this.touchLeft.id) {
          this.touchLeft.x = tx;
          this.touchLeft.y = ty;
        } else if (!this.touchLeft && tx < this.view.width / 2) {
          // Auto-recover: touch still active but touchLeft was lost (toast/cancel)
          this.touchLeft = { id: touch.identifier, startX: tx, startY: ty, x: tx, y: ty };
        } else if (this.touchRight && touch.identifier === this.touchRight.id) {
          this.touchRight.x = tx;
          this.touchRight.y = ty;
          const ddx = tx - this.touchRight.startX;
          const ddy = ty - this.touchRight.startY;
          const dist = Math.hypot(ddx, ddy);
          if (dist > 12) {
            // Aim in drag direction from button center
            this.mouse.x = this.view.width / 2 + (ddx / dist) * 120;
            this.mouse.y = this.view.height / 2 + (ddy / dist) * 120;
            this.requestAttack();
          }
        }
      }
    }, { passive: false });

    this.canvas.addEventListener("touchend", e => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (this.touchLeft && touch.identifier === this.touchLeft.id) {
          this.touchLeft = null;
          this.keys.up = false;
          this.keys.down = false;
          this.keys.left = false;
          this.keys.right = false;
        } else if (this.touchRight && touch.identifier === this.touchRight.id) {
          this.touchRight = null;
        }
      }
    }, { passive: false });
  }

  requestAttack() {
    const now = performance.now();
    if (now < this.pendingAttackUntil) return;
    this.pendingAttackUntil = now + 300;

    this.audio.attack();
    this.spawnSlash(this.local.x, this.local.y, this.local.angle, true);

    if (this.mode === "sp") {
      this._spAttack();
    } else {
      this.network?.sendAction("attack");
    }
  }

  _spAttack() {
    if (!this.local.alive) return;
    const RANGE = 275;
    const angle = this.local.angle;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const dx = bot.x - this.local.x;
      const dy = bot.y - this.local.y;
      const dist = Math.hypot(dx, dy);
      if (dist > RANGE) continue;
      const va = Math.atan2(dy, dx);
      let diff = Math.abs(va - angle);
      while (diff > Math.PI) diff -= Math.PI * 2;
      diff = Math.abs(diff);
      if (diff > 0.85) continue;
      const dmg = 30;
      bot.hp -= dmg;
      // Knockback
      if (dist > 0) { bot.x += (dx / dist) * 50; bot.y += (dy / dist) * 50; }
      if (bot.hp <= 0) {
        bot.hp = 0;
        bot.alive = false;
        bot.deaths++;
        bot._respawnTimer = 3000;
        this.local.kills++;
        this.pushFeed("You eliminated " + bot.username);
        this.toast("⚔ Eliminated " + bot.username);
      }
    }
  }

  _spLocalDamage(amount, attackerName) {
    if (!this.local.alive) return;
    this.local.hp = Math.max(0, this.local.hp - amount);
    if (this.local.hp <= 0) {
      this.local.alive = false;
      this.local.deaths++;
      this.pushFeed(attackerName + " eliminated you");
      this.toast("💀 Eliminated by " + attackerName);
      setTimeout(() => {
        if (!this.running) return;
        this.local.hp = 100;
        this.local.alive = true;
        this.local.x = CONFIG.WORLD_WIDTH / 2 + (Math.random() - 0.5) * 160;
        this.local.y = CONFIG.WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 160;
        this.toast("Respawned!");
      }, 3000);
    }
  }

  updateBots(dt) {
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot._respawnTimer -= dt * 1000;
        if (bot._respawnTimer <= 0) {
          bot.alive = true;
          bot.hp = bot.maxHp;
          bot.x = CONFIG.WORLD_WIDTH / 2 + (Math.random() - 0.5) * 400;
          bot.y = CONFIG.WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 400;
          bot._state = "WANDER";
        }
        continue;
      }

      bot._atkCd = Math.max(0, bot._atkCd - dt);

      const dx = this.local.x - bot.x;
      const dy = this.local.y - bot.y;
      const dist = Math.hypot(dx, dy) || 1;

      const ATCK = 220, CHASE = 480;

      if (dist < ATCK)       bot._state = "ATTACK";
      else if (dist < CHASE) bot._state = "CHASE";
      else                   bot._state = "WANDER";

      if (bot._state === "WANDER") {
        bot._wanderTimer -= dt;
        if (bot._wanderTimer <= 0) {
          bot._wanderAngle = Math.random() * Math.PI * 2;
          bot._wanderTimer = 1.2 + Math.random() * 1.5;
        }
        bot.x += Math.cos(bot._wanderAngle) * bot._speed * dt;
        bot.y += Math.sin(bot._wanderAngle) * bot._speed * dt;
        bot.angle = bot._wanderAngle;
      } else if (bot._state === "CHASE") {
        bot.angle = Math.atan2(dy, dx);
        bot.x += Math.cos(bot.angle) * bot._speed * dt;
        bot.y += Math.sin(bot.angle) * bot._speed * dt;
      } else {
        // Attack state: circle-strafe + attack
        bot.angle = Math.atan2(dy, dx);
        const strafeA = bot.angle + Math.PI / 2 * bot._strafeDir;
        bot.x += Math.cos(strafeA) * bot._speed * 0.5 * dt;
        bot.y += Math.sin(strafeA) * bot._speed * 0.5 * dt;
        bot.x += Math.cos(bot.angle) * bot._speed * 0.15 * dt;
        bot.y += Math.sin(bot.angle) * bot._speed * 0.15 * dt;

        // Change strafe dir occasionally
        if (Math.random() < 0.008) bot._strafeDir *= -1;

        if (bot._atkCd <= 0 && this.local.alive) {
          bot._atkCd = 1.1;
          this._spLocalDamage(11, bot.username);
          this.spawnSlash(bot.x, bot.y, bot.angle, false);
        }
      }

      bot.x = Math.max(80, Math.min(CONFIG.WORLD_WIDTH  - 80, bot.x));
      bot.y = Math.max(80, Math.min(CONFIG.WORLD_HEIGHT - 80, bot.y));
      bot.targetX = bot.x;
      bot.targetY = bot.y;
    }
  }

  requestDash() {
    const now = performance.now();
    if (now < this.pendingDashUntil) return;
    this.pendingDashUntil = now + 900;

    this.audio.dash();
    this.spawnDashBurst(this.local.x, this.local.y, this.local.angle);
    this.network?.sendAction("dash");
  }

  applySnapshot(snapshot) {
    const now = performance.now();

    if (snapshot.roomId) {
      this.socketRoom = snapshot.roomId;
      this.callbacks.onRoom?.(snapshot.roomId);
    }

    const online = snapshot.playerCount || 0;
    this.callbacks.onPlayers?.(online);

    if (Array.isArray(snapshot.leaderboard)) {
      this.callbacks.onLeaderboard?.(snapshot.leaderboard);
    }

    const map = new Map();
    for (const p of snapshot.players || []) {
      map.set(p.id, p);
      if (p.id === this.local.id) {
        this.local.username = p.username;
        this.local.x += (p.x - this.local.x) * CONFIG.SNAPSHOT_SMOOTHING;
        this.local.y += (p.y - this.local.y) * CONFIG.SNAPSHOT_SMOOTHING;
        this.local.vx = p.vx;
        this.local.vy = p.vy;
        this.local.angle = p.angle;
        this.local.hp = p.hp;
        this.local.stamina = p.stamina;
        this.local.kills = p.kills;
        this.local.deaths = p.deaths;
        this.local.alive = p.alive;
        this.local.respawnAt = p.respawnAt;
      } else {
        if (!this.remote.has(p.id)) {
          this.remote.set(p.id, {
            id: p.id,
            username: p.username,
            x: p.x,
            y: p.y,
            targetX: p.x,
            targetY: p.y,
            vx: p.vx,
            vy: p.vy,
            angle: p.angle,
            targetAngle: p.angle,
            hp: p.hp,
            stamina: p.stamina,
            kills: p.kills,
            deaths: p.deaths,
            alive: p.alive,
            respawnAt: p.respawnAt,
            dashing: p.dashing
          });
        } else {
          const r = this.remote.get(p.id);
          r.targetX = p.x;
          r.targetY = p.y;
          r.targetAngle = p.angle;
          r.vx = p.vx;
          r.vy = p.vy;
          r.hp = p.hp;
          r.stamina = p.stamina;
          r.kills = p.kills;
          r.deaths = p.deaths;
          r.alive = p.alive;
          r.respawnAt = p.respawnAt;
          r.dashing = p.dashing;
          r.username = p.username;
        }
      }
    }

    for (const id of [...this.remote.keys()]) {
      if (!map.has(id)) this.remote.delete(id);
    }

    for (const ev of snapshot.events || []) {
      this.handleEvent(ev, now);
    }
  }

  handleEvent(ev, now) {
    if (ev.type === "attack") {
      this.spawnSlash(ev.x, ev.y, ev.angle, false);
    }

    if (ev.type === "dash") {
      this.spawnDashBurst(ev.x, ev.y, ev.angle);
    }

    if (ev.type === "hit") {
      this.spawnHit(ev.x, ev.y);
      this.audio.hit();
    }

    if (ev.type === "kill") {
      this.audio.death();
      this.pushFeed(`${ev.attackerName} eliminated ${ev.victimName}`);
      this.toast(`Elimination: ${ev.attackerName} → ${ev.victimName}`);
    }

    if (ev.type === "join") {
      this.toast(`${ev.username} joined`);
    }

    if (ev.type === "leave") {
      this.toast(`${ev.username} left`);
    }

    if (ev.type === "respawn") {
      this.toast(`${ev.username} respawned`);
    }
  }

  updateLocal(dt) {
    const now = performance.now();

    // Joystick sync FIRST — before any alive check so keys are always current
    if (this.touchLeft) {
      const dx = this.touchLeft.x - this.touchLeft.startX;
      const dy = this.touchLeft.y - this.touchLeft.startY;
      const dead = 18;
      this.keys.left  = dx < -dead;
      this.keys.right = dx >  dead;
      this.keys.up    = dy < -dead;
      this.keys.down  = dy >  dead;
    }

    if (!this.local.alive) return;

    const ix = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const iy = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0);

    let len = Math.hypot(ix, iy);
    let mx = 0;
    let my = 0;
    if (len > 0) {
      mx = ix / len;
      my = iy / len;
    }

    const speed = 260;
    const targetVx = mx * speed;
    const targetVy = my * speed;
    const smooth = 11 * dt;

    this.local.vx += (targetVx - this.local.vx) * smooth;
    this.local.vy += (targetVy - this.local.vy) * smooth;

    const friction = Math.max(0, 1 - 3.0 * dt);
    this.local.vx *= friction;
    this.local.vy *= friction;

    this.local.x += this.local.vx * dt;
    this.local.y += this.local.vy * dt;

    this.local.x = clamp(this.local.x, 40, this.world.width - 40);
    this.local.y = clamp(this.local.y, 40, this.world.height - 40);

    const angle = Math.atan2(
      this.mouse.y - this.view.height / 2,
      this.mouse.x - this.view.width / 2
    );
    if (Number.isFinite(angle)) this.local.angle = angle;

    this.local.stamina = clamp(this.local.stamina + 14 * dt, 0, 100);

    if (now < this.pendingAttackUntil - 220) {
      this.spawnAmbientTrail(this.local.x, this.local.y, this.local.angle);
    }
  }

  updateRemote(dt) {
    for (const player of this.remote.values()) {
      player.x += (player.targetX - player.x) * 0.18;
      player.y += (player.targetY - player.y) * 0.18;
      player.angle += (player.targetAngle - player.angle) * 0.18;
    }
  }

  updateCamera(dt) {
    const targetX = this.local.x;
    const targetY = this.local.y;
    const k = 1 - Math.exp(-8 * dt);
    this.camera.x += (targetX - this.camera.x) * k;
    this.camera.y += (targetY - this.camera.y) * k;
  }

  updateEffects(dt) {
    this.effects = this.effects.filter(effect => {
      effect.life += dt;
      return effect.life < effect.maxLife;
    });

    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 1.8 * dt);
      p.vy *= Math.max(0, 1 - 1.8 * dt);
    }

    this.particles = this.particles.filter(p => p.life < p.maxLife);
  }

  updateFps(dt) {
    this.fpsSamples.push(1 / Math.max(dt, 0.00001));
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    const playerCount = this.mode === "sp"
      ? this.bots.length + 1
      : this.remote.size + (this.local.id ? 1 : 0);

    // SP leaderboard
    if (this.mode === "sp") {
      const lb = [
        { username: this.local.username, kills: this.local.kills, deaths: this.local.deaths },
        ...this.bots.map(b => ({ username: b.username, kills: b.kills, deaths: b.deaths }))
      ].sort((a, b) => b.kills - a.kills);
      this.callbacks.onLeaderboard?.(lb);
      this.callbacks.onRoom?.("Single Player");
    }

    this.callbacks.onStats?.({
      hp: this.local.hp,
      stamina: this.local.stamina,
      kills: this.local.kills,
      deaths: this.local.deaths,
      fps: Math.round(avg || 0),
      room: this.mode === "sp" ? "Single Player" : this.socketRoom,
      players: playerCount
    });
  }

  syncInput(now) {
    if (now - this.lastInputSend < CONFIG.INPUT_SEND_RATE) return;
    this.lastInputSend = now;

    this.network?.sendInput({
      up: this.keys.up,
      down: this.keys.down,
      left: this.keys.left,
      right: this.keys.right,
      angle: this.local.angle
    });
  }

  tick(dt, now) {
    this.updateLocal(dt);

    if (this.mode === "sp") {
      this.updateBots(dt);
    } else {
      this.updateRemote(dt);
      this.syncInput(now);
      if (now - this.lastPingAt > CONFIG.PING_INTERVAL) {
        this.lastPingAt = now;
        this.network?.ping();
      }
    }

    this.updateCamera(dt);
    this.updateEffects(dt);
    this.updateFps(dt);
  }

  loop = (now) => {
    if (!this.running) return;
    const dt = Math.min(0.033, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;

    this.tick(dt, now);
    this.render();

    requestAnimationFrame(this.loop);
  };

  resize() {
    this.cachedVigGrad = null;
    this.view.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.view.width = window.innerWidth;
    this.view.height = window.innerHeight;

    this.canvas.width = Math.floor(this.view.width * this.view.dpr);
    this.canvas.height = Math.floor(this.view.height * this.view.dpr);
    this.canvas.style.width = `${this.view.width}px`;
    this.canvas.style.height = `${this.view.height}px`;

    this.ctx.setTransform(this.view.dpr, 0, 0, this.view.dpr, 0, 0);
  }

  worldToScreen(x, y) {
    return {
      x: x - this.camera.x + this.view.width / 2,
      y: y - this.camera.y + this.view.height / 2
    };
  }

  drawGrid() {
    const ctx = this.ctx;
    const step = 80;
    const left  = this.camera.x - this.view.width  / 2 - step * 2;
    const right  = this.camera.x + this.view.width  / 2 + step * 2;
    const top    = this.camera.y - this.view.height / 2 - step * 2;
    const bottom = this.camera.y + this.view.height / 2 + step * 2;
    ctx.save();
    ctx.lineWidth = 1;

    // Batch minor lines (one path)
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    for (let x = Math.floor(left/step)*step; x <= right; x += step) {
      if (x % 320 === 0) continue;
      const p1 = this.worldToScreen(x, top);
      const p2 = this.worldToScreen(x, bottom);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
    for (let y = Math.floor(top/step)*step; y <= bottom; y += step) {
      if (y % 320 === 0) continue;
      const p1 = this.worldToScreen(left, y);
      const p2 = this.worldToScreen(right, y);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Batch major lines (one path)
    ctx.strokeStyle = "rgba(69,243,255,0.13)";
    ctx.beginPath();
    for (let x = Math.floor(left/step)*step; x <= right; x += step) {
      if (x % 320 !== 0) continue;
      const p1 = this.worldToScreen(x, top);
      const p2 = this.worldToScreen(x, bottom);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
    for (let y = Math.floor(top/step)*step; y <= bottom; y += step) {
      if (y % 320 !== 0) continue;
      const p1 = this.worldToScreen(left, y);
      const p2 = this.worldToScreen(right, y);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    ctx.restore();
  }

  drawArena() {
    const ctx = this.ctx;
    const c = this.worldToScreen(this.world.width / 2, this.world.height / 2);
    const R = 1040;
    ctx.save();

    // Coloured quadrant zones
    const zones = [
      { a0: -Math.PI/2,   a1: 0,           color: "rgba(255,80,120,0.055)" },
      { a0: 0,            a1: Math.PI/2,    color: "rgba(80,255,180,0.055)" },
      { a0: Math.PI/2,    a1: Math.PI,      color: "rgba(80,180,255,0.055)" },
      { a0: Math.PI,      a1: 3*Math.PI/2,  color: "rgba(255,200,50,0.055)" },
    ];
    for (const z of zones) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.arc(c.x, c.y, R, z.a0, z.a1);
      ctx.closePath();
      ctx.fillStyle = z.color;
      ctx.fill();
    }

    // Zone divider lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let a = 0; a < Math.PI*2; a += Math.PI/2) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(a)*R, c.y + Math.sin(a)*R);
      ctx.stroke();
    }

    // Outer glow ring
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(69,243,255,0.18)";
    ctx.shadowColor = "rgba(69,243,255,0.6)";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R - 24, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  drawStructures() {
    const ctx = this.ctx;
    ctx.save();
    for (const s of this.structures) {
      const p = this.worldToScreen(s.x, s.y);
      ctx.shadowColor = s.stroke;
      ctx.shadowBlur = 16;
      ctx.fillStyle = s.fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawPlayerIndicators() {
    const ctx = this.ctx;
    const W = this.view.width;
    const H = this.view.height;
    const margin = 28;
    ctx.save();
    for (const player of this.remote.values()) {
      if (!player.alive) continue;
      const s = this.worldToScreen(player.x, player.y);
      if (s.x > margin && s.x < W - margin && s.y > margin && s.y < H - margin) continue;
      const dx = s.x - W / 2;
      const dy = s.y - H / 2;
      const angle = Math.atan2(dy, dx);
      const tx = Math.abs((W / 2 - margin) / (Math.cos(angle) || 0.0001));
      const ty = Math.abs((H / 2 - margin) / (Math.sin(angle) || 0.0001));
      const t = Math.min(tx, ty);
      const ex = clamp(W / 2 + Math.cos(angle) * t, margin, W - margin);
      const ey = clamp(H / 2 + Math.sin(angle) * t, margin, H - margin);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(angle);
      ctx.shadowColor = "rgba(168,85,247,0.9)";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "rgba(168,85,247,0.95)";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -6);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 6);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-angle);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      const dist = Math.round(Math.hypot(player.x - this.local.x, player.y - this.local.y));
      ctx.fillText(player.username + " " + dist + "u", 0, 24);
      ctx.restore();
    }
    ctx.restore();
  }

  drawBackgroundVignette() {
    if (!this.cachedVigGrad) {
      const g = this.ctx.createRadialGradient(
        this.view.width / 2, this.view.height / 2, 120,
        this.view.width / 2, this.view.height / 2,
        Math.max(this.view.width, this.view.height) * 0.75
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      this.cachedVigGrad = g;
    }
    this.ctx.fillStyle = this.cachedVigGrad;
    this.ctx.fillRect(0, 0, this.view.width, this.view.height);
  }

  drawParticle(p) {
    const s = this.worldToScreen(p.x, p.y);
    const alpha = 1 - p.life / p.maxLife;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawEffect(effect) {
    const ctx = this.ctx;
    const t = effect.life / effect.maxLife;

    if (effect.type === "slash") {
      const s = this.worldToScreen(effect.x, effect.y);
      const radius = 42 + t * 28;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(effect.angle);
      ctx.strokeStyle = effect.local ? "rgba(69,243,255,0.95)" : "rgba(168,85,247,0.9)";
      ctx.shadowColor = effect.local ? "rgba(69,243,255,0.8)" : "rgba(168,85,247,0.8)";
      ctx.shadowBlur = 22;
      ctx.lineWidth = 8 * (1 - t);
      ctx.beginPath();
      ctx.arc(0, 0, radius, -0.9, 0.9);
      ctx.stroke();
      ctx.restore();
    }

    if (effect.type === "burst") {
      const s = this.worldToScreen(effect.x, effect.y);
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = "rgba(69,243,255,0.8)";
      ctx.shadowColor = "rgba(69,243,255,0.8)";
      ctx.shadowBlur = 20;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12 + t * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPlayer(player, isLocal = false) {
    const ctx = this.ctx;
    const s = this.worldToScreen(player.x, player.y);
    const deadAlpha = player.alive === false ? 0.35 : 1;
    const color = isLocal ? "rgba(69,243,255,1)" : "rgba(168,85,247,1)";

    ctx.save();
    ctx.globalAlpha = deadAlpha;
    ctx.translate(s.x, s.y);

    const glow = isLocal ? "rgba(69,243,255,0.8)" : "rgba(168,85,247,0.8)";
    ctx.shadowColor = glow;
    ctx.shadowBlur = isLocal ? 18 : 8;

    ctx.fillStyle = "rgba(4,8,14,0.95)";
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(player.angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(22, 0);
    ctx.stroke();

    ctx.restore();

    const hpWidth = 34;
    const hpX = s.x - hpWidth / 2;
    const hpY = s.y - 34;
    const hpPct = clamp((player.hp || 0) / 100, 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(hpX, hpY, hpWidth, 5);
    ctx.fillStyle = isLocal ? "rgba(69,243,255,0.95)" : "rgba(255,77,140,0.95)";
    ctx.fillRect(hpX, hpY, hpWidth * hpPct, 5);
    ctx.restore();

    if (!isLocal) {
      ctx.save();
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(237,247,255,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fillText(player.username, s.x, s.y - 44);
      ctx.restore();
    }
  }

  drawCrosshair() {
    const ctx = this.ctx;
    const x = this.mouse.x;
    const y = this.mouse.y;
    ctx.save();
    ctx.strokeStyle = "rgba(69,243,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(69,243,255,0.8)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
    ctx.restore();
  }

  drawFog() {
    const ctx = this.ctx;
    const corners = [
      [0, 0],
      [this.view.width, 0],
      [0, this.view.height],
      [this.view.width, this.view.height]
    ];
    ctx.save();
    for (const [x, y] of corners) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 280);
      g.addColorStop(0, "rgba(69,243,255,0.05)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 300, y - 300, 600, 600);
    }
    ctx.restore();
  }

  render() {
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.view.width, this.view.height);
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, this.view.width, this.view.height);

    this.drawGrid();
    this.drawArena();
    this.drawStructures();

    for (const effect of this.effects) this.drawEffect(effect);
    for (const p of this.particles) this.drawParticle(p);

    for (const player of this.remote.values()) {
      this.drawPlayer(player, false);
    }

    this.drawPlayer(this.local, true);
    this.drawFog();
    this.drawBackgroundVignette();
    this.drawPlayerIndicators();
    this.drawCrosshair();
    this.drawTouchControls();
  }

  spawnParticle(x, y, vx, vy, color, life = 0.45, size = 2) {
    this.particles.push({
      x,
      y,
      vx,
      vy,
      color,
      life: 0,
      maxLife: life,
      size
    });

    if (this.particles.length > 260) {
      this.particles.splice(0, this.particles.length - 260);
    }
  }

  spawnSlash(x, y, angle, local) {
    this.effects.push({
      type: "slash",
      x,
      y,
      angle,
      local,
      life: 0,
      maxLife: 0.24
    });

    for (let i = 0; i < 10; i++) {
      const a = angle + (Math.random() - 0.5) * 0.7;
      const speed = 80 + Math.random() * 260;
      this.spawnParticle(
        x + Math.cos(angle) * 22,
        y + Math.sin(angle) * 22,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        local ? "rgba(69,243,255,0.9)" : "rgba(168,85,247,0.9)",
        0.35,
        1.8
      );
    }
  }

  spawnDashBurst(x, y, angle) {
    this.effects.push({
      type: "burst",
      x,
      y,
      angle,
      life: 0,
      maxLife: 0.28
    });

    for (let i = 0; i < 16; i++) {
      const a = angle + Math.PI + (Math.random() - 0.5) * 0.7;
      const speed = 70 + Math.random() * 240;
      this.spawnParticle(
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        "rgba(69,243,255,0.9)",
        0.42,
        1.8
      );
    }
  }

  spawnHit(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 200;
      this.spawnParticle(
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        "rgba(255,255,255,0.95)",
        0.28,
        1.5
      );
    }
    this.effects.push({
      type: "burst",
      x,
      y,
      angle: 0,
      life: 0,
      maxLife: 0.18
    });
  }

  drawTouchControls() {
    if (!('ontouchstart' in window)) return;
    const ctx = this.ctx;
    const r = 50;
    const cx = r + 75;
    const cy = this.view.height - r - 30;
    const acx = this.view.width - r - 30;
    const acy = this.view.height - r - 30;
    this.atkBtnCenter.x = acx;
    this.atkBtnCenter.y = acy;

    ctx.save();
    ctx.globalAlpha = 0.25;

    // Left joystick base
    ctx.strokeStyle = 'rgba(69,243,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Left joystick knob
    if (this.touchLeft) {
      const kx = cx + (this.touchLeft.x - this.touchLeft.startX);
      const ky = cy + (this.touchLeft.y - this.touchLeft.startY);
      ctx.fillStyle = 'rgba(69,243,255,0.6)';
      ctx.beginPath();
      ctx.arc(kx, ky, 22, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(69,243,255,0.4)';
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Right attack button
    ctx.strokeStyle = 'rgba(255,77,140,0.8)';
    ctx.beginPath();
    ctx.arc(acx, acy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = this.touchRight ? 'rgba(255,77,140,0.5)' : 'rgba(255,77,140,0.2)';
    ctx.beginPath();
    ctx.arc(acx, acy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.6;
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MOVE', cx, cy + 4);
    ctx.fillText('ATK', acx, acy + 4);

    ctx.restore();
  }

  spawnAmbientTrail(x, y, angle) {
    if (Math.random() > 0.42) return;
    const back = angle + Math.PI;
    this.spawnParticle(
      x + Math.cos(back) * 10,
      y + Math.sin(back) * 10,
      Math.cos(back) * (10 + Math.random() * 30),
      Math.sin(back) * (10 + Math.random() * 30),
      "rgba(69,243,255,0.6)",
      0.2,
      1.2
    );
  }

  pushFeed(text) {
    this.callbacks.onFeed?.(text);
  }

  toast(text) {
    this.callbacks.onNotify?.(text);
  }
}