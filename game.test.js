const test = require('node:test')
const assert = require('node:assert/strict')
const { applyRoundResult, createGame, playCard, resolveTrick } = require('./game')

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

test('finishes after all hands are empty and scores the last trick', () => {
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
  assert.equal(game.scores[0], 27)
  assert.equal(game.winnerTeam, 0)
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
