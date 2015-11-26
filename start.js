var DeployServer = require('./lib/server.js')
var server = new DeployServer()
var apiKey = server.start()
console.log('apiKey: ' + apiKey)
