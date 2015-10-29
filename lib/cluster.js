var _ = require('lodash'),
  format = require('string-format')
format.extend(String.prototype)

var KubeClient = require('node-kubernetes-client')

var settings = require('../config/main.js'),
    logger = require('./logger.js')

function ClusterManager(opts) {
  this.opts = opts
  this.client = new KubeClient({
    host: settings.kube.proxyHost + ':' + settings.kube.proxyPort,
    protocol: 'http',
    version: 'v1'
  })
}

ClusterManager.prototype.getAllApplications = function (req, res) {
  var self = this

  var template = req.params.template

  this.client.pods.get(function (err, apiRes) {
    if (err) {
      return res.status(500).end()
    }
    var pods = apiRes[0].items
    var notebookPods = _.filter(pods, function (pod) {
      var namespace = pod.metadata.namespace
      var name = pod.metadata.name
      return (namespace !== 'kube-system') &&
             (namespace !== 'default') &&
             (name === 'notebook-server') &&
             (!template || pod.metadata.labels.template === template)
    }).map(function (pod) {
      var id = pod.metadata.namespace
      return {
        id: id,
        template: pod.metadata.labels.template,
        location: self.getLocation(id)
      }
    })
    res.write(notebookPods).end()
  })
}

ClusterManager.prototype.createApplication = function (req, req) {

}

ClusterManager.prototype.getApplication = function (req, res) {
  var self = this

  var template = req.params.template
  var id = req.params.id

  this.client.pods.get(function (err
}

ClusterManager.prototype.getLocation = function (id) {
  return '/user/{0}'.format(id)
}

module.exports = ClusterManager
