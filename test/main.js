var forever = require('forever-monitor')

var server = null

before(function (done) {
  console.log('starting server')
  server = new (forever.Monitor)('start.js')
  server.on('start', function () {
    done()
  })
  server.start()
})

after(function (done) {
  console.log('stopping server')
  server.on('stop', function () {
    done()
  })
  server.stop()
})

setTimeout(function () {
  run()
}, 2000)
