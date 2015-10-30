var _ = require('lodash')
var KubeClient = require('node-kubernetes-client')
var format = require('string-format')
var async = require('async')
format.extend(String.prototype)

var Collection = require('./state/collection.js')
var settings = require('../config/main.js')
var logger = require('./logging.js')

var client = new KubeClient({
  host: settings.kube.proxyHost + ':' + settings.kube.proxyPort,
  protocol: 'http',
  version: 'v1'
})

var getLocation = function (id) {
  return '/user/{0}'.format(id)
}

module.exports = new Collection({
  name: 'apps',

  load: function (cb) {
    client.pods.get(function (err, apiRes) {
      if (err) {
        return cb(err)
      }
      var pods = apiRes[0].items
      var notebookPods = _.filter(pods, function (pod) {
        var namespace = pod.metadata.namespace
        var name = pod.metadata.name
        return (namespace !== 'kube-system') &&
               (namespace !== 'default') &&
               (name === 'notebook-server')
      }).map(function (pod) {
        var id = pod.metadata.namespace
        return {
          id: id,
          template: pod.metadata.labels.template,
          location: getLocation(id)
        }
      })
      cb(null, notebookPods)
    })
  },

  save: function (app, cb) {
    var metadata = app.metadata
    var spec = app.spec
    var labels = metadata.labels
    // TODO additional schema checking here?
    if (!'template' in labels) {
      cb(new Error('template not specified in metadata.labels'))
    }
    client.pods.create(app, function (err, apiRes) {
      cb(err)
    })
  },

  delete: function (app_id, cb) {
    var deletePod = function (next) {
      logger.info('deleting pods in namespace: {0}'.format(app_id))
      client.pods.delete(app, function (err, apiRes) {
        next(err)
      })
    }
    var deleteNamespace = function (next) {
      logger.info('deleting namespace: {0}'.format(app_id))
      client.namespaces.delete(app_id, function (err, apiRes) {
        next(err)
      })
    }
    async.series([
      deletePod, 
      deleteNamespace
    ], function (err, results) {
    })
  }
})

