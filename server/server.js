const express = require("express");
const http    = require("http");
const path    = require("path");
const fs      = require("fs");
const { Server } = require("socket.io");

// ── Load game map ─────────────────────────────────────────────────────────────
const MAP_PATH = path.join(__dirname, "map.json");
let GAME_MAP = null;
try {
  GAME_MAP = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
  console.log(`Map loaded: "${GAME_MAP.name}" — ${GAME_MAP.objects?.length || 0} objects`);
} catch {
  console.log("No map.json found — running with empty map. Export one from the Map Editor.");
}

// Build a set of solid object types for collision
const SOLID_TYPES = new Set([
  "house","house_s","shed","tower","ruin",
  "wall_h","wall_v","wall_c",
  "fence_h","fence_v","gate",
  "rock","bigrock","water","pond",
  "barrier","barrier_v","cover",
  "pit","lava"
]);

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, "../client");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(CLIENT_DIR));

// Hot-reload map via POST /api/load-map
app.use(express.json({ limit: "2mb" }));
app.post("/api/load-map", (req, res) => {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.objects)) return res.status(400).json({ error: "Invalid map data" });
    GAME_MAP = data;
    fs.writeFileSync(MAP_PATH, JSON.stringify(data, null, 2));
    // Broadcast new map to all connected clients
    io.emit("map-update", GAME_MAP);
    console.log(`Map updated: "${GAME_MAP.name}" — ${GAME_MAP.objects.length} objects`);
    res.json({ ok: true, name: GAME_MAP.name, objects: GAME_MAP.objects.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/map", (_req, res) => {
  res.json(GAME_MAP || { objects: [] });
});

app.get("/health", (_, res) => {
  res.json({ ok: true, name: "NS Arena Server", time: Date.now() });
});

const WORLD = {
  width: 2400,
  height: 2400
};

const RULES = {
  maxHp: 100,
  maxStamina: 100,
  moveSpeed: 260,
  dashSpeed: 760,
  dashDuration: 120,
  dashCooldown: 900,
  dashCost: 25,
  attackCooldown: 420,
  attackCost: 18,
  attackRange: 275,
  attackDamage: 30,
  knockback: 320,
  respawnDelay: 3000,
  staminaRegenPerSec: 14
};

const rooms = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function sanitizeName(name) {
  const clean = String(name || "Player")
    .replace(/[^\w\s\-_.]/g, "")
    .trim()
    .slice(0, 18);
  return clean || "Player";
}

function makeRoom(roomId) {
  return {
    id: roomId,
    players: new Map(),
    events: [],
    lastBroadcast: 0
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, makeRoom(roomId));
  }
  return rooms.get(roomId);
}

function randomSpawn() {
  const cx = WORLD.width / 2;
  const cy = WORLD.height / 2;
  const spread = 120;
  return {
    x: rand(cx - spread, cx + spread),
    y: rand(cy - spread, cy + spread)
  };
}

function makePlayer(socketId, username) {
  const spawn = randomSpawn();
  return {
    id: socketId,
    username: sanitizeName(username),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: RULES.maxHp,
    stamina: RULES.maxStamina,
    kills: 0,
    deaths: 0,
    alive: true,
    respawnAt: 0,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      angle: 0
    },
    pendingAttack: false,
    pendingDash: false,
    attackReadyAt: 0,
    dashReadyAt: 0,
    dashUntil: 0,
    lastInputAt: 0,
    lastActionAt: 0,
    lastSnapshotSeq: 0
  };
}

function publicPlayer(p) {
  return {
    id: p.id,
    username: p.username,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    angle: p.angle,
    hp: p.hp,
    stamina: p.stamina,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive,
    respawnAt: p.respawnAt,
    dashing: Date.now() < p.dashUntil
  };
}

function leaderboard(room) {
  return [...room.players.values()]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.username.localeCompare(b.username))
    .slice(0, 8)
    .map(p => ({
      id: p.id,
      username: p.username,
      kills: p.kills,
      deaths: p.deaths,
      hp: p.hp,
      alive: p.alive
    }));
}

function normalizeAngleDiff(a, b) {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function dealDamage(room, attacker, victim, now, dirX, dirY) {
  if (!victim.alive) return false;

  victim.hp -= RULES.attackDamage;
  victim.vx += dirX * RULES.knockback;
  victim.vy += dirY * RULES.knockback;

  room.events.push({
    type: "hit",
    attackerId: attacker.id,
    victimId: victim.id,
    x: victim.x,
    y: victim.y,
    hp: Math.max(0, victim.hp),
    time: now
  });

  if (victim.hp <= 0) {
    victim.alive = false;
    victim.respawnAt = now + RULES.respawnDelay;
    victim.deaths += 1;
    attacker.kills += 1;

    room.events.push({
      type: "kill",
      attackerId: attacker.id,
      victimId: victim.id,
      attackerName: attacker.username,
      victimName: victim.username,
      time: now
    });
    return true;
  }

  return false;
}

function processAttack(room, player, now) {
  if (!player.alive) return;
  if (now < player.attackReadyAt) return;
  if (player.stamina < RULES.attackCost) return;

  player.attackReadyAt = now + RULES.attackCooldown;
  player.stamina = clamp(player.stamina - RULES.attackCost, 0, RULES.maxStamina);

  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  const victims = [];

  for (const other of room.players.values()) {
    if (other.id === player.id || !other.alive) continue;

    const dx = other.x - player.x;
    const dy = other.y - player.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > RULES.attackRange * RULES.attackRange) continue;

    const victimAngle = Math.atan2(dy, dx);
    const diff = Math.abs(normalizeAngleDiff(victimAngle, player.angle));
    if (diff > 0.85) continue;

    victims.push({
      victim: other,
      dx,
      dy,
      dist: Math.sqrt(distSq)
    });
  }

  room.events.push({
    type: "attack",
    attackerId: player.id,
    x: player.x,
    y: player.y,
    angle: player.angle,
    time: now
  });

  for (const item of victims) {
    const nx = item.dist > 0 ? item.dx / item.dist : 0;
    const ny = item.dist > 0 ? item.dy / item.dist : 0;
    dealDamage(room, player, item.victim, now, nx, ny);
  }
}

function processDash(room, player, now) {
  if (!player.alive) return;
  if (now < player.dashReadyAt) return;
  if (player.stamina < RULES.dashCost) return;

  player.dashReadyAt = now + RULES.dashCooldown;
  player.dashUntil = now + RULES.dashDuration;
  player.stamina = clamp(player.stamina - RULES.dashCost, 0, RULES.maxStamina);

  const dx = Math.cos(player.angle);
  const dy = Math.sin(player.angle);
  player.vx += dx * RULES.dashSpeed;
  player.vy += dy * RULES.dashSpeed;

  room.events.push({
    type: "dash",
    playerId: player.id,
    x: player.x,
    y: player.y,
    angle: player.angle,
    time: now
  });
}

function respawnIfNeeded(room, player, now) {
  if (player.alive) return;
  if (now < player.respawnAt) return;

  const spawn = randomSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.hp = RULES.maxHp;
  player.stamina = RULES.maxStamina;
  player.alive = true;
  player.respawnAt = 0;
  player.attackReadyAt = now + 300;
  player.dashReadyAt = now + 500;

  room.events.push({
    type: "respawn",
    playerId: player.id,
    username: player.username,
    x: player.x,
    y: player.y,
    time: now
  });
}

function updateRoom(room, dt, now) {
  for (const player of room.players.values()) {
    respawnIfNeeded(room, player, now);

    if (!player.alive) {
      continue;
    }

    player.angle = Number.isFinite(player.input.angle) ? player.input.angle : player.angle;

    if (player.pendingDash) {
      processDash(room, player, now);
      player.pendingDash = false;
    }

    if (player.pendingAttack) {
      processAttack(room, player, now);
      player.pendingAttack = false;
    }

    const ix = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
    const iy = (player.input.down ? 1 : 0) - (player.input.up ? 1 : 0);

    let len = Math.hypot(ix, iy);
    let mx = 0;
    let my = 0;
    if (len > 0) {
      mx = ix / len;
      my = iy / len;
    }

    const targetSpeed = RULES.moveSpeed;
    const targetVx = mx * targetSpeed;
    const targetVy = my * targetSpeed;

    const accel = 12.5 * dt;
    player.vx += (targetVx - player.vx) * accel;
    player.vy += (targetVy - player.vy) * accel;

    const friction = Math.max(0, 1 - 3.2 * dt);
    player.vx *= friction;
    player.vy *= friction;

    if (Date.now() < player.dashUntil) {
      player.vx += Math.cos(player.angle) * 1200 * dt;
      player.vy += Math.sin(player.angle) * 1200 * dt;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    player.x = clamp(player.x, 40, WORLD.width - 40);
    player.y = clamp(player.y, 40, WORLD.height - 40);

    player.stamina = clamp(player.stamina + RULES.staminaRegenPerSec * dt, 0, RULES.maxStamina);
  }
}

function broadcastRoom(room, now) {
  const players = [...room.players.values()].map(publicPlayer);
  io.to(room.id).emit("room-state", {
    roomId: room.id,
    now,
    players,
    leaderboard: leaderboard(room),
    playerCount: players.length,
    events: room.events.splice(0, room.events.length)
  });
}

io.on("connection", socket => {
  let room = null;
  let player = null;

  socket.on("join-game", payload => {
    const roomId = sanitizeName(payload?.roomId || "arena").toLowerCase().slice(0, 16);
    const username = sanitizeName(payload?.username || "Player");

    room = getRoom(roomId);
    player = makePlayer(socket.id, username);
    room.players.set(socket.id, player);
    socket.join(room.id);

    socket.emit("welcome", {
      id: socket.id,
      roomId: room.id,
      world: WORLD,
      rules: RULES,
      map: GAME_MAP
    });

    room.events.push({
      type: "join",
      playerId: socket.id,
      username: player.username,
      time: Date.now()
    });
  });

  socket.on("input", payload => {
    if (!room || !player) return;

    const now = Date.now();
    if (now - player.lastInputAt < 8) return;
    player.lastInputAt = now;

    player.input.up = !!payload?.up;
    player.input.down = !!payload?.down;
    player.input.left = !!payload?.left;
    player.input.right = !!payload?.right;

    if (Number.isFinite(payload?.angle)) {
      player.input.angle = payload.angle;
    }
  });

  socket.on("action", payload => {
    if (!room || !player) return;

    const now = Date.now();
    if (now - player.lastActionAt < 50) return;
    player.lastActionAt = now;

    if (payload?.kind === "attack") {
      player.pendingAttack = true;
    } else if (payload?.kind === "dash") {
      player.pendingDash = true;
    }
  });

  socket.on("client-ping", stamp => {
    socket.emit("server-pong", stamp);
  });

  socket.on("disconnect", () => {
    if (!room || !player) return;

    room.players.delete(socket.id);
    room.events.push({
      type: "leave",
      playerId: socket.id,
      username: player.username,
      time: Date.now()
    });

    if (room.players.size === 0) {
      rooms.delete(room.id);
    }
  });
});

const STEP = 1000 / 30;
const BROADCAST_STEP = 1000 / 20;

setInterval(() => {
  const now = Date.now();
  const dt = STEP / 1000;

  for (const room of rooms.values()) {
    updateRoom(room, dt, now);
  }
}, STEP);

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    broadcastRoom(room, now);
  }
}, BROADCAST_STEP);

server.listen(PORT, () => {
  console.log(`NS Arena server running on port ${PORT}`);
});