var forever = require('forever-monitor')
var wait = require('wait.for')

var kubeClient = require('../lib/client.js')

var server = null
var cluster = false

// the proxy server must be started before all else
var client = kubeClient()
function checkCluster () {
  try {
    wait.for(client.pods.get)
  } catch (err) {
    console.log('WARNING: Kubernetes cluster not available. Only doing local testing')
    cluster = false
  }
  run()
}
wait.launchFiber(checkCluster)

module.exports = {
  clusterAvailable: function () {
    return cluster
  },
  server: server
}
