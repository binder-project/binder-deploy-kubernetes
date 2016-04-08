var wait = require('wait.for')
var shell = require('shelljs')
var format = require('string-format')
format.extend(String.prototype)

var startWithPM2 = require('binder-utils').startWithPM2

var kubeClient = require('../lib/client')
var settings = require('../lib/settings')

var server = null
var cluster = true

function checkCluster () {
  console.log('Checking for cluster presence...')
  var client = kubeClient()
  var port = settings.kube.proxyPort
  var app = {
    name: 'binder-kubernetes-proxy',
    script: shell.which('kubectl.sh'),
    args: ['proxy', '--port={0}'.format(port)],
    exec_interpreter: 'none',
    silent: true
  }
  startWithPM2(app)
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
