const { createGame } = require('../game/game')
const { RECONNECT_WINDOW_MS } = require('../config/env')

function handPoints(cards = []) {
  return cards.reduce((sum, card) => sum + (card.points ?? 0), 0)
}

function canPlayerArryCurrentRound(room, player) {
  if (room.status !== 'playing' || !room.game) {
    return false
  }

  const playerSeat = room.seats.indexOf(player.id)
  if (playerSeat === -1 || room.game.currentTurnSeat !== playerSeat) {
    return false
  }

  const isRoundOpening = room.game.trickNumber === 1 && room.game.currentTrick.length === 0
  if (!isRoundOpening) {
    return false
  }

  return handPoints(room.game.hands[player.id]) < 10
}

function registerRoomHandlers(io, roomService) {
  io.on('connection', (socket) => {
    socket.on('room:create', ({ playerName } = {}) => {
      const owner = roomService.createPlayer(playerName)
      const room = roomService.createRoom(owner)
      roomService.joinRoom(socket, room, owner, false)
    })

    socket.on('room:join', ({ roomCode, playerName, sessionToken } = {}) => {
      const room = roomService.rooms.get(String(roomCode ?? '').trim().toUpperCase())
      if (!room) {
        roomService.emitError(socket, 'ROOM_NOT_FOUND', 'Sala não encontrada.')
        return
      }

      if (room.status === 'lobby') {
        roomService.pruneExpiredPlayers(room)
      }

      const reconnectingPlayer = roomService.findPlayerBySession(room, sessionToken)
      if (reconnectingPlayer) {
        roomService.joinRoom(socket, room, reconnectingPlayer, true)
        return
      }

      if (room.status !== 'lobby') {
        roomService.emitError(socket, 'GAME_IN_PROGRESS', 'A partida já começou.')
        return
      }

      if (room.players.size >= 4) {
        roomService.emitError(socket, 'ROOM_FULL', 'A sala está cheia.')
        return
      }

      const player = roomService.createPlayer(playerName)
      room.players.set(player.id, player)
      roomService.joinRoom(socket, room, player, false)
    })

    socket.on('seat:take', ({ seatIndex } = {}) => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      const index = Number(seatIndex)
      if (room.status !== 'lobby') {
        roomService.emitError(socket, 'GAME_LOCKED', 'Os assentos ficam travados durante a partida.')
        return
      }
      roomService.pruneExpiredPlayers(room)
      if (!Number.isInteger(index) || index < 0 || index > 3) {
        roomService.emitError(socket, 'INVALID_SEAT', 'Escolha um assento válido.')
        return
      }

      const occupyingPlayerId = room.seats[index]
      const occupyingPlayer = occupyingPlayerId ? room.players.get(occupyingPlayerId) : null
      if (occupyingPlayerId && occupyingPlayerId !== player.id && occupyingPlayer?.kind !== 'bot') {
        roomService.emitError(socket, 'SEAT_TAKEN', 'Esse assento já está ocupado.')
        return
      }

      const previousSeat = room.seats.indexOf(player.id)
      if (previousSeat !== -1) {
        room.seats[previousSeat] = null
      }

      if (occupyingPlayer?.kind === 'bot') {
        room.players.delete(occupyingPlayer.id)
        roomService.emitEvent(room, `${player.name} assumiu o lugar do ${occupyingPlayer.name}.`)
      }

      room.seats[index] = player.id
      room.updatedAt = Date.now()
      if (occupyingPlayer?.kind !== 'bot') {
        roomService.emitEvent(room, `${player.name} sentou na posição ${index + 1}.`)
      }
      roomService.broadcastRoom(room)
    })

    socket.on('seat:add-bot', ({ seatIndex } = {}) => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      const index = Number(seatIndex)
      if (player.id !== room.ownerId) {
        roomService.emitError(socket, 'OWNER_ONLY', 'Só o dono da sala pode adicionar bots.')
        return
      }
      if (room.status !== 'lobby') {
        roomService.emitError(socket, 'GAME_LOCKED', 'Os bots só podem ser adicionados no lobby.')
        return
      }
      roomService.pruneExpiredPlayers(room)
      if (!Number.isInteger(index) || index < 0 || index > 3) {
        roomService.emitError(socket, 'INVALID_SEAT', 'Escolha um assento válido.')
        return
      }
      if (room.seats[index]) {
        roomService.emitError(socket, 'SEAT_TAKEN', 'Esse assento já está ocupado.')
        return
      }
      if (room.players.size >= 4) {
        roomService.emitError(socket, 'ROOM_FULL', 'A sala já está completa.')
        return
      }

      const bot = roomService.createBot(room)
      room.players.set(bot.id, bot)
      room.seats[index] = bot.id
      room.updatedAt = Date.now()
      roomService.emitEvent(room, `${player.name} adicionou ${bot.name} na posição ${index + 1}.`)
      roomService.broadcastRoom(room)
    })

    socket.on('game:start', () => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      if (player.id !== room.ownerId) {
        roomService.emitError(socket, 'OWNER_ONLY', 'Só o dono da sala pode iniciar.')
        return
      }
      if (room.status === 'playing') {
        roomService.emitError(socket, 'GAME_ALREADY_STARTED', 'A partida já foi iniciada.')
        return
      }
      if (!room.seats.every(Boolean)) {
        roomService.emitError(socket, 'MISSING_PLAYERS', 'São necessários 4 jogadores sentados.')
        return
      }

      const wasFinished = room.status === 'finished'
      roomService.clearBotTurnTimer(room)
      roomService.clearTrickResolutionTimer(room)
      if (room.matchWinnerTeam !== null) {
        roomService.resetMatchState(room)
        roomService.emitEvent(room, 'Novo placar de Sueka iniciado.')
      }

      room.game = createGame(room.seats, room.nextStartingSeat)
      room.status = 'playing'
      room.nextStartingSeat = (room.nextStartingSeat + 1) % room.seats.length
      room.updatedAt = Date.now()
      roomService.emitEvent(room, wasFinished ? 'A próxima rodada começou.' : 'A partida começou.')
      roomService.broadcastRoom(room)
      roomService.scheduleBotTurn(room)
    })

    socket.on('card:play', ({ cardId } = {}) => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      if (room.status !== 'playing' || !room.game) {
        roomService.emitError(socket, 'GAME_NOT_STARTED', 'A partida ainda não começou.')
        return
      }

      try {
        roomService.playTurn(room, player, cardId)
      } catch (error) {
        const messages = {
          PLAYER_NOT_SEATED: 'Você precisa estar sentado para jogar.',
          NOT_YOUR_TURN: 'Ainda não é sua vez.',
          TRICK_RESOLVING: 'A vaza acabou de fechar. Aguarde a próxima.',
          CARD_NOT_IN_HAND: 'Essa carta não está na sua mão.',
          MUST_FOLLOW_SUIT: 'Você precisa seguir o naipe da vaza.',
        }
        roomService.emitError(socket, error.message, messages[error.message] ?? 'Jogada inválida.')
      }
    })

    socket.on('game:restart', () => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      const ownerRestart = player.id === room.ownerId
      const arryRestart = canPlayerArryCurrentRound(room, player)

      if (!ownerRestart && !arryRestart) {
        roomService.emitError(socket, 'OWNER_ONLY', 'Só o dono da sala pode reiniciar.')
        return
      }

      if (room.game?.startingSeat !== undefined) {
        room.nextStartingSeat = room.game.startingSeat
      }

      room.game = null
      room.status = 'lobby'
      roomService.clearBotTurnTimer(room)
      roomService.clearTrickResolutionTimer(room)
      if (room.matchWinnerTeam !== null) {
        roomService.resetMatchState(room)
        roomService.emitEvent(room, 'A rodada foi reiniciada e um novo placar de Sueka foi aberto.')
      } else if (arryRestart) {
        roomService.emitEvent(room, `${player.name} arriou a rodada.`)
      } else {
        roomService.emitEvent(room, 'A rodada foi reiniciada. O placar da Sueka foi mantido.')
      }
      room.updatedAt = Date.now()
      roomService.broadcastRoom(room)
    })

    socket.on('game:restart-match', () => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      if (player.id !== room.ownerId) {
        roomService.emitError(socket, 'OWNER_ONLY', 'Só o dono da sala pode reiniciar a partida.')
        return
      }

      room.game = null
      room.status = 'lobby'
      roomService.clearBotTurnTimer(room)
      roomService.clearTrickResolutionTimer(room)
      roomService.resetMatchState(room)
      roomService.clearLobbySeats(room)
      room.updatedAt = Date.now()
      roomService.emitEvent(room, 'A partida foi reiniciada e o placar da Sueka voltou a zero.')
      roomService.broadcastRoom(room)
    })

    socket.on('room:leave', () => {
      const current = roomService.requireCurrent(socket)
      if (!current) {
        return
      }

      const { room, player } = current
      roomService.clearBotTurnTimer(room)
      roomService.clearTrickResolutionTimer(room)
      roomService.socketRefs.delete(socket.id)
      socket.leave(room.code)
      const seatIndex = room.status === 'lobby' ? room.seats.indexOf(player.id) : -1
      if (seatIndex !== -1) {
        room.seats[seatIndex] = null
      }
      player.socketId = null
      player.connected = false
      player.disconnectExpiresAt = Date.now() + RECONNECT_WINDOW_MS
      if (room.ownerId === player.id) {
        roomService.reassignOwnerIfNeeded(room)
      }
      room.updatedAt = Date.now()
      roomService.emitEvent(room, `${player.name} saiu da sala. A vaga fica reservada por alguns minutos.`)

      if (roomService.countHumanPlayers(room) === 0) {
        roomService.clearBotTurnTimer(room)
        roomService.clearTrickResolutionTimer(room)
        roomService.rooms.delete(room.code)
        return
      }

      roomService.broadcastRoom(room)
    })

    socket.on('disconnect', () => {
      const ref = roomService.socketRefs.get(socket.id)
      if (!ref) {
        return
      }

      const room = roomService.rooms.get(ref.roomCode)
      const player = room?.players.get(ref.playerId)
      roomService.socketRefs.delete(socket.id)
      if (!room || !player || player.socketId !== socket.id) {
        return
      }
      if (player.kind === 'bot') {
        return
      }

      player.socketId = null
      player.connected = false
      player.disconnectExpiresAt = Date.now() + RECONNECT_WINDOW_MS
      room.updatedAt = Date.now()
      if (room.ownerId === player.id) {
        roomService.reassignOwnerIfNeeded(room)
      }
      roomService.emitEvent(room, `${player.name} desconectou. A vaga fica reservada por alguns minutos.`)
      roomService.broadcastRoom(room)
    })
  })
}

module.exports = {
  registerRoomHandlers,
}
