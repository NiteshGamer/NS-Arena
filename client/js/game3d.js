import * as THREE from "/three/three.module.min.js";
import { NetworkClient } from "./net.js";
import { CONFIG } from "./config.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const S          = 0.08;   // server unit → Three.js unit
const CAM_DIST   = 9;
const CAM_HEIGHT = 5.5;
const CAM_PITCH  = -0.38;  // fixed downward angle (radians)
const CELL_S     = 48;     // server pixels per map cell (approx)

// ── Anime face texture ────────────────────────────────────────────────────────
function makeFaceTex(hairColor) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d");

  // Hair back
  g.fillStyle = hairColor;
  g.beginPath(); g.ellipse(128, 70, 108, 75, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(20, 70, 216, 90);

  // Skin
  g.fillStyle = "#fde8d4";
  g.beginPath(); g.ellipse(128, 150, 96, 105, 0, 0, Math.PI * 2); g.fill();

  // Hair front / bangs
  g.fillStyle = hairColor;
  g.fillRect(20, 68, 216, 48);
  [[40,80],[80,55],[128,48],[176,55],[216,80]].forEach(([bx,by])=>{
    g.beginPath(); g.moveTo(bx-18,by+55); g.lineTo(bx-10,by); g.lineTo(bx+10,by); g.lineTo(bx+18,by+55); g.closePath(); g.fill();
  });

  // Eyes
  [[86,148],[170,148]].forEach(([ex,ey])=>{
    g.fillStyle="#fff"; g.beginPath(); g.ellipse(ex,ey,25,30,0,0,Math.PI*2); g.fill();
    g.fillStyle="#1a3aaa"; g.beginPath(); g.ellipse(ex,ey+3,17,21,0,0,Math.PI*2); g.fill();
    g.fillStyle="#0a0a22"; g.beginPath(); g.ellipse(ex,ey+5,10,14,0,0,Math.PI*2); g.fill();
    g.fillStyle="#fff"; g.beginPath(); g.ellipse(ex+8,ey-5,5,7,0,0,Math.PI*2); g.fill();
    g.beginPath(); g.ellipse(ex-5,ey+9,3,4,0,0,Math.PI*2); g.fill();
    g.strokeStyle="#111"; g.lineWidth=4;
    g.beginPath(); g.arc(ex,ey,26,Math.PI+0.2,-0.2); g.stroke();
  });

  // Blush
  g.fillStyle="rgba(255,140,150,0.32)";
  g.beginPath(); g.ellipse(52,180,30,14,0,0,Math.PI*2); g.fill();
  g.beginPath(); g.ellipse(204,180,30,14,0,0,Math.PI*2); g.fill();

  // Mouth
  g.strokeStyle="#c06050"; g.lineWidth=4;
  g.beginPath(); g.arc(128,198,16,0.25,Math.PI-0.25); g.stroke();

  return new THREE.CanvasTexture(cv);
}

// ── Username sprite ───────────────────────────────────────────────────────────
function makeNameSprite(name, hexColor) {
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 72;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(4,8,14,0.75)";
  g.beginPath();
  if (g.roundRect) g.roundRect(4,8,504,56,10);
  else g.rect(4,8,504,56);
  g.fill();
  g.fillStyle = hexColor;
  g.font = "bold 30px ui-monospace,monospace";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(name.slice(0,16), 256, 36);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(4.2, 0.6, 1);
  sp.position.y = 4.6;
  return sp;
}

// ── HP bar sprite ─────────────────────────────────────────────────────────────
function makeHpBar() {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 24;
  const g = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3.0, 0.28, 1);
  sp.position.y = 4.1;
  sp._canvas = cv; sp._ctx = g; sp._tex = tex;
  sp.update = function(pct) {
    g.clearRect(0,0,256,24);
    g.fillStyle = "#111"; g.fillRect(0,0,256,24);
    const col = pct > 0.5 ? "#22c55e" : pct > 0.25 ? "#f59e0b" : "#ef4444";
    g.fillStyle = col; g.fillRect(2,2,Math.round((256-4)*pct),20);
    tex.needsUpdate = true;
  };
  sp.update(1);
  return sp;
}

// ── Anime character group ─────────────────────────────────────────────────────
const HAIR_COLORS = ["#1144cc","#cc1144","#11aa55","#cc6600","#8811cc","#cc8811","#11aacc"];
let _hairIdx = 0;

function createCharacter(username, glowHex, isLocal) {
  const group = new THREE.Group();
  const glow = new THREE.Color(glowHex);
  const hairHex = isLocal ? "#1a88ff" : HAIR_COLORS[(_hairIdx++) % HAIR_COLORS.length];

  // Shoes
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness:0.8 });
  [[-0.22,0.12,0.08],[0.22,0.12,0.08]].forEach(([sx,sy,sz])=>{
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.2,0.38), shoeMat);
    s.position.set(sx,sy,sz); s.castShadow=true; group.add(s);
  });

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a38, roughness:0.7 });
  [[-0.21],[0.21]].forEach(([lx])=>{
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.15,0.65,6,8), legMat);
    l.position.set(lx,0.65,0); l.castShadow=true; group.add(l);
  });

  // Body (torso)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: glow, emissive: glow, emissiveIntensity: isLocal?0.5:0.25,
    roughness:0.35, metalness:0.6
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36,0.85,8,16), bodyMat);
  torso.position.y = 1.35; torso.castShadow=true; group.add(torso);

  // Glowing trim line on chest
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(glowHex).multiplyScalar(2) });
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.37,0.035,8,24), trimMat);
  trim.position.y = 1.5; trim.rotation.x = Math.PI/2; group.add(trim);

  // Arms
  const armMat = new THREE.MeshStandardMaterial({
    color: glow, emissive: glow, emissiveIntensity: 0.2, roughness:0.5, metalness:0.4
  });
  [[-0.56,1.35,-0.08],[0.56,1.35,-0.08]].forEach(([ax,ay,az],i)=>{
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12,0.6,6,8), armMat);
    arm.position.set(ax,ay,az);
    arm.rotation.z = i===0?0.38:-0.38;
    arm.castShadow=true; group.add(arm);
  });

  // Neck
  const neckMat = new THREE.MeshStandardMaterial({ color:0xfde8d4, roughness:0.9 });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.22,8), neckMat);
  neck.position.y = 2.05; group.add(neck);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.41,20,20), neckMat);
  head.position.y = 2.57; head.castShadow=true; group.add(head);

  // Anime face (billboard plane)
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72,0.72),
    new THREE.MeshBasicMaterial({ map:makeFaceTex(hairHex), transparent:true, depthWrite:false })
  );
  face.position.set(0,2.57,0.42);
  face.userData.isBillboard = true;
  group.add(face);

  // Hair (top sphere half)
  const hairMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(hairHex), roughness:0.85 });
  const hairDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.43,16,16,0,Math.PI*2,0,Math.PI/2), hairMat
  );
  hairDome.position.y = 2.57; group.add(hairDome);

  // Hair spikes
  const spikeAngles = [0,0.55,-0.55,1.05,-1.05];
  spikeAngles.forEach(a=>{
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1,0.38,6), hairMat);
    sp.position.set(Math.sin(a)*0.32, 3.12+Math.cos(Math.abs(a))*0.08, 0);
    sp.rotation.z = a*0.45; group.add(sp);
  });

  // Glow aura ring on ground
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(0.5,0.72,32),
    new THREE.MeshBasicMaterial({ color:glow, transparent:true, opacity:0.35, side:THREE.DoubleSide })
  );
  aura.rotation.x = -Math.PI/2; aura.position.y=0.02;
  group.add(aura);

  // Name + HP
  group.add(makeNameSprite(username, glowHex));
  const hp = makeHpBar(); group.add(hp);
  group.userData.hpBar = hp;
  group.userData.faceMesh = face;

  return group;
}

// ── Map object → 3D mesh ──────────────────────────────────────────────────────
const H_MAP = {
  house:4.8, house_s:3.8, shed:3.2, tower:8, ruin:4,
  wall_h:2.0, wall_v:2.0, wall_c:2.0,
  fence_h:1.2, fence_v:1.2, gate:1.8,
  door:2.4, window:0.15,
  tree:5.5, pine:6.5, palm:7.5,
  bush:0.8, grass:0.2, flower:0.4, sunflow:0.6,
  rock:1.1, bigrock:2.0,
  mushroom:0.7,
  water:0.06, pond:0.06,
  barrel:0.9, barrels:0.9, crate:0.8, crates:1.5,
  table:0.7, chair:0.85, sofa:0.8, bed:0.6,
  shelf:1.5, lamp:1.8, campfire:0.6, chest:0.6, pot:0.7,
  barrier:1.2, barrier_v:1.2, cover:1.4,
  sandbag:0.65, sandbags:0.65,
  road_h:0.05, road_v:0.05, path:0.04, bridge:0.3,
  stairs:0.6, sand:0.06, lava:0.08, ice:0.06, snow:0.06,
  pit:0.05, crater:0.2, trap:0.1, turret:1.6,
  spawn:0.05, spawn_r:0.05, spawn_b:0.05, health:0.4, ammo:0.5,
};
const C_MAP = {
  house:0x7a3d1a, house_s:0x8a4d2a, shed:0x8a5030, tower:0x445566, ruin:0x556677,
  wall_h:0x445566, wall_v:0x445566, wall_c:0x445566,
  fence_h:0xc8a060, fence_v:0xc8a060, gate:0xb89050,
  tree:0x1a4a1a, pine:0x0d3b0d, palm:0x1a5a1a, bush:0x2a6a1a,
  grass:0x3a7a2a, flower:0xff88bb, sunflow:0xffcc00,
  rock:0x667788, bigrock:0x556677, mushroom:0xaa3a1a,
  water:0x1a4aaa, pond:0x1a3aaa,
  barrel:0xa06030, barrels:0xa06030, crate:0xc8a060, crates:0xc8a060,
  table:0x8b4513, chair:0x6b3510, sofa:0x5568aa, bed:0x4488aa,
  shelf:0x8b5030, lamp:0xffdd44, campfire:0xff6600, chest:0xcc9900, pot:0x3a6a1a,
  barrier:0x334455, barrier_v:0x334455, cover:0x445566,
  sandbag:0xc8a040, sandbags:0xc8a040,
  road_h:0x333344, road_v:0x333344, path:0xaaaaaa, bridge:0x778899,
  stairs:0x999aaa, sand:0xe8d090, lava:0xff4400, ice:0x88ccff, snow:0xccddff,
  pit:0x080810, crater:0x3a2a1a, trap:0xffcc00, turret:0x556688,
  spawn:0xffdd00, spawn_r:0xcc2222, spawn_b:0x2244cc, health:0xff4444, ammo:0x889999,
  door:0x8b4513, window:0x88aaff,
};

function buildMapMesh(obj, cellW, cellH) {
  const t = obj.type;
  const pw = obj.w * cellW;
  const ph = obj.h * cellH;
  const ht = H_MAP[t] ?? 0.3;
  const col = new THREE.Color(C_MAP[t] ?? 0x668866);
  const group = new THREE.Group();

  const std = (c,rough=0.7,metal=0.1,emis=null) => new THREE.MeshStandardMaterial({
    color:c, roughness:rough, metalness:metal,
    emissive: emis||new THREE.Color(0x000000),
    emissiveIntensity: emis?0.5:0
  });

  if (t==="tree"||t==="pine"||t==="palm") {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18,0.28,ht*0.5,8),
      std(new THREE.Color(0x5a3010),0.9,0)
    );
    trunk.position.y = ht*0.25; trunk.castShadow=true; group.add(trunk);
    const foliage = new THREE.Mesh(
      t==="pine"
        ? new THREE.ConeGeometry(Math.min(pw,ph)*0.45, ht*0.65, 8)
        : new THREE.SphereGeometry(Math.min(pw,ph)*0.45, 10, 10),
      std(col,0.8,0)
    );
    foliage.position.y = ht*(t==="pine"?0.75:0.8);
    foliage.castShadow=true; group.add(foliage);
  } else if (t==="rock"||t==="bigrock") {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(Math.min(pw,ph)*0.42,1),
      std(col,0.9,0.1)
    );
    mesh.rotation.y = Math.random()*Math.PI;
    mesh.position.y = ht*0.45; mesh.castShadow=true; group.add(mesh);
  } else if (t==="water"||t==="pond") {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pw,ph),
      new THREE.MeshStandardMaterial({ color:col, roughness:0.05, metalness:0.6, transparent:true, opacity:0.78 })
    );
    mesh.rotation.x=-Math.PI/2; mesh.position.y=0.06; group.add(mesh);
  } else if (t==="lava") {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pw,ph),
      new THREE.MeshStandardMaterial({ color:col, emissive:col, emissiveIntensity:0.8, roughness:0.3 })
    );
    mesh.rotation.x=-Math.PI/2; mesh.position.y=0.08; group.add(mesh);
  } else if (t==="campfire") {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.6,0.2,8), std(new THREE.Color(0x5a3010),0.9,0));
    base.position.y=0.1; group.add(base);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.35,0.7,8),
      new THREE.MeshStandardMaterial({ color:0xff6600, emissive:new THREE.Color(0xff4400), emissiveIntensity:1.2, transparent:true, opacity:0.85 }));
    fire.position.y=0.55; group.add(fire);
    const light = new THREE.PointLight(0xff6600, 2, 8);
    light.position.y=1; group.add(light);
  } else if (t==="lamp") {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,ht,6), std(new THREE.Color(0x556677),0.5,0.6));
    pole.position.y=ht/2; group.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22,12,12),
      new THREE.MeshStandardMaterial({ color:0xffffcc, emissive:new THREE.Color(0xffffaa), emissiveIntensity:2, transparent:true, opacity:0.9 }));
    bulb.position.y=ht; group.add(bulb);
    const l = new THREE.PointLight(0xffffcc,1.5,7);
    l.position.y=ht; group.add(l);
  } else {
    // Generic box
    const rough = (t.includes("wall")||t.includes("barrier")) ? 0.4 : 0.75;
    const metal = (t.includes("wall")||t.includes("barrier")||t==="tower") ? 0.45 : 0.1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(pw, ht, ph),
      std(col, rough, metal, t==="lava"?col:null)
    );
    mesh.position.y = ht/2; mesh.castShadow=true; mesh.receiveShadow=true;
    group.add(mesh);
    // Windows on buildings
    if (t==="house"||t==="house_s"||t==="shed") {
      const winMat = new THREE.MeshStandardMaterial({
        color:0x88aaff, emissive:new THREE.Color(0x4466ff), emissiveIntensity:0.4,
        roughness:0.1, metalness:0.5
      });
      [[pw*0.25,ht*0.55,ph/2+0.02],[pw*-0.25,ht*0.55,ph/2+0.02]].forEach(([wx,wy,wz])=>{
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55,0.55), winMat);
        win.position.set(wx,wy,wz); group.add(win);
      });
    }
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Game3D class
// ─────────────────────────────────────────────────────────────────────────────
export class Game3D {
  constructor({ canvas, audio }) {
    this.canvas = canvas;
    this.audio  = audio;
    this.callbacks = {};
    this.running   = false;
    this.mode      = "mp";

    // Network
    this.network   = null;

    // Player state
    this.local     = { id:null, x:0, y:0, hp:100, stamina:100, kills:0, deaths:0, username:"", angle:0, alive:true, attackReadyAt:0, pendingDashAt:0 };
    this.remote    = new Map();   // id → { x,y,hp,... }
    this.bots      = [];
    this.mapData   = null;

    // Three.js
    this.scene     = null;
    this.camera    = null;
    this.renderer  = null;
    this.camYaw    = 0;
    this.camPitch  = CAM_PITCH;

    // Player meshes
    this.playerMeshes = new Map(); // id → THREE.Group
    this.mapMeshes    = [];

    // Input
    this.keys      = { up:false, down:false, left:false, right:false };
    this.mouse     = { x:0, y:0 };
    this.touchLeft = null;
    this.touchRight= null;
    this.atkBtnCenter = { x:0, y:0 };

    // Timing
    this.lastFrame   = 0;
    this.lastInput   = 0;
    this.lastPingAt  = 0;
    this.socketRoom  = "online";

    // FPS
    this._fpsSamples = [];
  }

  setCallbacks(cb) { this.callbacks = cb; }

  // ── Start modes ────────────────────────────────────────────────────────────
  startMultiplayer(username, roomId) {
    this.mode = "mp";
    this.socketRoom = roomId || "ns-global-online";
    this.local.username = username;
    this._resetLocal();
    this.bots = []; this.remote.clear();

    this._initThree();
    this._bindInput();

    this.network = new NetworkClient();
    this._bindNetwork();
    this.network.connect(username, this.socketRoom);

    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this._loop);
    this.callbacks.onConnection?.("connecting");
  }

  startSinglePlayer(username) {
    this.mode = "sp";
    this.socketRoom = "single-player";
    this.local.username = username;
    this._resetLocal();
    this.remote.clear();

    this._initThree();
    this._bindInput();

    // Spawn bots
    const names = ["CYBER-X","GHOST-7","NEON-K","BLADE-9","VOID-3"];
    const BOT_COUNT = 3;
    this.bots = [];
    for (let i=0;i<BOT_COUNT;i++) {
      const a = (i/BOT_COUNT)*Math.PI*2;
      const r = 250+Math.random()*100;
      const cx = CONFIG.WORLD_WIDTH/2, cy = CONFIG.WORLD_HEIGHT/2;
      const bot = {
        id:"bot-"+i, username:names[i], x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r,
        hp:100, maxHp:100, alive:true, angle:0, kills:0, deaths:0,
        _state:"WANDER",_wanderAngle:Math.random()*Math.PI*2,_wanderTimer:0,
        _atkCd:0,_respawnTimer:0,_speed:200,_strafeDir:1
      };
      this.bots.push(bot);
      this.remote.set(bot.id, bot);
    }

    // Spawn bot meshes
    this.bots.forEach(b => this._addPlayer(b.id, b.username, false, true));

    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this._loop);
    this.callbacks.onRoom?.("Single Player");
  }

  stop() {
    this.running = false;
    this.network?.disconnect?.();
    this.network = null;
    this.bots = [];
    this.remote.clear();
    this.playerMeshes.forEach(m=>this.scene.remove(m));
    this.playerMeshes.clear();
    this.mapMeshes.forEach(m=>this.scene.remove(m));
    this.mapMeshes = [];
    this.renderer?.dispose();
    this._removeInput();
  }

  // ── Three.js init ──────────────────────────────────────────────────────────
  _initThree() {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias:true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.setSize(W, H, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x090e1a);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x090e1a, 60, 200);

    // Sky
    this.scene.background = new THREE.Color(0x0a0f1e);

    // Lighting
    const ambient = new THREE.AmbientLight(0x334466, 1.8);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 300;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -150;
    sun.shadow.camera.right= sun.shadow.camera.top    =  150;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x4488ff, 0.6);
    fill.position.set(-20, 30, -30);
    this.scene.add(fill);

    // Camera
    this.camera = new THREE.PerspectiveCamera(65, W/H, 0.1, 500);
    this.camera.position.set(0, CAM_HEIGHT, -CAM_DIST);
    this.camera.lookAt(0, 1.5, 0);

    // Ground plane
    this._createGround();

    // Spawn local player mesh
    this._addPlayer("__local", this.local.username, true, false);

    // Load map if available
    if (this.mapData) this._buildMap(this.mapData);

    // Handle resize
    this._resizeHandler = () => {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", this._resizeHandler);
  }

  _createGround() {
    const ww = CONFIG.WORLD_WIDTH * S;
    const wh = CONFIG.WORLD_HEIGHT * S;
    const cx = ww / 2, cz = wh / 2;

    // Main ground
    const geo = new THREE.PlaneGeometry(ww, wh, 40, 40);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d1a0d, roughness: 0.95, metalness: 0.0
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid overlay
    const grid = new THREE.GridHelper(Math.max(ww, wh), 50, 0x1a3a1a, 0x0f2a0f);
    grid.position.set(cx, 0.01, cz);
    this.scene.add(grid);

    // Arena border glow strips
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x45f3ff });
    [[0,cz,0],[ww,cz,0],[cx,0,0],[cx,0,wh]].forEach(([bx,by,bz], i)=>{
      const isH = i >= 2;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(isH?ww:0.18, 0.1, isH?0.18:wh),
        borderMat
      );
      strip.position.set(isH?cx:bx, 0.05, isH?(i===2?0:wh):by);
      this.scene.add(strip);
    });

    // Some ambient particles (static glowing dots)
    const partGeo = new THREE.BufferGeometry();
    const positions = [];
    for (let i=0;i<200;i++) {
      positions.push(Math.random()*ww, Math.random()*12+0.5, Math.random()*wh);
    }
    partGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
    const partMat = new THREE.PointsMaterial({ color:0x45f3ff, size:0.12, transparent:true, opacity:0.4 });
    this.scene.add(new THREE.Points(partGeo, partMat));
  }

  _buildMap(mapData) {
    if (!mapData?.objects?.length) return;
    const mapW = mapData.width || 50;
    const mapH = mapData.height || 40;
    const cellW = (CONFIG.WORLD_WIDTH / mapW) * S;
    const cellH = (CONFIG.WORLD_HEIGHT / mapH) * S;

    mapData.objects.forEach(obj => {
      const mesh = buildMapMesh(obj, cellW, cellH);
      const px = obj.x * cellW + (obj.w * cellW) / 2;
      const pz = obj.y * cellH + (obj.h * cellH) / 2;
      mesh.position.set(px, 0, pz);
      this.scene.add(mesh);
      this.mapMeshes.push(mesh);
    });
  }

  // ── Player meshes ──────────────────────────────────────────────────────────
  _addPlayer(id, username, isLocal, isBot) {
    if (this.playerMeshes.has(id)) return;
    const glowHex = isLocal ? "#45f3ff" : isBot ? "#ff5544" : "#a855f7";
    const group = createCharacter(username, glowHex, isLocal);
    this.scene.add(group);
    this.playerMeshes.set(id, group);
  }

  _removePlayer(id) {
    const m = this.playerMeshes.get(id);
    if (m) { this.scene.remove(m); this.playerMeshes.delete(id); }
  }

  _updatePlayerMesh(id, x, y, angle, hp, alive) {
    const mesh = this.playerMeshes.get(id);
    if (!mesh) return;
    const tx = x * S;
    const tz = y * S;
    mesh.position.x += (tx - mesh.position.x) * 0.25;
    mesh.position.z += (tz - mesh.position.z) * 0.25;
    mesh.rotation.y = -angle + Math.PI;
    mesh.visible = alive !== false;
    const hpBar = mesh.userData.hpBar;
    if (hpBar) hpBar.update(Math.max(0, (hp ?? 100) / 100));
    // Billboard face always faces camera
    const face = mesh.userData.faceMesh;
    if (face && this.camera) face.lookAt(this.camera.position);
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  _updateCamera() {
    const lx = this.local.x * S;
    const lz = this.local.y * S;
    const dist = CAM_DIST;
    const h    = CAM_HEIGHT;

    // Target position: behind the player based on camYaw
    const tx = lx - Math.sin(this.camYaw) * dist;
    const ty = h;
    const tz = lz - Math.cos(this.camYaw) * dist;

    this.camera.position.x += (tx - this.camera.position.x) * 0.12;
    this.camera.position.y += (ty - this.camera.position.y) * 0.1;
    this.camera.position.z += (tz - this.camera.position.z) * 0.12;

    // Look at player head
    this.camera.lookAt(lx, 2.0, lz);
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  _bindInput() {
    this._onKeyDown = e => {
      if (e.target.tagName === "INPUT") return;
      if (e.key==="w"||e.key==="W"||e.key==="ArrowUp")    this.keys.up=true;
      if (e.key==="s"||e.key==="S"||e.key==="ArrowDown")  this.keys.down=true;
      if (e.key==="a"||e.key==="A"||e.key==="ArrowLeft")  this.keys.left=true;
      if (e.key==="d"||e.key==="D"||e.key==="ArrowRight") this.keys.right=true;
      if (e.key===" ") { e.preventDefault(); this._requestAttack(); }
    };
    this._onKeyUp = e => {
      if (e.key==="w"||e.key==="W"||e.key==="ArrowUp")    this.keys.up=false;
      if (e.key==="s"||e.key==="S"||e.key==="ArrowDown")  this.keys.down=false;
      if (e.key==="a"||e.key==="A"||e.key==="ArrowLeft")  this.keys.left=false;
      if (e.key==="d"||e.key==="D"||e.key==="ArrowRight") this.keys.right=false;
    };
    this._onMouseMove = e => {
      if (document.pointerLockElement === this.canvas) {
        this.camYaw   -= e.movementX * 0.003;
        this.camPitch =  Math.max(-0.8, Math.min(0.1, this.camPitch - e.movementY * 0.003));
      }
    };
    this._onClick = () => this.canvas.requestPointerLock?.();

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);
    this.canvas.addEventListener("mousemove", this._onMouseMove);
    this.canvas.addEventListener("click", this._onClick);
    this._bindTouch();
  }

  _bindTouch() {
    this.canvas.addEventListener("touchstart", this._onTouchStart = e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const rect = this.canvas.getBoundingClientRect();
        const tx = t.clientX - rect.left;
        const ty = t.clientY - rect.top;
        if (tx < rect.width / 2) {
          this.touchLeft = { id:t.identifier, startX:tx, startY:ty, x:tx, y:ty };
        } else {
          const acx = this.atkBtnCenter.x || rect.width * 0.82;
          const acy = this.atkBtnCenter.y || rect.height * 0.78;
          this.touchRight = { id:t.identifier, x:tx, y:ty, startX:acx, startY:acy };
          this._requestAttack();
        }
      }
    }, { passive:false });

    this.canvas.addEventListener("touchmove", this._onTouchMove = e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const rect = this.canvas.getBoundingClientRect();
        const tx = t.clientX - rect.left;
        const ty = t.clientY - rect.top;
        if (this.touchLeft && t.identifier === this.touchLeft.id) {
          this.touchLeft.x = tx; this.touchLeft.y = ty;
        } else if (!this.touchLeft && tx < rect.width / 2) {
          this.touchLeft = { id:t.identifier, startX:tx, startY:ty, x:tx, y:ty };
        } else if (this.touchRight && t.identifier === this.touchRight.id) {
          this.touchRight.x = tx; this.touchRight.y = ty;
          // Camera rotation from right joystick
          const dx = tx - this.touchRight.startX;
          const dy = ty - this.touchRight.startY;
          const dist = Math.hypot(dx,dy);
          if (dist > 12) {
            this.camYaw   -= dx * 0.003;
            this.camPitch = Math.max(-0.8, Math.min(0.1, this.camPitch - dy * 0.003));
            this.touchRight.startX = tx; this.touchRight.startY = ty;
            this._requestAttack();
          }
        }
      }
    }, { passive:false });

    this.canvas.addEventListener("touchend", this._onTouchEnd = e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.touchLeft?.id  === t.identifier) { this.touchLeft = null; this.keys.up=this.keys.down=this.keys.left=this.keys.right=false; }
        if (this.touchRight?.id === t.identifier) this.touchRight = null;
      }
    }, { passive:false });
  }

  _removeInput() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup",   this._onKeyUp);
    window.removeEventListener("resize",  this._resizeHandler);
    this.canvas.removeEventListener("mousemove", this._onMouseMove);
    this.canvas.removeEventListener("click",     this._onClick);
  }

  // ── Movement & attack ──────────────────────────────────────────────────────
  _handleInput(dt) {
    // Touch joystick → keys
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

    // Camera-relative movement
    const fwd  = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const rgt  = new THREE.Vector3(Math.cos(this.camYaw), 0,-Math.sin(this.camYaw));
    const move = new THREE.Vector3();
    if (this.keys.up)    move.add(fwd);
    if (this.keys.down)  move.sub(fwd);
    if (this.keys.right) move.add(rgt);
    if (this.keys.left)  move.sub(rgt);

    if (move.lengthSq() > 0) {
      move.normalize();
      const speed = 260;
      this.local.x += (move.x * speed + 0) * dt;
      this.local.y += (move.z * speed + 0) * dt;
      this.local.x  = Math.max(20, Math.min(CONFIG.WORLD_WIDTH-20,  this.local.x));
      this.local.y  = Math.max(20, Math.min(CONFIG.WORLD_HEIGHT-20, this.local.y));
      // Face direction of movement
      this.local.angle = Math.atan2(move.x, move.z) - Math.PI;
    }
  }

  _requestAttack() {
    const now = performance.now();
    if (now < this.local.attackReadyAt) return;
    this.local.attackReadyAt = now + 420;
    this.audio?.attack?.();
    if (this.mode === "sp") this._spAttack();
    else this.network?.sendAction("attack");
  }

  _spAttack() {
    if (!this.local.alive) return;
    const RANGE = 275;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const dx = bot.x - this.local.x, dy = bot.y - this.local.y;
      const dist = Math.hypot(dx,dy);
      if (dist > RANGE) continue;
      bot.hp -= 30;
      if (bot.hp <= 0) {
        bot.hp=0; bot.alive=false; bot.deaths++;
        bot._respawnTimer=3000; this.local.kills++;
        this.callbacks.onFeed?.("You eliminated "+bot.username);
        this.callbacks.onNotify?.("⚔ "+bot.username+" eliminated");
      }
    }
  }

  _spLocalDamage(amount, name) {
    if (!this.local.alive) return;
    this.local.hp = Math.max(0, this.local.hp - amount);
    if (this.local.hp <= 0) {
      this.local.alive=false; this.local.deaths++;
      this.callbacks.onFeed?.(name+" eliminated you");
      this.callbacks.onNotify?.("💀 Eliminated by "+name);
      setTimeout(()=>{
        if(!this.running) return;
        this.local.hp=100; this.local.alive=true;
        this.local.x = CONFIG.WORLD_WIDTH/2+(Math.random()-.5)*200;
        this.local.y = CONFIG.WORLD_HEIGHT/2+(Math.random()-.5)*200;
        this.callbacks.onNotify?.("Respawned!");
      },3000);
    }
  }

  // ── Bot AI ─────────────────────────────────────────────────────────────────
  _updateBots(dt) {
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot._respawnTimer -= dt*1000;
        if (bot._respawnTimer<=0) {
          bot.alive=true; bot.hp=bot.maxHp;
          bot.x=CONFIG.WORLD_WIDTH/2+(Math.random()-.5)*400;
          bot.y=CONFIG.WORLD_HEIGHT/2+(Math.random()-.5)*400;
          bot._state="WANDER";
        }
        this._updatePlayerMesh(bot.id,bot.x,bot.y,bot.angle,bot.hp,false);
        continue;
      }
      bot._atkCd = Math.max(0,bot._atkCd-dt);
      const dx=this.local.x-bot.x, dy=this.local.y-bot.y;
      const dist=Math.hypot(dx,dy)||1;
      if (dist<220) bot._state="ATTACK";
      else if (dist<480) bot._state="CHASE";
      else bot._state="WANDER";
      if (bot._state==="WANDER") {
        bot._wanderTimer-=dt;
        if (bot._wanderTimer<=0){bot._wanderAngle=Math.random()*Math.PI*2;bot._wanderTimer=1.5+Math.random()*1.5;}
        bot.x+=Math.cos(bot._wanderAngle)*bot._speed*dt;
        bot.y+=Math.sin(bot._wanderAngle)*bot._speed*dt;
        bot.angle=bot._wanderAngle;
      } else if (bot._state==="CHASE") {
        bot.angle=Math.atan2(dy,dx);
        bot.x+=Math.cos(bot.angle)*bot._speed*dt;
        bot.y+=Math.sin(bot.angle)*bot._speed*dt;
      } else {
        bot.angle=Math.atan2(dy,dx);
        const sa=bot.angle+Math.PI/2*bot._strafeDir;
        bot.x+=Math.cos(sa)*bot._speed*0.5*dt;
        bot.y+=Math.sin(sa)*bot._speed*0.5*dt;
        if(Math.random()<0.008) bot._strafeDir*=-1;
        if(bot._atkCd<=0&&this.local.alive){
          bot._atkCd=1.1; this._spLocalDamage(11,bot.username);
        }
      }
      bot.x=Math.max(80,Math.min(CONFIG.WORLD_WIDTH-80,bot.x));
      bot.y=Math.max(80,Math.min(CONFIG.WORLD_HEIGHT-80,bot.y));
      this._updatePlayerMesh(bot.id,bot.x,bot.y,bot.angle,bot.hp,bot.alive);
    }
  }

  // ── Network ────────────────────────────────────────────────────────────────
  _bindNetwork() {
    this.network.on("connect",    ()  => { this.callbacks.onConnection?.("connected"); });
    this.network.on("welcome",    data=> {
      this.local.id = data.id;
      if (data.map) { this.mapData = data.map; this._buildMap(data.map); }
      this.callbacks.onRoom?.(data.roomId);
    });
    this.network.on("snapshot",   snap=> this._applySnapshot(snap));
    this.network.on("ping",       ms  => this.callbacks.onPing?.(ms));
    this.network.on("disconnect", ()  => this.callbacks.onNotify?.("Disconnected"));
    this.network.on("error",      msg => this.callbacks.onNotify?.(msg));
  }

  _applySnapshot(snap) {
    for (const p of snap.players||[]) {
      if (p.id === this.local.id) {
        this.local.hp     = p.hp;
        this.local.stamina= p.stamina;
        this.local.kills  = p.kills;
        this.local.deaths = p.deaths;
        this.local.alive  = p.alive;
        this.local.x += (p.x - this.local.x) * 0.3;
        this.local.y += (p.y - this.local.y) * 0.3;
      } else {
        if (!this.remote.has(p.id)) {
          this.remote.set(p.id, p);
          this._addPlayer(p.id, p.username, false, false);
        } else { Object.assign(this.remote.get(p.id), p); }
        this._updatePlayerMesh(p.id, p.x, p.y, p.angle||0, p.hp, p.alive);
      }
    }
    // Remove gone players
    const ids = new Set((snap.players||[]).map(p=>p.id));
    for (const [id] of this.remote) {
      if (!ids.has(id)) { this._removePlayer(id); this.remote.delete(id); }
    }
    if (snap.leaderboard) this.callbacks.onLeaderboard?.(snap.leaderboard);
  }

  _syncInput(now) {
    if (now - this.lastInput < 33) return;
    this.lastInput = now;
    this.network?.sendInput({
      up:   this.keys.up,
      down: this.keys.down,
      left: this.keys.left,
      right:this.keys.right,
      angle:this.local.angle
    });
  }

  // ── HUD stats ──────────────────────────────────────────────────────────────
  _updateStats() {
    const count = this.mode==="sp"
      ? this.bots.length+1
      : this.remote.size+(this.local.id?1:0);
    this.callbacks.onStats?.({
      hp: this.local.hp, stamina: this.local.stamina,
      kills: this.local.kills, deaths: this.local.deaths,
      fps: this._fps()||0,
      room: this.mode==="sp"?"Single Player":this.socketRoom,
      players: count
    });
    // SP leaderboard
    if (this.mode==="sp") {
      const lb=[{username:this.local.username,kills:this.local.kills,deaths:this.local.deaths},
        ...this.bots.map(b=>({username:b.username,kills:b.kills,deaths:b.deaths}))
      ].sort((a,b)=>b.kills-a.kills);
      this.callbacks.onLeaderboard?.(lb);
    }
  }

  _fps() {
    return this._fpsVal|0;
  }

  _drawTouchUI() {
    if (!("ontouchstart" in window)) return;
    const oc = document.getElementById("hudCanvas");
    if (!oc) return;
    const rect = this.canvas.getBoundingClientRect();
    if (oc.width !== rect.width || oc.height !== rect.height) {
      oc.width = rect.width; oc.height = rect.height;
    }
    const g = oc.getContext("2d");
    g.clearRect(0, 0, oc.width, oc.height);
    const r = 52;

    // ── Left joystick (MOVE) ──────────────────────────────────────────────
    const lcx = r + 80, lcy = oc.height - r - 36;
    this.atkBtnCenter = { x: oc.width - r - 36, y: oc.height - r - 36 };

    // Base ring
    g.strokeStyle = "rgba(69,243,255,0.3)";
    g.lineWidth = 2;
    g.beginPath(); g.arc(lcx, lcy, r, 0, Math.PI * 2); g.stroke();

    // Knob
    if (this.touchLeft) {
      const kx = lcx + (this.touchLeft.x - this.touchLeft.startX);
      const ky = lcy + (this.touchLeft.y - this.touchLeft.startY);
      g.fillStyle = "rgba(69,243,255,0.55)";
      g.beginPath(); g.arc(kx, ky, 26, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = "rgba(69,243,255,0.2)";
      g.beginPath(); g.arc(lcx, lcy, 26, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.font = "bold 11px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("MOVE", lcx, lcy);

    // ── Right joystick (CAMERA + ATK) ────────────────────────────────────
    const acx = this.atkBtnCenter.x, acy = this.atkBtnCenter.y;
    g.strokeStyle = "rgba(255,77,140,0.3)"; g.lineWidth = 2;
    g.beginPath(); g.arc(acx, acy, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = this.touchRight ? "rgba(255,77,140,0.45)" : "rgba(255,77,140,0.18)";
    g.beginPath(); g.arc(acx, acy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.font = "bold 11px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("CAM/ATK", acx, acy);

    // ── Attack cooldown arc ───────────────────────────────────────────────
    const cdPct = Math.max(0, Math.min(1, (this.local.attackReadyAt - performance.now()) / 420));
    if (cdPct > 0) {
      g.strokeStyle = "rgba(255,220,50,0.7)"; g.lineWidth = 3;
      g.beginPath();
      g.arc(acx, acy, r + 8, -Math.PI/2, -Math.PI/2 + (1 - cdPct) * Math.PI * 2);
      g.stroke();
    }

    // ── HP bar (top) ─────────────────────────────────────────────────────
    const barW = Math.min(200, oc.width * 0.35);
    const barX = oc.width / 2 - barW / 2;
    const barY = 12;
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.beginPath(); if(g.roundRect) g.roundRect(barX, barY, barW, 14, 4); else g.rect(barX,barY,barW,14); g.fill();
    const hpPct = Math.max(0, this.local.hp / 100);
    g.fillStyle = hpPct > 0.5 ? "#22c55e" : hpPct > 0.25 ? "#f59e0b" : "#ef4444";
    g.beginPath(); if(g.roundRect) g.roundRect(barX+1, barY+1, (barW-2)*hpPct, 12, 3); else g.rect(barX+1,barY+1,(barW-2)*hpPct,12); g.fill();
    g.fillStyle = "rgba(255,255,255,0.7)"; g.font = "10px monospace"; g.textAlign = "center";
    g.fillText(`HP ${Math.round(this.local.hp)}`, oc.width/2, barY + 20);

    // ── Crosshair (center) ────────────────────────────────────────────────
    const cx2 = oc.width / 2, cy2 = oc.height / 2;
    g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.5;
    [[-12,-12,12,12],[12,-12,-12,12]].forEach(([dx1,dy1,dx2,dy2])=>{
      g.beginPath(); g.moveTo(cx2+dx1,cy2+dy1); g.lineTo(cx2+dx2,cy2+dy2); g.stroke();
    });
    g.beginPath(); g.arc(cx2,cy2,5,0,Math.PI*2); g.stroke();
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  _resetLocal() {
    this.local.x = CONFIG.WORLD_WIDTH/2+(Math.random()-.5)*100;
    this.local.y = CONFIG.WORLD_HEIGHT/2+(Math.random()-.5)*100;
    this.local.hp=100; this.local.stamina=100;
    this.local.kills=0; this.local.deaths=0;
    this.local.alive=true; this.local.id=null;
    this.local.angle=0;
  }

  // ── Main loop ──────────────────────────────────────────────────────────────
  _loop = now => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;

    // FPS calc
    this._fpsSamples = this._fpsSamples||[];
    this._fpsSamples.push(1/dt);
    if (this._fpsSamples.length>30) this._fpsSamples.shift();
    this._fpsVal = this._fpsSamples.reduce((a,b)=>a+b,0)/this._fpsSamples.length;

    // Input
    this._handleInput(dt);

    // Update local mesh
    this._updatePlayerMesh("__local", this.local.x, this.local.y, this.local.angle, this.local.hp, this.local.alive);

    // Mode-specific
    if (this.mode==="sp") {
      this._updateBots(dt);
    } else {
      this._syncInput(now);
      if (now - this.lastPingAt > CONFIG.PING_INTERVAL) {
        this.lastPingAt = now; this.network?.ping();
      }
    }

    // Camera
    this._updateCamera();

    // Stats
    this._updateStats();

    // Render
    this.renderer.render(this.scene, this.camera);
    this._drawTouchUI();

    requestAnimationFrame(this._loop);
  };
}
