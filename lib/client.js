var KubeClient = require('node-kubernetes-client')

var settings = require('../config/main.js')

// client should be initialized after Kubernetes proxy is started
var singleton = null

var getInstance = function () {
  if (singleton === null) {
    singleton = new KubeClient({
      host: settings.kube.proxyHost + ':' + settings.kube.proxyPort,
      protocol: 'http',
      version: settings.kube.apiVersion
    })
  }
  return singleton
}

module.exports = getInstance

