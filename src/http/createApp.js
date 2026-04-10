const express = require('express')
const cors = require('cors')

function createApp(frontendOrigins, getRoomCount) {
  const app = express()

  app.use(cors({ origin: frontendOrigins }))
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: getRoomCount() })
  })

  return app
}

module.exports = {
  createApp,
}
