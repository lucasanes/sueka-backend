const crypto = require('node:crypto')
const {
  applyRoundResult,
  createGame,
  getPlayableCardIds,
  pickBotCard,
  playCard,
  resolvePendingTrick,
  teamForSeat,
} = require('../game/game')

const BOT_NAME_PREFIXES = ['Capitao', 'Mestre', 'Barao', 'Duque', 'Lorde', 'Sombra', 'Faulha', 'Brasa', 'Trunfo', 'Astro']
const BOT_NAME_SUFFIXES = ['Copas', 'Espadas', 'Ouros', 'Paus', 'Sete', 'As', 'Valete', 'Rei', 'Dama', 'Vaza']

function createRoomService({ io, rooms, socketRefs, env }) {
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
      kind: 'human',
    }
  }

  function createBot(room) {
    let name = ''
    let attempts = 0

    do {
      const prefix = BOT_NAME_PREFIXES[Math.floor(Math.random() * BOT_NAME_PREFIXES.length)]
      const suffix = BOT_NAME_SUFFIXES[Math.floor(Math.random() * BOT_NAME_SUFFIXES.length)]
      name = `${prefix} ${suffix}`
      attempts += 1
    } while ([...room.players.values()].some((player) => player.name === name) && attempts < 20)

    room.nextBotNumber += 1

    return {
      id: createId('bot'),
      name: attempts >= 20 ? `${name} ${room.nextBotNumber}` : name,
      sessionToken: null,
      socketId: null,
      connected: true,
      disconnectExpiresAt: null,
      kind: 'bot',
    }
  }

  function createRoom(owner) {
    const code = createRoomCode()
    const room = {
      code,
      originalOwnerId: owner.id,
      ownerId: owner.id,
      players: new Map([[owner.id, owner]]),
      seats: [null, null, null, null],
      status: 'lobby',
      game: null,
      nextStartingSeat: 0,
      matchScore: [0, 0],
      nextRoundStake: 1,
      matchWinnerTeam: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastEvent: null,
      nextBotNumber: 1,
      botTurnTimer: null,
      trickResolutionTimer: null,
    }

    rooms.set(code, room)
    return room
  }

  function clearBotTurnTimer(room) {
    if (room.botTurnTimer) {
      clearTimeout(room.botTurnTimer)
      room.botTurnTimer = null
    }
  }

  function clearTrickResolutionTimer(room) {
    if (room.trickResolutionTimer) {
      clearTimeout(room.trickResolutionTimer)
      room.trickResolutionTimer = null
    }
  }

  function resetMatchState(room) {
    room.nextStartingSeat = 0
    room.matchScore = [0, 0]
    room.nextRoundStake = 1
    room.matchWinnerTeam = null
  }

  function clearLobbySeats(room) {
    room.seats = room.seats.map(() => null)

    for (const [playerId, player] of room.players.entries()) {
      if (player.kind === 'bot') {
        room.players.delete(playerId)
      }
    }
  }

  function countHumanPlayers(room) {
    return [...room.players.values()].filter((player) => player.kind !== 'bot').length
  }

  function pickNextOwner(room) {
    const connectedSeated = room.seats
      .map((playerId) => (playerId ? room.players.get(playerId) : null))
      .filter((player) => player?.connected && player.kind !== 'bot')
    if (connectedSeated.length > 0) {
      return connectedSeated[0].id
    }

    const connectedPlayers = [...room.players.values()].filter((player) => player.connected && player.kind !== 'bot')
    if (connectedPlayers.length > 0) {
      return connectedPlayers[0].id
    }

    const seatedPlayers = room.seats
      .map((playerId) => (playerId ? room.players.get(playerId) : null))
      .filter((player) => player && player.kind !== 'bot')
    if (seatedPlayers.length > 0) {
      return seatedPlayers[0].id
    }

    return [...room.players.values()].find((player) => player.kind !== 'bot')?.id ?? null
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

  function restoreOriginalOwnerIfNeeded(room) {
    if (!room.originalOwnerId || room.ownerId === room.originalOwnerId) {
      return
    }

    const originalOwner = room.players.get(room.originalOwnerId)
    if (!originalOwner || originalOwner.kind === 'bot' || !originalOwner.connected) {
      return
    }

    room.ownerId = originalOwner.id
    emitEvent(room, `${originalOwner.name} voltou a ser o dono da sala.`)
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
      kind: player.kind,
      handCount: room.game?.hands[player.id]?.length ?? 0,
      team: teamForSeat(seatIndex),
    }
  }

  function snapshotFor(room, viewerId) {
    const viewerSeat = room.seats.indexOf(viewerId)
    const viewerTeam = viewerSeat === -1 ? null : teamForSeat(viewerSeat)
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
      playableCardIds: isViewerTurn && !room.game?.pendingTrickResolution ? getPlayableCardIds(hand, room.game.currentTrick) : [],
      wonTricks: viewerTeam === null ? [] : room.game?.wonTricks?.[viewerTeam] ?? [],
      lastEvent: room.lastEvent,
    }
  }

  function broadcastRoom(room) {
    for (const player of room.players.values()) {
      if (player.kind === 'human' && player.socketId) {
        io.to(player.socketId).emit('room:state', snapshotFor(room, player.id))
      }
    }
  }

  function resolveRoundIfFinished(room) {
    const roundResult = applyRoundResult(room.matchScore, room.nextRoundStake, room.game.scores)
    room.matchScore = roundResult.updatedMatchScore
    room.nextRoundStake = roundResult.nextRoundStake
    room.matchWinnerTeam = roundResult.matchWinner

    if (roundResult.roundWinner === null) {
      emitEvent(room, `A rodada empatou. A próxima vale ${room.nextRoundStake}.`)
    } else {
      emitEvent(
        room,
        `A dupla ${roundResult.roundWinner + 1} venceu a rodada, valeu ${roundResult.awardedPoints} e foi para ${roundResult.updatedMatchScore[roundResult.roundWinner]} no placar.`,
      )
    }

    if (room.matchWinnerTeam !== null) {
      emitEvent(room, `A dupla ${room.matchWinnerTeam + 1} venceu a Sueka.`)
    }
  }

  function scheduleBotTurn(room) {
    clearBotTurnTimer(room)

    if (room.status !== 'playing' || !room.game) {
      return
    }

    const currentPlayerId = room.seats[room.game.currentTurnSeat]
    if (!currentPlayerId) {
      return
    }

    const currentPlayer = room.players.get(currentPlayerId)
    if (!currentPlayer || currentPlayer.kind !== 'bot') {
      return
    }

    room.botTurnTimer = setTimeout(() => {
      room.botTurnTimer = null

      if (room.status !== 'playing' || !room.game) {
        return
      }

      const playerId = room.seats[room.game.currentTurnSeat]
      if (!playerId) {
        return
      }

      const bot = room.players.get(playerId)
      if (!bot || bot.kind !== 'bot') {
        return
      }

      try {
        const botHand = room.game.hands[bot.id] ?? []
        const completedTricks = room.game.wonTricks.flat()
        const card = pickBotCard(botHand, room.game.currentTrick, room.game.trump, room.game.currentTurnSeat, completedTricks)
        playTurn(room, bot, card.id)
      } catch {
        emitEvent(room, `${bot.name} não conseguiu jogar.`)
        broadcastRoom(room)
      }
    }, env.BOT_TURN_DELAY_MS)
  }

  function playTurn(room, player, cardId) {
    const cardBefore = room.game.hands[player.id]?.find((card) => card.id === cardId)
    const result = playCard(room.game, room.seats, player.id, cardId)
    room.updatedAt = Date.now()

    if (result.completedTrick) {
      const winner = room.players.get(room.seats[result.completedTrick.winnerSeat])
      emitEvent(room, `${player.name} jogou ${cardBefore.rank}. ${winner.name} venceu a vaza.`)
    } else {
      emitEvent(room, `${player.name} jogou ${cardBefore.rank}.`)
    }

    broadcastRoom(room)

    if (!result.completedTrick) {
      scheduleBotTurn(room)
      return
    }

    clearTrickResolutionTimer(room)
    room.trickResolutionTimer = setTimeout(() => {
      room.trickResolutionTimer = null

      if (room.status !== 'playing' || !room.game?.pendingTrickResolution) {
        return
      }

      const resolution = resolvePendingTrick(room.game)
      room.updatedAt = Date.now()

      if (resolution.finished) {
        room.status = 'finished'
        clearBotTurnTimer(room)
        resolveRoundIfFinished(room)
      }

      broadcastRoom(room)
      scheduleBotTurn(room)
    }, env.TRICK_REVEAL_MS)
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
    restoreOriginalOwnerIfNeeded(room)
    broadcastRoom(room)
  }

  function pruneExpiredPlayers(room, now = Date.now()) {
    let changed = false

    for (const player of room.players.values()) {
      if (player.kind === 'bot' || player.connected || !player.disconnectExpiresAt || player.disconnectExpiresAt >= now) {
        continue
      }

      const seatIndex = room.seats.indexOf(player.id)
      if (seatIndex !== -1) {
        room.seats[seatIndex] = null
      }

      const wasOwner = room.ownerId === player.id
      const wasOriginalOwner = room.originalOwnerId === player.id
      room.players.delete(player.id)

      if (wasOwner) {
        reassignOwnerIfNeeded(room)
      }
      if (wasOriginalOwner) {
        room.originalOwnerId = null
      }

      changed = true
    }

    if (changed) {
      room.updatedAt = now
    }

    return changed
  }

  function cleanupRooms(now) {
    for (const [code, room] of rooms.entries()) {
      if (room.status === 'lobby') {
        pruneExpiredPlayers(room, now)
      }

      const hasConnectedPlayers = [...room.players.values()].some((player) => player.kind !== 'bot' && player.connected)
      if (countHumanPlayers(room) === 0 || (!hasConnectedPlayers && now - room.updatedAt > env.ROOM_TTL_MS)) {
        clearBotTurnTimer(room)
        clearTrickResolutionTimer(room)
        rooms.delete(code)
      } else {
        broadcastRoom(room)
      }
    }
  }

  return {
    rooms,
    socketRefs,
    createPlayer,
    createBot,
    createRoom,
    countHumanPlayers,
    findPlayerBySession,
    reassignOwnerIfNeeded,
    restoreOriginalOwnerIfNeeded,
    requireCurrent,
    joinRoom,
    emitError,
    emitEvent,
    broadcastRoom,
    playTurn,
    scheduleBotTurn,
    clearBotTurnTimer,
    clearTrickResolutionTimer,
    resetMatchState,
    clearLobbySeats,
    pruneExpiredPlayers,
    cleanupRooms,
  }
}

module.exports = {
  createRoomService,
}
