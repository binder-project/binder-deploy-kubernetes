var forever = require('forever-monitor')

var server = null

before(function () {
  console.log('starting server')
  server = new (forever.Monitor)('start.js')
  server.start()
})

after(function () {
  console.log('stopping server')
  server.stop()
})

setTimeout(function () {
  run()
}, 2000)
