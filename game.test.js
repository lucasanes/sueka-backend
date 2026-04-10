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
    updatedMatchScore: [1, 2],
    nextRoundStake: 2,
    matchWinner: null,
  })
})

test('round win adds carried value and can finish the sueka match', () => {
  assert.deepEqual(applyRoundResult([3, 1], 2, [70, 50]), {
    roundWinner: 0,
    updatedMatchScore: [5, 1],
    nextRoundStake: 1,
    matchWinner: 0,
  })
})

test('bot follows the lead suit with the weakest valid card', () => {
  const chosen = pickBotCard([card('A', 'hearts'), card('2', 'hearts'), card('K', 'spades')], [{ seatIndex: 0, playerId: 'p1', card: card('7', 'hearts') }], 'spades')

  assert.equal(chosen.id, '2-hearts')
})

test('bot discards the weakest non-trump when it cannot follow suit', () => {
  const chosen = pickBotCard([card('A', 'clubs'), card('3', 'diamonds'), card('2', 'spades')], [{ seatIndex: 0, playerId: 'p1', card: card('7', 'hearts') }], 'spades')

  assert.equal(chosen.id, '3-diamonds')
})

test('bot uses the weakest trump when only trump cards are available', () => {
  const chosen = pickBotCard([card('A', 'spades'), card('2', 'spades')], [{ seatIndex: 0, playerId: 'p1', card: card('7', 'hearts') }], 'spades')

  assert.equal(chosen.id, '2-spades')
})
