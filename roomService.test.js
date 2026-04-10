const test = require('node:test')
const assert = require('node:assert/strict')

const { registerRoomHandlers } = require('./src/socket/registerRoomHandlers')
const { createRoomService } = require('./src/services/roomService')

function createIoDouble() {
  const emissions = []

  return {
    emissions,
    connectionHandler: null,
    sockets: {
      sockets: new Map(),
    },
    on(event, handler) {
      if (event === 'connection') {
        this.connectionHandler = handler
      }
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
    pruneExpiredPlayers() {},
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

test('jogador expirado no lobby nao reconecta com token antigo', () => {
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

  registerRoomHandlers(io, service)

  const owner = service.createPlayer('Ana')
  owner.connected = true
  const room = service.createRoom(owner)
  room.seats[0] = owner.id

  const guest = service.createPlayer('Beto')
  guest.connected = false
  guest.disconnectExpiresAt = Date.now() - 1
  room.players.set(guest.id, guest)
  room.seats[1] = guest.id

  const socket = createSocketDouble('socket-new')
  io.connectionHandler(socket)
  socket.handlers.get('room:join')({
    roomCode: room.code,
    playerName: 'Carla',
    sessionToken: guest.sessionToken,
  })

  const joinedEvent = socket.emitted.find((entry) => entry.event === 'room:joined')

  assert.ok(joinedEvent)
  assert.notEqual(joinedEvent.payload.playerId, guest.id)
  assert.equal(room.players.has(guest.id), false)
  assert.equal(room.seats[1], null)
})

test('adicionar bot limpa reserva expirada sem esperar cleanup periodico', () => {
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

  registerRoomHandlers(io, service)

  const owner = service.createPlayer('Ana')
  owner.connected = true
  const room = service.createRoom(owner)
  room.players.set(owner.id, owner)
  room.seats[0] = owner.id

  const expired = service.createPlayer('Beto')
  expired.connected = false
  expired.disconnectExpiresAt = Date.now() - 1
  room.players.set(expired.id, expired)
  room.seats[2] = expired.id

  service.joinRoom(createSocketDouble('socket-owner-setup'), room, owner, false)

  const socket = createSocketDouble('socket-owner')
  service.joinRoom(socket, room, owner, true)
  io.connectionHandler(socket)

  socket.handlers.get('seat:add-bot')({ seatIndex: 2 })

  const seatedId = room.seats[2]
  const seatedPlayer = room.players.get(seatedId)

  assert.ok(seatedPlayer)
  assert.equal(seatedPlayer.kind, 'bot')
  assert.equal(room.players.has(expired.id), false)
})

test('cada nova rodada avanca o lugar que comeca', () => {
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

  registerRoomHandlers(io, service)

  const owner = service.createPlayer('Ana')
  const room = service.createRoom(owner)
  owner.connected = true
  room.seats[0] = owner.id

  const p2 = service.createPlayer('Beto')
  const p3 = service.createPlayer('Carla')
  const p4 = service.createPlayer('Duda')
  room.players.set(p2.id, p2)
  room.players.set(p3.id, p3)
  room.players.set(p4.id, p4)
  room.seats[1] = p2.id
  room.seats[2] = p3.id
  room.seats[3] = p4.id

  const socket = createSocketDouble('socket-owner')
  service.joinRoom(socket, room, owner, true)
  io.connectionHandler(socket)

  socket.handlers.get('game:start')()
  assert.equal(room.game.currentTurnSeat, 0)
  assert.equal(room.nextStartingSeat, 1)

  room.status = 'finished'
  socket.handlers.get('game:start')()
  assert.equal(room.game.currentTurnSeat, 1)
  assert.equal(room.nextStartingSeat, 2)
})

test('quem comeca pode arriar a rodada com menos de dez pontos', () => {
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

  registerRoomHandlers(io, service)

  const owner = service.createPlayer('Ana')
  owner.connected = true
  const room = service.createRoom(owner)
  room.seats[0] = owner.id

  const p2 = service.createPlayer('Beto')
  const p3 = service.createPlayer('Carla')
  const p4 = service.createPlayer('Duda')
  room.players.set(p2.id, p2)
  room.players.set(p3.id, p3)
  room.players.set(p4.id, p4)
  room.seats[1] = p2.id
  room.seats[2] = p3.id
  room.seats[3] = p4.id

  room.status = 'playing'
  room.game = {
    currentTurnSeat: 1,
    currentTrick: [],
    trickNumber: 1,
    hands: {
      [owner.id]: [{ points: 11 }],
      [p2.id]: [{ points: 4 }, { points: 2 }, { points: 0 }, { points: 0 }],
      [p3.id]: [{ points: 10 }],
      [p4.id]: [{ points: 3 }],
    },
  }

  const socket = createSocketDouble('socket-p2')
  service.joinRoom(socket, room, p2, true)
  io.connectionHandler(socket)

  socket.handlers.get('game:restart')()

  assert.equal(room.status, 'lobby')
  assert.equal(room.game, null)
  assert.ok(io.emissions.some((entry) => entry.event === 'game:event' && entry.payload.message === 'Beto arriou a rodada.'))
})

test('reiniciar mantém a mesma pessoa começando a rodada', () => {
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

  registerRoomHandlers(io, service)

  const owner = service.createPlayer('Ana')
  owner.connected = true
  const room = service.createRoom(owner)
  room.seats[0] = owner.id

  const p2 = service.createPlayer('Beto')
  const p3 = service.createPlayer('Carla')
  const p4 = service.createPlayer('Duda')
  room.players.set(p2.id, p2)
  room.players.set(p3.id, p3)
  room.players.set(p4.id, p4)
  room.seats[1] = p2.id
  room.seats[2] = p3.id
  room.seats[3] = p4.id
  room.nextStartingSeat = 2

  const socket = createSocketDouble('socket-owner')
  service.joinRoom(socket, room, owner, true)
  io.connectionHandler(socket)

  socket.handlers.get('game:start')()
  assert.equal(room.game.currentTurnSeat, 2)
  assert.equal(room.game.startingSeat, 2)
  assert.equal(room.nextStartingSeat, 3)

  socket.handlers.get('game:restart')()
  assert.equal(room.status, 'lobby')
  assert.equal(room.nextStartingSeat, 2)

  socket.handlers.get('game:start')()
  assert.equal(room.game.currentTurnSeat, 2)
  assert.equal(room.nextStartingSeat, 3)
})
