const test = require('node:test')
const assert = require('node:assert/strict')

const { registerRoomHandlers } = require('./src/socket/registerRoomHandlers')
const { createRoomService } = require('./src/services/roomService')

function createIoDouble() {
  const emissions = []

  return {
    emissions,
    sockets: {
      sockets: new Map(),
    },
    to(target) {
      return {
        emit(event, payload) {
          emissions.push({ target, event, payload })
        },
      }
    },
  }
}

function createSocketDouble(id) {
  return {
    id,
    emitted: [],
    joinedRooms: [],
    leftRooms: [],
    handlers: new Map(),
    emit(event, payload) {
      this.emitted.push({ event, payload })
    },
    join(roomCode) {
      this.joinedRooms.push(roomCode)
    },
    leave(roomCode) {
      this.leftRooms.push(roomCode)
    },
    on(event, handler) {
      this.handlers.set(event, handler)
    },
  }
}

test('o dono original volta a ser dono quando reconecta', () => {
  const io = createIoDouble()
  const service = createRoomService({
    io,
    rooms: new Map(),
    socketRefs: new Map(),
    env: {
      BOT_TURN_DELAY_MS: 0,
      TRICK_REVEAL_MS: 0,
      ROOM_TTL_MS: 60_000,
    },
  })

  const owner = service.createPlayer('Ana')
  const room = service.createRoom(owner)
  const otherPlayer = service.createPlayer('Beto')
  room.players.set(otherPlayer.id, otherPlayer)

  owner.connected = false
  otherPlayer.connected = true
  service.reassignOwnerIfNeeded(room)

  assert.equal(room.ownerId, otherPlayer.id)

  const ownerSocket = createSocketDouble('socket-owner')
  service.joinRoom(ownerSocket, room, owner, true)

  assert.equal(room.ownerId, owner.id)
  assert.equal(room.originalOwnerId, owner.id)
})

test('apenas o dono da sala pode adicionar bot', () => {
  const io = {
    on(event, handler) {
      if (event === 'connection') {
        this.connectionHandler = handler
      }
    },
  }

  const room = { ownerId: 'owner-1', status: 'lobby', seats: [null, null, null, null], players: new Map(), updatedAt: 0 }
  const player = { id: 'guest-1', name: 'Convidado' }
  const errors = []
  let createBotCalled = false

  const roomService = {
    requireCurrent() {
      return { room, player }
    },
    emitError(socket, code, message) {
      errors.push({ socketId: socket.id, code, message })
    },
    createBot() {
      createBotCalled = true
      return { id: 'bot-1', name: 'Bot', kind: 'bot' }
    },
    emitEvent() {},
    broadcastRoom() {},
  }

  registerRoomHandlers(io, roomService)

  const socket = createSocketDouble('socket-guest')
  io.connectionHandler(socket)
  socket.handlers.get('seat:add-bot')({ seatIndex: 2 })

  assert.deepEqual(errors, [
    {
      socketId: 'socket-guest',
      code: 'OWNER_ONLY',
      message: 'Só o dono da sala pode adicionar bots.',
    },
  ])
  assert.equal(createBotCalled, false)
})
