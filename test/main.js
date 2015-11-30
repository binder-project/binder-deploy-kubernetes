var forever = require('forever-monitor')

var kubeClient = require('../lib/client.js')

var local = false
var server = null

// the proxy server must be started before all else
console.log('starting server')
server = new (forever.Monitor)('start.js', {
  max: 2
})
server.on('exit', function () {
  local = true
  console.log('Setting local to true')
})
server.start()

setTimeout(function () {
  run()
}, 5000)
