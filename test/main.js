var forever = require('forever-monitor')
var wait = require('wait.for')

var settings = require('../config/main.js')
var kubeClient = require('../lib/client.js')
var format = require('string-format')
format.extend(String.prototype)

var server = null
var cluster = true

var client = kubeClient()
function checkCluster () {
  var port = settings.kube.proxyPort
  server = new (forever.Monitor)(['kubectl.sh', 'proxy', '--port={0}'.format(port)], {
    max: 3
  })
  server.start()
  setTimeout(function () {
    client.pods.get(function (err, pods) {
      if (err) {
        console.log(err)
        console.log('WARNING: Kubernetes cluster not available. Only doing local testing')
        cluster = false
      }
      run()
    })
  // give the kubernetes proxy server 5 seconds to start up
  }, 5000)
}
wait.launchFiber(checkCluster)

module.exports = {
  clusterAvailable: function () {
    return cluster
  },
  server: server
}
