const PORT = Number(process.env.PORT ?? 3333)
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())

const RECONNECT_WINDOW_MS = 3 * 60 * 1000
const ROOM_TTL_MS = 30 * 60 * 1000
const BOT_TURN_DELAY_MS = 900
const TRICK_REVEAL_MS = 5000

module.exports = {
  PORT,
  FRONTEND_ORIGINS,
  RECONNECT_WINDOW_MS,
  ROOM_TTL_MS,
  BOT_TURN_DELAY_MS,
  TRICK_REVEAL_MS,
}

