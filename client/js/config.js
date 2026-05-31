export const CONFIG = {
  APP_NAME: "NS Arena",
  VERSION: "BETA 1.3.0",
  WORLD_WIDTH: 2400,
  WORLD_HEIGHT: 2400,
  PLAYER_RADIUS: 18,
  INTERPOLATION: 0.18,
  INPUT_SEND_RATE: 33,
  SNAPSHOT_SMOOTHING: 0.32,
  PING_INTERVAL: 2000,
  SOCKET_URL:
    window.NS_SOCKET_URL ||
    (location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:3000"
      : window.location.origin)
};