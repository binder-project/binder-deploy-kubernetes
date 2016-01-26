var KubeClient = require('node-kubernetes-client')

// client should be initialized after Kubernetes proxy is started
var singleton = null

var getInstance = function (opts) {
  if (singleton === null) {
    singleton = new KubeClient({
      host: opts.kube.proxyHost + ':' + opts.kube.proxyPort,
      protocol: 'http',
      version: opts.kube.apiVersion
    })
  }
  return singleton
}

module.exports = getInstance

