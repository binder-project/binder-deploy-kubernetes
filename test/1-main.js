var forever = require('forever-monitor')
var wait = require('wait.for')
var KubeClient = require('kube-stream')

var settings = require('../config/main.js')
var format = require('string-format')
format.extend(String.prototype)

var server = null
var cluster = true

function checkCluster () {
  console.log('Checking for cluster presence...')
  var client = new KubeClient()
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
      console.log('Kubernetes cluster available -- performing remote tests')
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
