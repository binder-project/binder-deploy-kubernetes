var forever = require('forever-monitor')

var kubeClient = require('../lib/client.js')

var server = null

// the proxy server must be started before all else
console.log('starting server')
server = new (forever.Monitor)('start.js')
server.start()

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
