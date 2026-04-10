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
    wonTricks: [[], []],
    pendingTrickResolution: null,
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

function compareWeakCards(a, b) {
  const powerDiff = (RANK_POWER.get(a.rank) ?? 0) - (RANK_POWER.get(b.rank) ?? 0)
  if (powerDiff !== 0) {
    return powerDiff
  }

  return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
}

function compareStrongCards(a, b) {
  const powerDiff = (RANK_POWER.get(b.rank) ?? 0) - (RANK_POWER.get(a.rank) ?? 0)
  if (powerDiff !== 0) {
    return powerDiff
  }

  return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
}

function trickPoints(currentTrick) {
  return currentTrick.reduce((total, play) => total + play.card.points, 0)
}

function countSuitCards(hand, suit) {
  return hand.filter((card) => card.suit === suit).length
}

function pickLowest(cards) {
  return [...cards].sort(compareWeakCards)[0]
}

function pickHighest(cards) {
  return [...cards].sort(compareStrongCards)[0]
}

function pickOpeningCard(playableCards, trumpSuit) {
  const sevensWithAceSupport = playableCards.filter(
    (card) => card.rank === '7' && playableCards.some((other) => other.suit === card.suit && other.rank === 'A'),
  )
  if (sevensWithAceSupport.length > 0) {
    return pickHighest(sevensWithAceSupport)
  }

  const nonTrumpAces = playableCards.filter((card) => card.rank === 'A' && card.suit !== trumpSuit)
  if (nonTrumpAces.length > 0) {
    return pickHighest(nonTrumpAces)
  }

  const nonTrumpSevens = playableCards.filter((card) => card.rank === '7' && card.suit !== trumpSuit)
  if (nonTrumpSevens.length > 0) {
    return pickHighest(nonTrumpSevens)
  }

  const anyAces = playableCards.filter((card) => card.rank === 'A')
  if (anyAces.length > 0) {
    return pickHighest(anyAces)
  }

  const nonTrumpCards = playableCards.filter((card) => card.suit !== trumpSuit)
  return pickLowest(nonTrumpCards.length > 0 ? nonTrumpCards : playableCards)
}

function getCurrentWinningPlay(currentTrick, trumpSuit) {
  const leadSuit = currentTrick[0].card.suit
  return currentTrick.reduce((bestPlay, play) =>
    compareCards(play.card, bestPlay.card, leadSuit, trumpSuit) > 0 ? play : bestPlay,
  )
}

function comparePlayableStrength(a, b, leadSuit, trumpSuit) {
  const result = compareCards(a, b, leadSuit, trumpSuit)
  if (result !== 0) {
    return result
  }

  return compareWeakCards(a, b)
}

function preferAggressiveWinner(winningCards, leadSuit, trumpSuit, currentTrick) {
  const pointsOnTable = trickPoints(currentTrick)
  const lastToAct = currentTrick.length === 3
  const sameSuitWinners = winningCards.filter((card) => card.suit === leadSuit)
  const trumpWinners = winningCards.filter((card) => card.suit === trumpSuit)

  if (sameSuitWinners.length > 0) {
    const aces = sameSuitWinners.filter((card) => card.rank === 'A')
    if (aces.length > 0 && (pointsOnTable >= 4 || lastToAct)) {
      return pickHighest(aces)
    }

    const sevens = sameSuitWinners.filter((card) => card.rank === '7')
    if (sevens.length > 0 && (pointsOnTable >= 10 || lastToAct)) {
      return pickHighest(sevens)
    }
  }

  if (trumpWinners.length > 0) {
    return pickLowest(trumpWinners)
  }

  return winningCards[0]
}

function pickBotCard(hand, currentTrick, trumpSuit, seatIndex = -1) {
  const playableCards = hand.filter((card) => canPlayCard(hand, currentTrick, card))
  if (playableCards.length === 0) {
    throw new Error('NO_PLAYABLE_CARDS')
  }

  if (currentTrick.length === 0) {
    return pickOpeningCard(playableCards, trumpSuit)
  }

  const leadSuit = currentTrick[0].card.suit
  const currentWinningPlay = getCurrentWinningPlay(currentTrick, trumpSuit)
  const partnerSeat = seatIndex === -1 ? -1 : (seatIndex + 2) % 4
  const partnerWinning = currentWinningPlay.seatIndex === partnerSeat
  const pointsOnTable = trickPoints(currentTrick)
  const followSuitCards = playableCards.filter((card) => card.suit === leadSuit)
  const trumpCards = playableCards.filter((card) => card.suit === trumpSuit)

  if (!partnerWinning) {
    const winningCards = playableCards
      .filter((card) => compareCards(card, currentWinningPlay.card, leadSuit, trumpSuit) > 0)
      .sort((left, right) => comparePlayableStrength(left, right, leadSuit, trumpSuit))

    if (winningCards.length > 0) {
      return preferAggressiveWinner(winningCards, leadSuit, trumpSuit, currentTrick)
    }
  }

  if (followSuitCards.length > 0) {
    return pickLowest(followSuitCards)
  }

  if (partnerWinning) {
    const nonTrumpCards = playableCards.filter((card) => card.suit !== trumpSuit)
    if (nonTrumpCards.length > 0) {
      return pickLowest(nonTrumpCards)
    }
    return pickLowest(trumpCards)
  }

  const nonTrumpCards = playableCards.filter((card) => card.suit !== trumpSuit)
  if (nonTrumpCards.length > 0) {
    if (pointsOnTable < 10) {
      return pickLowest(nonTrumpCards)
    }
    if (trumpCards.length > 0) {
      return pickLowest(trumpCards)
    }
    return pickLowest(nonTrumpCards)
  }

  return pickLowest(playableCards)
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
  if (game.pendingTrickResolution) {
    throw new Error('TRICK_RESOLVING')
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
  const trickSummary = {
    ...completedTrick,
    trickNumber: game.trickNumber,
    cards: [...game.currentTrick],
  }
  game.pendingTrickResolution = trickSummary
  game.currentTurnSeat = null

  const finished = Object.values(game.hands).every((playerHand) => playerHand.length === 0)

  return { completedTrick: trickSummary, finished }
}

function resolvePendingTrick(game) {
  if (!game.pendingTrickResolution) {
    throw new Error('NO_PENDING_TRICK')
  }

  const completedTrick = game.pendingTrickResolution
  game.scores[completedTrick.team] += completedTrick.points
  game.wonTricks[completedTrick.team].push(completedTrick)
  game.currentTrick = []
  game.currentTurnSeat = completedTrick.winnerSeat
  game.pendingTrickResolution = null

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
  pickBotCard,
  playCard,
  resolvePendingTrick,
  resolveTrick,
  applyRoundResult,
  teamForSeat,
}
