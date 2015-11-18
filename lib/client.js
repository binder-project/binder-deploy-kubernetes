var KubeClient = require('node-kubernetes-client')

var settings = require('../config/main.js')

// client should be initialized after Kubernetes proxy is started
var client = null

var getInstance = function () {
  if (client === null) {
    client = new KubeClient({
      host: settings.kube.proxyHost + ':' + settings.kube.proxyPort,
      protocol: 'http',
      version: settings.kube.apiVersion
    })
  }
  return client
}

module.exports = getInstance

