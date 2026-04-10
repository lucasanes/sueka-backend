const { createServer } = require('node:http')
const { Server } = require('socket.io')
const env = require('../config/env')
const { createApp } = require('../http/createApp')
const { createRoomService } = require('../services/roomService')
const { registerRoomHandlers } = require('../socket/registerRoomHandlers')
const roomStore = require('../store/roomStore')

function startServer() {
  const app = createApp(env.FRONTEND_ORIGINS, () => roomStore.rooms.size)
  const httpServer = createServer(app)
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_ORIGINS,
      methods: ['GET', 'POST'],
    },
  })

  const roomService = createRoomService({
    io,
    rooms: roomStore.rooms,
    socketRefs: roomStore.socketRefs,
    env,
  })

  registerRoomHandlers(io, roomService)

  setInterval(() => {
    roomService.cleanupRooms(Date.now())
  }, 30_000)

  httpServer.listen(env.PORT, () => {
    console.log(`Sueka socket server listening on http://localhost:${env.PORT}`)
  })

  return { app, io, httpServer }
}

module.exports = {
  startServer,
}
