const crypto = require('node:crypto')
const express = require('express')
const cors = require('cors')
const { createServer } = require('node:http')
const { Server } = require('socket.io')
const { applyRoundResult, createGame, getPlayableCardIds, playCard, teamForSeat } = require('./game')

const PORT = Number(process.env.PORT ?? 3333)
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
const RECONNECT_WINDOW_MS = 3 * 60 * 1000
const ROOM_TTL_MS = 30 * 60 * 1000

const rooms = new Map()
const socketRefs = new Map()

const app = express()
app.use(cors({ origin: FRONTEND_ORIGINS }))
app.use(express.json())
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGINS,
    methods: ['GET', 'POST'],
  },
})

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`
}

function createRoomCode() {
  let code = ''
  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase()
  } while (rooms.has(code))
  return code
}

function createPlayer(name) {
  return {
    id: createId('player'),
    name: String(name ?? '').trim().slice(0, 24) || 'Jogador',
    sessionToken: createId('session'),
    socketId: null,
    connected: false,
    disconnectExpiresAt: null,
  }
}

function createRoom(owner) {
  const code = createRoomCode()
  const room = {
    code,
    ownerId: owner.id,
    players: new Map([[owner.id, owner]]),
    seats: [null, null, null, null],
    status: 'lobby',
    game: null,
    matchScore: [0, 0],
    nextRoundStake: 1,
    matchWinnerTeam: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastEvent: null,
  }
  rooms.set(code, room)
  return room
}

function pickNextOwner(room) {
  const connectedSeated = room.seats
    .map((playerId) => (playerId ? room.players.get(playerId) : null))
    .filter((player) => player?.connected)
  if (connectedSeated.length > 0) {
    return connectedSeated[0].id
  }

  const connectedPlayers = [...room.players.values()].filter((player) => player.connected)
  if (connectedPlayers.length > 0) {
    return connectedPlayers[0].id
  }

  const seatedPlayers = room.seats
    .map((playerId) => (playerId ? room.players.get(playerId) : null))
    .filter(Boolean)
  if (seatedPlayers.length > 0) {
    return seatedPlayers[0].id
  }

  return [...room.players.values()][0]?.id ?? null
}

function reassignOwnerIfNeeded(room) {
  const currentOwner = room.players.get(room.ownerId)
  if (currentOwner?.connected) {
    return
  }

  const nextOwnerId = pickNextOwner(room)
  if (!nextOwnerId || nextOwnerId === room.ownerId) {
    return
  }

  room.ownerId = nextOwnerId
  const nextOwner = room.players.get(nextOwnerId)
  emitEvent(room, `${nextOwner.name} agora é o dono da sala.`)
}

function findPlayerBySession(room, sessionToken) {
  if (!sessionToken) {
    return null
  }

  return [...room.players.values()].find((player) => player.sessionToken === sessionToken) ?? null
}

function attachSocket(socket, room, player) {
  if (player.socketId && player.socketId !== socket.id) {
    io.sockets.sockets.get(player.socketId)?.disconnect(true)
  }

  player.socketId = socket.id
  player.connected = true
  player.disconnectExpiresAt = null
  room.updatedAt = Date.now()
  socket.join(room.code)
  socketRefs.set(socket.id, { roomCode: room.code, playerId: player.id })
}

function emitError(socket, code, message) {
  socket.emit('room:error', { code, message })
}

function emitEvent(room, message) {
  room.lastEvent = { id: createId('event'), message, at: Date.now() }
  io.to(room.code).emit('game:event', room.lastEvent)
}

function publicSeat(room, playerId, seatIndex) {
  if (!playerId) {
    return null
  }

  const player = room.players.get(playerId)
  if (!player) {
    return null
  }

  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    isOwner: player.id === room.ownerId,
    handCount: room.game?.hands[player.id]?.length ?? 0,
    team: teamForSeat(seatIndex),
  }
}

function snapshotFor(room, viewerId) {
  const viewerSeat = room.seats.indexOf(viewerId)
  const hand = room.game?.hands[viewerId] ?? []
  const isViewerTurn = room.status === 'playing' && room.game?.currentTurnSeat === viewerSeat

  return {
    roomCode: room.code,
    status: room.status,
    ownerId: room.ownerId,
    viewerId,
    viewerSeat,
    seats: room.seats.map((playerId, seatIndex) => publicSeat(room, playerId, seatIndex)),
    trump: room.game?.trump ?? null,
    currentTurnSeat: room.game?.currentTurnSeat ?? null,
    currentTrick: room.game?.currentTrick ?? [],
    trickNumber: room.game?.trickNumber ?? 0,
    scores: room.game?.scores ?? [0, 0],
    winnerTeam: room.game?.winnerTeam ?? null,
    matchScore: room.matchScore,
    nextRoundStake: room.nextRoundStake,
    matchWinnerTeam: room.matchWinnerTeam,
    hand,
    playableCardIds: isViewerTurn ? getPlayableCardIds(hand, room.game.currentTrick) : [],
    lastEvent: room.lastEvent,
  }
}

function broadcastRoom(room) {
  for (const player of room.players.values()) {
    if (player.socketId) {
      io.to(player.socketId).emit('room:state', snapshotFor(room, player.id))
    }
  }
}

function requireCurrent(socket) {
  const ref = socketRefs.get(socket.id)
  if (!ref) {
    emitError(socket, 'NOT_IN_ROOM', 'Entre em uma sala primeiro.')
    return null
  }

  const room = rooms.get(ref.roomCode)
  const player = room?.players.get(ref.playerId)
  if (!room || !player) {
    emitError(socket, 'ROOM_NOT_FOUND', 'Sala não encontrada.')
    return null
  }

  return { room, player }
}

function joinRoom(socket, room, player, isReconnect) {
  attachSocket(socket, room, player)
  socket.emit('room:joined', {
    roomCode: room.code,
    playerId: player.id,
    sessionToken: player.sessionToken,
  })
  emitEvent(room, isReconnect ? `${player.name} voltou para a sala.` : `${player.name} entrou na sala.`)
  broadcastRoom(room)
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ playerName } = {}) => {
    const owner = createPlayer(playerName)
    const room = createRoom(owner)
    joinRoom(socket, room, owner, false)
  })

  socket.on('room:join', ({ roomCode, playerName, sessionToken } = {}) => {
    const room = rooms.get(String(roomCode ?? '').trim().toUpperCase())
    if (!room) {
      emitError(socket, 'ROOM_NOT_FOUND', 'Sala não encontrada.')
      return
    }

    const reconnectingPlayer = findPlayerBySession(room, sessionToken)
    if (reconnectingPlayer) {
      joinRoom(socket, room, reconnectingPlayer, true)
      return
    }

    if (room.status !== 'lobby') {
      emitError(socket, 'GAME_IN_PROGRESS', 'A partida já começou.')
      return
    }

    if (room.players.size >= 4 && room.seats.every(Boolean)) {
      emitError(socket, 'ROOM_FULL', 'A sala está cheia.')
      return
    }

    const player = createPlayer(playerName)
    room.players.set(player.id, player)
    joinRoom(socket, room, player, false)
  })

  socket.on('seat:take', ({ seatIndex } = {}) => {
    const current = requireCurrent(socket)
    if (!current) {
      return
    }

    const { room, player } = current
    const index = Number(seatIndex)
    if (room.status !== 'lobby') {
      emitError(socket, 'GAME_LOCKED', 'Os assentos ficam travados durante a partida.')
      return
    }
    if (!Number.isInteger(index) || index < 0 || index > 3) {
      emitError(socket, 'INVALID_SEAT', 'Escolha um assento válido.')
      return
    }
    if (room.seats[index] && room.seats[index] !== player.id) {
      emitError(socket, 'SEAT_TAKEN', 'Esse assento já está ocupado.')
      return
    }

    const previousSeat = room.seats.indexOf(player.id)
    if (previousSeat !== -1) {
      room.seats[previousSeat] = null
    }
    room.seats[index] = player.id
    room.updatedAt = Date.now()
    emitEvent(room, `${player.name} sentou na posição ${index + 1}.`)
    broadcastRoom(room)
  })

  socket.on('game:start', () => {
    const current = requireCurrent(socket)
    if (!current) {
      return
    }

    const { room, player } = current
    if (player.id !== room.ownerId) {
      emitError(socket, 'OWNER_ONLY', 'Só o dono da sala pode iniciar.')
      return
    }
    if (room.status !== 'lobby') {
      emitError(socket, 'GAME_ALREADY_STARTED', 'A partida já foi iniciada.')
      return
    }
    if (!room.seats.every(Boolean)) {
      emitError(socket, 'MISSING_PLAYERS', 'São necessários 4 jogadores sentados.')
      return
    }

    room.game = createGame(room.seats)
    room.status = 'playing'
    room.updatedAt = Date.now()
    emitEvent(room, 'A partida começou.')
    broadcastRoom(room)
  })

  socket.on('card:play', ({ cardId } = {}) => {
    const current = requireCurrent(socket)
    if (!current) {
      return
    }

    const { room, player } = current
    if (room.status !== 'playing' || !room.game) {
      emitError(socket, 'GAME_NOT_STARTED', 'A partida ainda não começou.')
      return
    }

    try {
      const cardBefore = room.game.hands[player.id]?.find((card) => card.id === cardId)
      const result = playCard(room.game, room.seats, player.id, cardId)
      room.updatedAt = Date.now()

      if (result.completedTrick) {
        const winner = room.players.get(room.seats[result.completedTrick.winnerSeat])
        emitEvent(room, `${player.name} jogou ${cardBefore.rank}. ${winner.name} venceu a vaza.`)
      } else {
        emitEvent(room, `${player.name} jogou ${cardBefore.rank}.`)
      }

      if (result.finished) {
        room.status = 'finished'
        const roundResult = applyRoundResult(room.matchScore, room.nextRoundStake, room.game.scores)
        room.matchScore = roundResult.updatedMatchScore
        room.nextRoundStake = roundResult.nextRoundStake
        room.matchWinnerTeam = roundResult.matchWinner

        if (roundResult.roundWinner === null) {
          emitEvent(room, `A rodada empatou. A próxima vale ${room.nextRoundStake}.`)
        } else {
          emitEvent(
            room,
            `A dupla ${roundResult.roundWinner + 1} venceu a rodada e fez ${roundResult.updatedMatchScore[roundResult.roundWinner]} no placar.`,
          )
        }

        if (room.matchWinnerTeam !== null) {
          emitEvent(room, `A dupla ${room.matchWinnerTeam + 1} venceu a Sueka.`)
        }
      }

      broadcastRoom(room)
    } catch (error) {
      const messages = {
        PLAYER_NOT_SEATED: 'Você precisa estar sentado para jogar.',
        NOT_YOUR_TURN: 'Ainda não é sua vez.',
        CARD_NOT_IN_HAND: 'Essa carta não está na sua mão.',
        MUST_FOLLOW_SUIT: 'Você precisa seguir o naipe da vaza.',
      }
      emitError(socket, error.message, messages[error.message] ?? 'Jogada inválida.')
    }
  })

  socket.on('game:restart', () => {
    const current = requireCurrent(socket)
    if (!current) {
      return
    }

    const { room, player } = current
    if (player.id !== room.ownerId) {
      emitError(socket, 'OWNER_ONLY', 'Só o dono da sala pode reiniciar.')
      return
    }
    if (room.status !== 'finished') {
      emitError(socket, 'GAME_NOT_FINISHED', 'A partida atual ainda não terminou.')
      return
    }

    room.game = null
    room.status = 'lobby'
    if (room.matchWinnerTeam !== null) {
      room.matchScore = [0, 0]
      room.nextRoundStake = 1
      room.matchWinnerTeam = null
      emitEvent(room, 'Novo placar de Sueka iniciado.')
    }
    room.updatedAt = Date.now()
    emitEvent(room, 'A sala voltou para o lobby.')
    broadcastRoom(room)
  })

  socket.on('room:leave', () => {
    const current = requireCurrent(socket)
    if (!current) {
      return
    }

    const { room, player } = current
    socketRefs.delete(socket.id)
    socket.leave(room.code)
    const seatIndex = room.seats.indexOf(player.id)
    if (seatIndex !== -1) {
      room.seats[seatIndex] = null
    }
    room.players.delete(player.id)
    player.socketId = null
    player.connected = false
    player.disconnectExpiresAt = null
    if (room.ownerId === player.id) {
      reassignOwnerIfNeeded(room)
    }
    room.updatedAt = Date.now()
    emitEvent(room, `${player.name} saiu da sala.`)

    if (room.players.size === 0) {
      rooms.delete(room.code)
      return
    }

    broadcastRoom(room)
  })

  socket.on('disconnect', () => {
    const ref = socketRefs.get(socket.id)
    if (!ref) {
      return
    }

    const room = rooms.get(ref.roomCode)
    const player = room?.players.get(ref.playerId)
    socketRefs.delete(socket.id)
    if (!room || !player || player.socketId !== socket.id) {
      return
    }

    player.socketId = null
    player.connected = false
    player.disconnectExpiresAt = Date.now() + RECONNECT_WINDOW_MS
    room.updatedAt = Date.now()
    if (room.ownerId === player.id) {
      reassignOwnerIfNeeded(room)
    }
    emitEvent(room, `${player.name} desconectou. A vaga fica reservada por alguns minutos.`)
    broadcastRoom(room)
  })
})

setInterval(() => {
  const now = Date.now()

  for (const [code, room] of rooms.entries()) {
    for (const player of room.players.values()) {
      if (!player.connected && player.disconnectExpiresAt && player.disconnectExpiresAt < now && room.status === 'lobby') {
        const seatIndex = room.seats.indexOf(player.id)
        if (seatIndex !== -1) {
          room.seats[seatIndex] = null
        }
        const wasOwner = room.ownerId === player.id
        room.players.delete(player.id)
        if (wasOwner) {
          reassignOwnerIfNeeded(room)
        }
      }
    }

    const hasConnectedPlayers = [...room.players.values()].some((player) => player.connected)
    if (!hasConnectedPlayers && now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(code)
    } else {
      broadcastRoom(room)
    }
  }
}, 30_000)

httpServer.listen(PORT, () => {
  console.log(`Sueka socket server listening on http://localhost:${PORT}`)
})
