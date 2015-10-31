var KubeClient = require('node-kubernetes-client')

var settings = require('../config/main.js')

module.exports = new KubeClient({
  host: settings.kube.proxyHost + ':' + settings.kube.proxyPort,
  protocol: 'http',
  version: settings.kube.apiVersion
})


