var KubeClient = require('kube-stream')
var settings = require('./settings')

// client should be initialized after Kubernetes proxy is started
var singleton = null

var getInstance = function () {
  if (singleton === null) {
    singleton = new KubeClient(settings.kube)
  }
  return singleton
}

module.exports = getInstance

