const SUITS = ['clubs', 'diamonds', 'hearts', 'spades']
const RANKS = ['A', '7', 'K', 'J', 'Q', '6', '5', '4', '3', '2']
const POINTS = { A: 11, 7: 10, K: 4, J: 3, Q: 2, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0 }
const RANK_POWER = new Map(RANKS.map((rank, index) => [rank, RANKS.length - index]))

function createDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${rank}-${suit}`,
      rank,
      suit,
      points: POINTS[rank],
    })),
  )
}

function shuffleDeck(deck) {
  const shuffled = [...deck]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

function createGame(seats, deck = shuffleDeck(createDeck())) {
  const hands = Object.fromEntries(seats.map((playerId) => [playerId, []]))

  deck.forEach((card, index) => {
    hands[seats[index % seats.length]].push(card)
  })

  return {
    deck,
    hands,
    trump: deck[deck.length - 1].suit,
    currentTurnSeat: 0,
    currentTrick: [],
    trickNumber: 1,
    scores: [0, 0],
    winnerTeam: null,
  }
}

function getRoundWinner(scores) {
  if (scores[0] === scores[1]) {
    return null
  }

  return scores[0] > scores[1] ? 0 : 1
}

function applyRoundResult(matchScore, roundStake, scores) {
  const roundWinner = getRoundWinner(scores)

  if (roundWinner === null) {
    return {
      roundWinner: null,
      updatedMatchScore: [...matchScore],
      nextRoundStake: roundStake + 1,
      matchWinner: null,
    }
  }

  const updatedMatchScore = [...matchScore]
  updatedMatchScore[roundWinner] += roundStake

  return {
    roundWinner,
    updatedMatchScore,
    nextRoundStake: 1,
    matchWinner: updatedMatchScore[roundWinner] >= 4 ? roundWinner : null,
  }
}

function teamForSeat(seatIndex) {
  return seatIndex % 2
}

function canPlayCard(hand, currentTrick, card) {
  if (currentTrick.length === 0) {
    return true
  }

  const leadSuit = currentTrick[0].card.suit
  const mustFollowSuit = hand.some((handCard) => handCard.suit === leadSuit)
  return !mustFollowSuit || card.suit === leadSuit
}

function getPlayableCardIds(hand, currentTrick) {
  return hand.filter((card) => canPlayCard(hand, currentTrick, card)).map((card) => card.id)
}

function compareCards(a, b, leadSuit, trumpSuit) {
  if (a.suit === b.suit) {
    return RANK_POWER.get(a.rank) - RANK_POWER.get(b.rank)
  }

  if (a.suit === trumpSuit && b.suit !== trumpSuit) {
    return 1
  }

  if (b.suit === trumpSuit && a.suit !== trumpSuit) {
    return -1
  }

  if (a.suit === leadSuit && b.suit !== leadSuit) {
    return 1
  }

  if (b.suit === leadSuit && a.suit !== leadSuit) {
    return -1
  }

  return 0
}

function resolveTrick(currentTrick, trumpSuit) {
  const leadSuit = currentTrick[0].card.suit
  const winner = currentTrick.reduce((bestPlay, play) =>
    compareCards(play.card, bestPlay.card, leadSuit, trumpSuit) > 0 ? play : bestPlay,
  )
  const points = currentTrick.reduce((total, play) => total + play.card.points, 0)

  return {
    winnerSeat: winner.seatIndex,
    points,
    team: teamForSeat(winner.seatIndex),
  }
}

function playCard(game, seats, playerId, cardId) {
  const seatIndex = seats.indexOf(playerId)
  if (seatIndex === -1) {
    throw new Error('PLAYER_NOT_SEATED')
  }

  if (seatIndex !== game.currentTurnSeat) {
    throw new Error('NOT_YOUR_TURN')
  }

  const hand = game.hands[playerId] ?? []
  const cardIndex = hand.findIndex((card) => card.id === cardId)
  if (cardIndex === -1) {
    throw new Error('CARD_NOT_IN_HAND')
  }

  const card = hand[cardIndex]
  if (!canPlayCard(hand, game.currentTrick, card)) {
    throw new Error('MUST_FOLLOW_SUIT')
  }

  hand.splice(cardIndex, 1)
  game.currentTrick.push({ seatIndex, playerId, card })

  if (game.currentTrick.length < 4) {
    game.currentTurnSeat = (seatIndex + 1) % 4
    return { completedTrick: null, finished: false }
  }

  const completedTrick = resolveTrick(game.currentTrick, game.trump)
  game.scores[completedTrick.team] += completedTrick.points
  game.currentTrick = []
  game.currentTurnSeat = completedTrick.winnerSeat

  const finished = Object.values(game.hands).every((playerHand) => playerHand.length === 0)
  if (finished) {
    game.winnerTeam = getRoundWinner(game.scores)
  } else {
    game.trickNumber += 1
  }

  return { completedTrick, finished }
}

module.exports = {
  RANKS,
  SUITS,
  canPlayCard,
  createDeck,
  createGame,
  getPlayableCardIds,
  getRoundWinner,
  playCard,
  resolveTrick,
  applyRoundResult,
  teamForSeat,
}
