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

function previousSeatIndex(startingSeat, seatsLength) {
  return (startingSeat + seatsLength - 1) % seatsLength
}

function ensurePreviousSeatHasTrump(deck, startingSeat, seatsLength = 4) {
  const preparedDeck = [...deck]
  const trumpSuit = preparedDeck[preparedDeck.length - 1]?.suit

  if (!trumpSuit) {
    return preparedDeck
  }

  const requiredSeat = previousSeatIndex(startingSeat, seatsLength)
  const requiredSeatCards = preparedDeck.filter((_, index) => index % seatsLength === requiredSeat)
  const alreadyHasTrump = requiredSeatCards.some((card) => card.suit === trumpSuit)
  if (alreadyHasTrump) {
    return preparedDeck
  }

  const trumpCardIndex = preparedDeck.findIndex(
    (card, index) => card.suit === trumpSuit && index % seatsLength !== requiredSeat && index !== preparedDeck.length - 1,
  )
  const swapTargetIndex = preparedDeck.findIndex((card, index) => card.suit !== trumpSuit && index % seatsLength === requiredSeat)

  if (trumpCardIndex === -1 || swapTargetIndex === -1) {
    return preparedDeck
  }

  ;[preparedDeck[trumpCardIndex], preparedDeck[swapTargetIndex]] = [preparedDeck[swapTargetIndex], preparedDeck[trumpCardIndex]]

  return preparedDeck
}

function createGame(seats, startingSeat = 0, deck = shuffleDeck(createDeck())) {
  const preparedDeck = ensurePreviousSeatHasTrump(deck, startingSeat, seats.length)
  const hands = Object.fromEntries(seats.map((playerId) => [playerId, []]))

  preparedDeck.forEach((card, index) => {
    hands[seats[index % seats.length]].push(card)
  })

  return {
    deck: preparedDeck,
    hands,
    trump: preparedDeck[preparedDeck.length - 1].suit,
    startingSeat,
    currentTurnSeat: startingSeat,
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

function getRoundValue(scores, winnerTeam) {
  const winnerScore = scores[winnerTeam] ?? 0

  if (winnerScore === 120) {
    return 4
  }

  if (winnerScore > 90) {
    return 2
  }

  return 1
}

function applyRoundResult(matchScore, roundStake, scores) {
  const roundWinner = getRoundWinner(scores)

  if (roundWinner === null) {
    return {
      roundWinner: null,
      roundValue: 0,
      awardedPoints: 0,
      updatedMatchScore: [...matchScore],
      nextRoundStake: roundStake + 1,
      matchWinner: null,
    }
  }

  const updatedMatchScore = [...matchScore]
  const roundValue = getRoundValue(scores, roundWinner)
  const awardedPoints = roundStake * roundValue
  updatedMatchScore[roundWinner] += awardedPoints

  return {
    roundWinner,
    roundValue,
    awardedPoints,
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

function pickHighestPoints(cards) {
  return [...cards].sort((left, right) => {
    const pointDiff = right.points - left.points
    if (pointDiff !== 0) {
      return pointDiff
    }

    return compareStrongCards(left, right)
  })[0]
}

function pickEmbarkCard(cards) {
  const nonAces = cards.filter((card) => card.rank !== 'A')
  return pickHighestPoints(nonAces.length > 0 ? nonAces : cards)
}

function pickSafestLoser(cards) {
  const zeroPointCards = cards.filter((card) => card.points === 0)
  if (zeroPointCards.length > 0) {
    return pickLowest(zeroPointCards)
  }

  return [...cards].sort((left, right) => {
    const pointDiff = left.points - right.points
    if (pointDiff !== 0) {
      return pointDiff
    }

    return compareWeakCards(left, right)
  })[0]
}

function totalPoints(cards) {
  return cards.reduce((sum, card) => sum + card.points, 0)
}

function flattenCompletedTricks(completedTricks) {
  return completedTricks.flatMap((entry) => (entry?.cards ? [entry.cards] : Array.isArray(entry) ? [entry] : []))
}

function hasSeenAceOfSuit(suit, currentTrick = [], completedTricks = []) {
  if (currentTrick.some((play) => play.card.suit === suit && play.card.rank === 'A')) {
    return true
  }

  return flattenCompletedTricks(completedTricks).some((trick) =>
    Array.isArray(trick) && trick.some((play) => play.card.suit === suit && play.card.rank === 'A'),
  )
}

function isProtectedSeven(card, hand, currentTrick = [], completedTricks = []) {
  if (card.rank !== '7') {
    return false
  }

  if (hand.some((other) => other.suit === card.suit && other.rank === 'A')) {
    return false
  }

  return !hasSeenAceOfSuit(card.suit, currentTrick, completedTricks)
}

function isExposedSeven(card, currentTrick = [], completedTricks = [], lastToAct = false) {
  if (card.rank !== '7' || lastToAct) {
    return false
  }

  return !hasSeenAceOfSuit(card.suit, currentTrick, completedTricks)
}

function avoidProtectedSeven(cards, hand, currentTrick = [], completedTricks = []) {
  const safeCards = cards.filter((card) => !isProtectedSeven(card, hand, currentTrick, completedTricks))
  return safeCards.length > 0 ? safeCards : cards
}

function inferSuitKnowledge(completedTricks, trumpSuit) {
  const voidSuitsBySeat = new Map()
  const cutSuitsBySeat = new Map()

  for (const trick of flattenCompletedTricks(completedTricks)) {
    if (!Array.isArray(trick) || trick.length === 0) {
      continue
    }

    const leadSuit = trick[0].card.suit

    for (const play of trick) {
      if (play.card.suit === leadSuit) {
        continue
      }

      const seatVoids = voidSuitsBySeat.get(play.seatIndex) ?? new Set()
      seatVoids.add(leadSuit)
      voidSuitsBySeat.set(play.seatIndex, seatVoids)

      if (play.card.suit === trumpSuit && leadSuit !== trumpSuit) {
        const seatCuts = cutSuitsBySeat.get(play.seatIndex) ?? new Set()
        seatCuts.add(leadSuit)
        cutSuitsBySeat.set(play.seatIndex, seatCuts)
      }
    }
  }

  return { voidSuitsBySeat, cutSuitsBySeat }
}

function scoreOpeningSuit(suit, suitCards, seatIndex, completedTricks, trumpSuit) {
  if (seatIndex === -1 || completedTricks.length === 0) {
    return 0
  }

  const { voidSuitsBySeat, cutSuitsBySeat } = inferSuitKnowledge(completedTricks, trumpSuit)
  const partnerSeat = (seatIndex + 2) % 4
  const enemySeats = [1, 3].map((offset) => (seatIndex + offset) % 4)
  const partnerCuts = cutSuitsBySeat.get(partnerSeat)

  let score = 0

  if (partnerCuts?.has(suit)) {
    score += 4
  }

  if (voidSuitsBySeat.get(partnerSeat)?.has(suit)) {
    score += 2
  }

  for (const enemySeat of enemySeats) {
    if (voidSuitsBySeat.get(enemySeat)?.has(suit)) {
      score -= 3
    }
  }

  score += Math.min(suitCards.length - 1, 2)

  return score
}

function pickKnowledgeBasedOpeningCard(cards, seatIndex, completedTricks, trumpSuit) {
  const cardsBySuit = new Map()

  for (const card of cards) {
    const suitCards = cardsBySuit.get(card.suit) ?? []
    suitCards.push(card)
    cardsBySuit.set(card.suit, suitCards)
  }

  const rankedSuits = [...cardsBySuit.entries()].sort((left, right) => {
    const scoreDiff = scoreOpeningSuit(right[0], right[1], seatIndex, completedTricks, trumpSuit) - scoreOpeningSuit(left[0], left[1], seatIndex, completedTricks, trumpSuit)
    if (scoreDiff !== 0) {
      return scoreDiff
    }

    return pickLowest(left[1]).id.localeCompare(pickLowest(right[1]).id)
  })

  return pickLowest(rankedSuits[0][1])
}

function pickPassagemCard(playableCards, trumpSuit) {
  const supportedSevens = playableCards.filter(
    (card) => card.rank === '7' && playableCards.some((other) => other.suit === card.suit && other.rank === 'A'),
  )

  const passagemCandidates = supportedSevens.filter((card) => {
    const suitCards = playableCards.filter((other) => other.suit === card.suit)
    const minimumSuitLength = card.suit === trumpSuit ? 5 : 4
    return suitCards.length >= minimumSuitLength
  })

  return passagemCandidates.length > 0 ? pickHighest(passagemCandidates) : null
}

function pickOpeningCard(playableCards, trumpSuit, seatIndex = -1, completedTricks = []) {
  const passagemCard = pickPassagemCard(playableCards, trumpSuit)
  if (passagemCard) {
    return passagemCard
  }

  const nonTrumpAces = playableCards.filter((card) => card.rank === 'A' && card.suit !== trumpSuit)
  if (nonTrumpAces.length > 0) {
    return pickHighest(nonTrumpAces)
  }

  const trumpCards = playableCards.filter((card) => card.suit === trumpSuit)
  const trumpAces = trumpCards.filter((card) => card.rank === 'A')
  const nonTrumpCards = playableCards.filter((card) => card.suit !== trumpSuit)
  const canSafelyPullTrump =
    trumpCards.length >= 4 &&
    totalPoints(trumpCards) >= 25 &&
    trumpCards.some((card) => card.rank === '7' || card.rank === 'K' || card.rank === 'J' || card.rank === 'Q')

  if (trumpAces.length > 0 && (nonTrumpCards.length === 0 || canSafelyPullTrump)) {
    return pickHighest(trumpAces)
  }

  if (nonTrumpCards.length > 0) {
    return pickKnowledgeBasedOpeningCard(nonTrumpCards, seatIndex, completedTricks, trumpSuit)
  }

  return pickKnowledgeBasedOpeningCard(playableCards, seatIndex, completedTricks, trumpSuit)
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

function preferAggressiveWinner(winningCards, hand, leadSuit, trumpSuit, currentTrick, completedTricks = []) {
  const pointsOnTable = trickPoints(currentTrick)
  const lastToAct = currentTrick.length === 3
  const sameSuitWinners = winningCards.filter((card) => card.suit === leadSuit)
  const trumpWinners = winningCards.filter((card) => card.suit === trumpSuit)
  const safeSameSuitWinners = sameSuitWinners.filter((card) => !isExposedSeven(card, currentTrick, completedTricks, lastToAct))

  if (safeSameSuitWinners.length > 0) {
    const aces = safeSameSuitWinners.filter((card) => card.rank === 'A')
    if (aces.length > 0 && leadSuit !== trumpSuit) {
      return pickHighest(aces)
    }

    if (aces.length > 0 && (pointsOnTable >= 4 || lastToAct)) {
      return pickHighest(aces)
    }

    const sevens = safeSameSuitWinners.filter((card) => card.rank === '7')
    if (sevens.length > 0 && (pointsOnTable >= 10 || lastToAct)) {
      const allowedSevens = avoidProtectedSeven(sevens, hand, currentTrick, completedTricks)
      if (allowedSevens.length > 0) {
        return pickHighest(allowedSevens)
      }
    }
  }

  if (trumpWinners.length > 0) {
    return pickLowest(avoidProtectedSeven(trumpWinners, hand, currentTrick, completedTricks))
  }

  return avoidProtectedSeven(winningCards, hand, currentTrick, completedTricks)[0]
}

function isPartnerWinnerSafe(currentWinningPlay, leadSuit, trumpSuit, lastToAct) {
  return (
    lastToAct ||
    currentWinningPlay.card.suit === trumpSuit ||
    currentWinningPlay.card.rank === 'A' ||
    currentWinningPlay.card.rank === '7'
  )
}

function pickBotCard(hand, currentTrick, trumpSuit, seatIndex = -1, completedTricks = []) {
  const playableCards = hand.filter((card) => canPlayCard(hand, currentTrick, card))
  if (playableCards.length === 0) {
    throw new Error('NO_PLAYABLE_CARDS')
  }

  if (currentTrick.length === 0) {
    return pickOpeningCard(playableCards, trumpSuit, seatIndex, completedTricks)
  }

  const leadSuit = currentTrick[0].card.suit
  const currentWinningPlay = getCurrentWinningPlay(currentTrick, trumpSuit)
  const partnerSeat = seatIndex === -1 ? -1 : (seatIndex + 2) % 4
  const partnerWinning = currentWinningPlay.seatIndex === partnerSeat
  const pointsOnTable = trickPoints(currentTrick)
  const lastToAct = currentTrick.length === 3
  const followSuitCards = playableCards.filter((card) => card.suit === leadSuit)
  const trumpCards = playableCards.filter((card) => card.suit === trumpSuit)
  const nonTrumpCards = playableCards.filter((card) => card.suit !== trumpSuit)
  const partnerLooksSafe = partnerWinning
    ? isPartnerWinnerSafe(currentWinningPlay, leadSuit, trumpSuit, lastToAct)
    : false

  if (!partnerWinning && followSuitCards.length === 0 && nonTrumpCards.length > 0 && pointsOnTable === 0) {
    return pickSafestLoser(nonTrumpCards)
  }

  if (!partnerWinning) {
    const winningCards = playableCards
      .filter((card) => compareCards(card, currentWinningPlay.card, leadSuit, trumpSuit) > 0)
      .sort((left, right) => comparePlayableStrength(left, right, leadSuit, trumpSuit))

    if (winningCards.length > 0) {
      return preferAggressiveWinner(winningCards, hand, leadSuit, trumpSuit, currentTrick, completedTricks)
    }
  }

  if (followSuitCards.length > 0) {
    if (partnerWinning) {
      const pointCards = avoidProtectedSeven(
        followSuitCards.filter((card) => card.points > 0),
        hand,
        currentTrick,
        completedTricks,
      )
      const trickIsTrumpLed = leadSuit === trumpSuit

      // Preserve high trumps when our partner is already winning a trump trick.
      if (!trickIsTrumpLed && partnerLooksSafe && pointCards.length > 0) {
        return pickEmbarkCard(pointCards)
      }
    }

    return pickSafestLoser(followSuitCards)
  }

  if (partnerWinning) {
    const nonTrumpCards = playableCards.filter((card) => card.suit !== trumpSuit)
    const nonTrumpPointCards = avoidProtectedSeven(
      nonTrumpCards.filter((card) => card.points > 0),
      hand,
      currentTrick,
      completedTricks,
    )

    if (partnerLooksSafe && nonTrumpPointCards.length > 0) {
      return pickEmbarkCard(nonTrumpPointCards)
    }

    if (nonTrumpCards.length > 0) {
      return pickSafestLoser(nonTrumpCards)
    }
    return pickSafestLoser(trumpCards)
  }

  if (nonTrumpCards.length > 0) {
    if (pointsOnTable < 10) {
      return pickSafestLoser(nonTrumpCards)
    }
    if (trumpCards.length > 0) {
      return pickSafestLoser(trumpCards)
    }
    return pickSafestLoser(nonTrumpCards)
  }

  return pickSafestLoser(playableCards)
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
