import { Game3D as Game } from "./game3d.js";
import { AudioManager } from "./audio.js";

// ── Element refs ──────────────────────────────────────────────────────────────
const bootScreen     = document.getElementById("boot-screen");
const mainMenu       = document.getElementById("main-menu");
const mpMenu         = document.getElementById("mp-menu");
const createScreen   = document.getElementById("create-screen");
const joinScreen     = document.getElementById("join-screen");
const gameShell      = document.getElementById("game-shell");

const bootTerminal   = document.getElementById("bootTerminal");
const bootBar        = document.getElementById("bootBar");
const bootStatus     = document.getElementById("bootStatus");
const bootPct        = document.getElementById("bootPct");

const usernameInput  = document.getElementById("usernameInput");
const btnSP          = document.getElementById("btnSP");
const btnMP          = document.getElementById("btnMP");

const btnOnline      = document.getElementById("btnOnline");
const btnCreate      = document.getElementById("btnCreate");
const btnJoin        = document.getElementById("btnJoin");
const btnMpBack      = document.getElementById("btnMpBack");

const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const btnCopyCode    = document.getElementById("btnCopyCode");
const btnStartTeam   = document.getElementById("btnStartTeam");
const btnCreateBack  = document.getElementById("btnCreateBack");

const joinCodeInput  = document.getElementById("joinCodeInput");
const joinError      = document.getElementById("joinError");
const btnJoinConfirm = document.getElementById("btnJoinConfirm");
const btnJoinBack    = document.getElementById("btnJoinBack");

const hpFill         = document.getElementById("hpFill");
const staminaFill    = document.getElementById("staminaFill");
const hpText         = document.getElementById("hpText");
const staminaText    = document.getElementById("staminaText");
const killsText      = document.getElementById("killsText");
const deathsText     = document.getElementById("deathsText");
const fpsText        = document.getElementById("fpsText");
const pingText       = document.getElementById("pingText");
const playersText    = document.getElementById("playersText");
const roomLabel      = document.getElementById("roomLabel");
const leaderboardList = document.getElementById("leaderboardList");
const killFeed       = document.getElementById("killFeed");
const notifications  = document.getElementById("notifications");
const settingsBtn    = document.getElementById("settingsBtn");
const fullscreenBtn  = document.getElementById("fullscreenBtn");
const settingsModal  = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const btnLeave       = document.getElementById("btnLeave");
const canvas         = document.getElementById("gameCanvas");

// ── Core instances ────────────────────────────────────────────────────────────
const audio = new AudioManager();
const game  = new Game({ canvas, audio });

// ── Screen manager ────────────────────────────────────────────────────────────
const ALL_SCREENS = [bootScreen, mainMenu, mpMenu, createScreen, joinScreen];

function setScreen(id) {
  ALL_SCREENS.forEach(s => {
    s.classList.toggle("hidden", s.id !== id);
    s.classList.toggle("active", s.id === id);
  });
  gameShell.classList.toggle("hidden", id !== "game");
}

// ── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getUsername() {
  return usernameInput.value.trim() || "Player";
}

function generateCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function requestFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

// ── Game callbacks ────────────────────────────────────────────────────────────
game.setCallbacks({
  onConnection: state => {},
  onRoom: room => { roomLabel.textContent = `Room: ${room}`; },
  onPlayers: count => { playersText.textContent = String(count); },
  onPing: ms => { pingText.textContent = `${ms} ms`; },
  onStats: stats => {
    hpFill.style.width      = `${Math.max(0, Math.min(100, stats.hp))}%`;
    staminaFill.style.width = `${Math.max(0, Math.min(100, stats.stamina))}%`;
    hpText.textContent      = `${Math.round(stats.hp)}`;
    staminaText.textContent = `${Math.round(stats.stamina)}`;
    killsText.textContent   = `${stats.kills}`;
    deathsText.textContent  = `${stats.deaths}`;
    fpsText.textContent     = `${stats.fps}`;
    playersText.textContent = `${stats.players}`;
    roomLabel.textContent   = `Room: ${stats.room}`;
  },
  onLeaderboard: list => {
    leaderboardList.innerHTML = "";
    list.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "lb-row";
      row.innerHTML = `
        <div class="lb-rank">#${i + 1}</div>
        <div class="lb-name">${escapeHtml(p.username)}</div>
        <div class="lb-stats">${p.kills}/${p.deaths}</div>
      `;
      leaderboardList.appendChild(row);
    });
  },
  onFeed: text => {
    const item = document.createElement("div");
    item.className = "feed-item";
    item.textContent = text;
    killFeed.prepend(item);
    while (killFeed.children.length > 6) killFeed.removeChild(killFeed.lastChild);
  },
  onNotify: text => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    notifications.prepend(toast);
    setTimeout(() => toast.remove(), 2600);
  }
});

// ── Boot sequence ─────────────────────────────────────────────────────────────
const bootLines = [
  `<span class="dim">[system]</span> Checking GPU-safe canvas path... OK`,
  `<span class="dim">[system]</span> Loading neon HUD components... OK`,
  `<span class="dim">[system]</span> Spawning arena core... OK`,
  `<span class="dim">[system]</span> Syncing multiplayer bridge... OK`,
  `<span class="dim">[system]</span> Initializing NS Arena BETA-1.2.1... OK`
];

let bootPctValue = 0, bootIndex = 0;

// Small delay so WebView is fully painted before animation starts (fixes APK boot screen)
let bootTimer;
setTimeout(() => {
  bootTimer = setInterval(() => {
  bootPctValue = Math.min(100, bootPctValue + 20);
  bootBar.style.width   = `${bootPctValue}%`;
  bootPct.textContent   = `${bootPctValue}%`;
  bootStatus.textContent = bootPctValue < 100 ? "Booting core systems" : "Complete";

  if (bootIndex < bootLines.length) {
    const line = document.createElement("div");
    line.innerHTML = bootLines[bootIndex++];
    bootTerminal.appendChild(line);
    bootTerminal.scrollTop = bootTerminal.scrollHeight;
  }

  if (bootPctValue >= 100) {
    clearInterval(bootTimer);
    setTimeout(() => {
      setScreen("main-menu");
      usernameInput.focus();
    }, 650);
  }
  }, 380);
}, 300);

// ── Main Menu ─────────────────────────────────────────────────────────────────
btnSP.addEventListener("click", () => {
  audio.unlock();
  setScreen("game");
  game.startSinglePlayer(getUsername());
});

btnMP.addEventListener("click", () => {
  audio.unlock();
  setScreen("mp-menu");
});

// ── Multiplayer Menu ──────────────────────────────────────────────────────────
btnOnline.addEventListener("click", () => {
  audio.unlock();
  setScreen("game");
  roomLabel.textContent = "Room: Online";
  game.startMultiplayer(getUsername(), "ns-global-online");
});

btnCreate.addEventListener("click", () => {
  audio.unlock();
  const code = generateCode();
  roomCodeDisplay.textContent = code;
  btnStartTeam.dataset.code = code;
  setScreen("create-screen");
});

btnJoin.addEventListener("click", () => {
  audio.unlock();
  joinCodeInput.value = "";
  joinError.textContent = "";
  setScreen("join-screen");
});

btnMpBack.addEventListener("click", () => setScreen("main-menu"));

// ── Create Team ───────────────────────────────────────────────────────────────
btnCopyCode.addEventListener("click", () => {
  const code = roomCodeDisplay.textContent;
  navigator.clipboard?.writeText(code).then(() => {
    btnCopyCode.textContent = "Copied!";
    setTimeout(() => (btnCopyCode.textContent = "Copy Code"), 1500);
  }).catch(() => {});
});

btnStartTeam.addEventListener("click", () => {
  audio.unlock();
  const code = btnStartTeam.dataset.code;
  setScreen("game");
  roomLabel.textContent = `Room: ${code}`;
  game.startMultiplayer(getUsername(), code);
});

btnCreateBack.addEventListener("click", () => setScreen("mp-menu"));

// ── Join Team ─────────────────────────────────────────────────────────────────
btnJoinConfirm.addEventListener("click", () => {
  audio.unlock();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    joinError.textContent = "Please enter a valid room code.";
    return;
  }
  joinError.textContent = "";
  setScreen("game");
  roomLabel.textContent = `Room: ${code}`;
  game.startMultiplayer(getUsername(), code);
});

joinCodeInput.addEventListener("keydown", e => {
  if (e.key === "Enter") btnJoinConfirm.click();
});

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase();
});

btnJoinBack.addEventListener("click", () => setScreen("mp-menu"));

// ── In-game controls ──────────────────────────────────────────────────────────
fullscreenBtn.addEventListener("click", requestFullscreen);
settingsBtn.addEventListener("click", () => {
  audio.unlock();
  settingsModal.classList.remove("hidden");
});
closeSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));
settingsModal.addEventListener("click", e => {
  if (e.target === settingsModal) settingsModal.classList.add("hidden");
});

btnLeave.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
  game.stop();
  setScreen("main-menu");
});

document.querySelectorAll(".btn").forEach(btn => {
  btn.addEventListener("mouseenter", () => audio.hover());
});

usernameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") btnSP.click();
});

// ── Server URL settings (for APK / Capacitor) ─────────────────────────────────
const serverUrlInput = document.getElementById("serverUrlInput");
const btnSaveUrl     = document.getElementById("btnSaveUrl");
const urlStatus      = document.getElementById("urlStatus");

// Pre-fill with stored URL on load
const storedUrl = localStorage.getItem("ns_server_url") || "";
if (serverUrlInput) serverUrlInput.value = storedUrl;

if (btnSaveUrl) {
  btnSaveUrl.addEventListener("click", () => {
    const url = serverUrlInput.value.trim();
    if (url && !url.startsWith("http")) {
      urlStatus.textContent = "URL must start with http:// or https://";
      urlStatus.style.color = "var(--danger)";
      return;
    }
    if (url) {
      localStorage.setItem("ns_server_url", url);
      urlStatus.textContent = "✓ Saved! Restart the game to apply.";
      urlStatus.style.color = "var(--good)";
    } else {
      localStorage.removeItem("ns_server_url");
      urlStatus.textContent = "Cleared. Will auto-detect on next launch.";
      urlStatus.style.color = "var(--muted)";
    }
  });
}
