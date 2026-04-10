const test = require('node:test')
const assert = require('node:assert/strict')
const { applyRoundResult, createGame, pickBotCard, playCard, resolvePendingTrick, resolveTrick } = require('./game')

function card(rank, suit) {
  return { id: `${rank}-${suit}`, rank, suit, points: { A: 11, 7: 10, K: 4, J: 3, Q: 2 }[rank] ?? 0 }
}

test('resolve trick with trump over lead suit', () => {
  const trick = [
    { seatIndex: 0, playerId: 'p1', card: card('A', 'hearts') },
    { seatIndex: 1, playerId: 'p2', card: card('2', 'spades') },
    { seatIndex: 2, playerId: 'p3', card: card('7', 'hearts') },
    { seatIndex: 3, playerId: 'p4', card: card('K', 'clubs') },
  ]

  assert.deepEqual(resolveTrick(trick, 'spades'), {
    winnerSeat: 1,
    points: 25,
    team: 1,
  })
})

test('player must follow the lead suit when possible', () => {
  const seats = ['p1', 'p2', 'p3', 'p4']
  const game = createGame(seats)
  game.trump = 'spades'
  game.currentTurnSeat = 1
  game.currentTrick = [{ seatIndex: 0, playerId: 'p1', card: card('A', 'hearts') }]
  game.hands.p2 = [card('2', 'hearts'), card('A', 'spades')]

  assert.throws(() => playCard(game, seats, 'p2', 'A-spades'), /MUST_FOLLOW_SUIT/)
  assert.doesNotThrow(() => playCard(game, seats, 'p2', '2-hearts'))
})

test('keeps the completed trick visible until resolution and then finishes the round', () => {
  const seats = ['p1', 'p2', 'p3', 'p4']
  const game = createGame(seats)
  game.trump = 'clubs'
  game.currentTurnSeat = 0
  game.hands = {
    p1: [card('A', 'hearts')],
    p2: [card('7', 'hearts')],
    p3: [card('K', 'hearts')],
    p4: [card('Q', 'hearts')],
  }

  playCard(game, seats, 'p1', 'A-hearts')
  playCard(game, seats, 'p2', '7-hearts')
  playCard(game, seats, 'p3', 'K-hearts')
  const result = playCard(game, seats, 'p4', 'Q-hearts')

  assert.equal(result.finished, true)
  assert.equal(game.currentTrick.length, 4)
  assert.equal(game.pendingTrickResolution?.cards.length, 4)
  assert.equal(game.scores[0], 0)
  assert.equal(game.currentTurnSeat, null)

  const resolved = resolvePendingTrick(game)

  assert.equal(resolved.finished, true)
  assert.equal(game.currentTrick.length, 0)
  assert.equal(game.scores[0], 27)
  assert.equal(game.winnerTeam, 0)
  assert.equal(game.wonTricks[0].length, 1)
  assert.equal(game.wonTricks[0][0].trickNumber, 1)
  assert.equal(game.wonTricks[0][0].cards.length, 4)
})

test('tie keeps match score and increases next round value', () => {
  assert.deepEqual(applyRoundResult([1, 2], 1, [60, 60]), {
    roundWinner: null,
    roundValue: 0,
    awardedPoints: 0,
    updatedMatchScore: [1, 2],
    nextRoundStake: 2,
    matchWinner: null,
  })
})

test('simple round win adds one point to the match score', () => {
  assert.deepEqual(applyRoundResult([1, 0], 1, [70, 50]), {
    roundWinner: 0,
    roundValue: 1,
    awardedPoints: 1,
    updatedMatchScore: [2, 0],
    nextRoundStake: 1,
    matchWinner: null,
  })
})

test('round win with more than 90 points adds two points to the match score', () => {
  assert.deepEqual(applyRoundResult([1, 0], 1, [92, 28]), {
    roundWinner: 0,
    roundValue: 2,
    awardedPoints: 2,
    updatedMatchScore: [3, 0],
    nextRoundStake: 1,
    matchWinner: null,
  })
})

test('capote round with 120 points adds four points and can finish the sueka match', () => {
  assert.deepEqual(applyRoundResult([0, 1], 1, [120, 0]), {
    roundWinner: 0,
    roundValue: 4,
    awardedPoints: 4,
    updatedMatchScore: [4, 1],
    nextRoundStake: 1,
    matchWinner: 0,
  })
})

test('carried round stake is multiplied by the round value', () => {
  assert.deepEqual(applyRoundResult([3, 1], 2, [70, 50]), {
    roundWinner: 0,
    roundValue: 1,
    awardedPoints: 2,
    updatedMatchScore: [5, 1],
    nextRoundStake: 1,
    matchWinner: 0,
  })
})

test('carried round with more than 90 points multiplies the awarded value', () => {
  assert.deepEqual(applyRoundResult([0, 0], 2, [91, 29]), {
    roundWinner: 0,
    roundValue: 2,
    awardedPoints: 4,
    updatedMatchScore: [4, 0],
    nextRoundStake: 1,
    matchWinner: 0,
  })
})

test('bot uses a stronger follow-suit card when it can take the trick', () => {
  const chosen = pickBotCard([card('A', 'hearts'), card('2', 'hearts'), card('K', 'spades')], [{ seatIndex: 0, playerId: 'p1', card: card('7', 'hearts') }], 'spades')

  assert.equal(chosen.id, 'A-hearts')
})

test('bot takes a non-trump lead immediately with the ace of that suit', () => {
  const chosen = pickBotCard([card('A', 'clubs'), card('Q', 'clubs')], [{ seatIndex: 0, playerId: 'p1', card: card('2', 'clubs') }], 'hearts', 1)

  assert.equal(chosen.id, 'A-clubs')
})

test('bot opens with an ace in most normal leads', () => {
  const chosen = pickBotCard([card('A', 'clubs'), card('Q', 'hearts'), card('3', 'spades')], [], 'diamonds', 0)

  assert.equal(chosen.id, 'A-clubs')
})

test('bot avoids pulling trump immediately with a lone trump ace when safer off-suit leads exist', () => {
  const chosen = pickBotCard([card('A', 'spades'), card('K', 'hearts'), card('3', 'clubs')], [], 'spades', 0)

  assert.equal(chosen.id, '3-clubs')
})

test('bot can still make passagem even with a very strong trump suit', () => {
  const chosen = pickBotCard([card('A', 'spades'), card('7', 'spades'), card('K', 'spades'), card('2', 'spades')], [], 'spades', 0)

  assert.equal(chosen.id, '7-spades')
})

test('bot can make passagem when it has real support in that suit', () => {
  const chosen = pickBotCard([card('7', 'clubs'), card('A', 'clubs'), card('3', 'clubs')], [], 'spades', 0)

  assert.equal(chosen.id, '7-clubs')
})

test('bot avoids passagem when it only has seven and ace with no extra suit support', () => {
  const chosen = pickBotCard([card('7', 'clubs'), card('A', 'clubs'), card('3', 'hearts')], [], 'spades', 0)

  assert.equal(chosen.id, 'A-clubs')
})

test('bot avoids opening with an unsupported seven when a safer lead exists', () => {
  const chosen = pickBotCard([card('7', 'clubs'), card('3', 'hearts'), card('2', 'spades')], [], 'diamonds', 0)

  assert.equal(chosen.id, '2-spades')
})

test('bot pulls a suit that its partner has already cut before', () => {
  const completedTricks = [
    {
      cards: [
        { seatIndex: 1, playerId: 'p2', card: card('K', 'clubs') },
        { seatIndex: 2, playerId: 'p3', card: card('2', 'spades') },
        { seatIndex: 3, playerId: 'p4', card: card('Q', 'clubs') },
        { seatIndex: 0, playerId: 'p1', card: card('3', 'clubs') },
      ],
    },
  ]

  const chosen = pickBotCard([card('4', 'clubs'), card('2', 'hearts')], [], 'spades', 0, completedTricks)

  assert.equal(chosen.id, '4-clubs')
})

test('bot avoids pulling a suit when an opponent has already shown void in it', () => {
  const completedTricks = [
    {
      cards: [
        { seatIndex: 0, playerId: 'p1', card: card('K', 'hearts') },
        { seatIndex: 1, playerId: 'p2', card: card('2', 'spades') },
        { seatIndex: 2, playerId: 'p3', card: card('Q', 'hearts') },
        { seatIndex: 3, playerId: 'p4', card: card('3', 'hearts') },
      ],
    },
  ]

  const chosen = pickBotCard([card('4', 'hearts'), card('2', 'clubs')], [], 'spades', 0, completedTricks)

  assert.equal(chosen.id, '2-clubs')
})

test('bot wins the trick with the weakest card that still beats the current winner', () => {
  const chosen = pickBotCard(
    [card('A', 'spades'), card('Q', 'spades')],
    [
      { seatIndex: 0, playerId: 'p1', card: card('7', 'spades') },
      { seatIndex: 1, playerId: 'p2', card: card('K', 'spades') },
      { seatIndex: 2, playerId: 'p3', card: card('Q', 'diamonds') },
    ],
    'clubs',
    3,
  )

  assert.equal(chosen.id, 'A-spades')
})

test('bot adds points when partner is already winning the trick safely', () => {
  const chosen = pickBotCard(
    [card('A', 'spades'), card('Q', 'spades')],
    [
      { seatIndex: 0, playerId: 'p1', card: card('7', 'spades') },
      { seatIndex: 1, playerId: 'p2', card: card('A', 'spades') },
      { seatIndex: 2, playerId: 'p3', card: card('Q', 'diamonds') },
    ],
    'clubs',
    3,
  )

  assert.equal(chosen.id, 'A-spades')
})

test('bot adds points when partner is safely winning the trick', () => {
  const chosen = pickBotCard(
    [card('7', 'clubs'), card('Q', 'clubs')],
    [{ seatIndex: 0, playerId: 'p1', card: card('A', 'clubs') }],
    'hearts',
    2,
  )

  assert.equal(chosen.id, '7-clubs')
})

test('bot uses trump when it cannot follow suit and can win the trick', () => {
  const chosen = pickBotCard([card('A', 'clubs'), card('3', 'diamonds'), card('2', 'spades')], [{ seatIndex: 0, playerId: 'p1', card: card('7', 'hearts') }], 'spades')

  assert.equal(chosen.id, '2-spades')
})

test('bot cuts with the weakest trump that still wins the trick', () => {
  const chosen = pickBotCard([card('A', 'spades'), card('2', 'spades')], [{ seatIndex: 0, playerId: 'p1', card: card('7', 'hearts') }], 'spades')

  assert.equal(chosen.id, '2-spades')
})

test('bot avoids cutting a low-value trick with an unnecessarily high trump', () => {
  const chosen = pickBotCard(
    [card('A', 'spades'), card('3', 'spades')],
    [{ seatIndex: 0, playerId: 'p1', card: card('2', 'clubs') }],
    'spades',
    1,
  )

  assert.equal(chosen.id, '3-spades')
})

test('bot spends a strong follow-suit card when the trick already has many points', () => {
  const chosen = pickBotCard(
    [card('A', 'hearts'), card('2', 'hearts')],
    [
      { seatIndex: 0, playerId: 'p1', card: card('K', 'hearts') },
    ],
    'spades',
    1,
  )

  assert.equal(chosen.id, 'A-hearts')
})

test('bot does not throw seven under an enemy ace when a lower card is available', () => {
  const chosen = pickBotCard(
    [card('7', 'spades'), card('3', 'spades')],
    [{ seatIndex: 0, playerId: 'p1', card: card('A', 'spades') }],
    'hearts',
    1,
  )

  assert.equal(chosen.id, '3-spades')
})

test('bot preserves seven when losing a trick and a two of the same suit is available', () => {
  const chosen = pickBotCard(
    [card('7', 'clubs'), card('2', 'clubs')],
    [{ seatIndex: 0, playerId: 'p1', card: card('A', 'clubs') }],
    'hearts',
    1,
  )

  assert.equal(chosen.id, '2-clubs')
})

test('bot preserves higher point cards when dumping under an unbeatable ace', () => {
  const chosen = pickBotCard(
    [card('7', 'clubs'), card('K', 'clubs'), card('Q', 'clubs')],
    [{ seatIndex: 0, playerId: 'p1', card: card('A', 'clubs') }],
    'hearts',
    1,
  )

  assert.equal(chosen.id, 'Q-clubs')
})
