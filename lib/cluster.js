var _ = require('lodash')
var async = require('async')
var format = require('string-format')
format.extend(String.prototype)

var App = require('./state/app')
var RegistryClient = require('./registry')
var kubeClient = require('./client')
var getLogger = require('binder-logging').getLogger

var PreloadedSchema = {
  name: String,
  'start-time': { type: Date, default: Date.now },
  'status': String
}

function ClusterManager (db, opts) {
  this.opts = opts
  this.db = db
  this.registry = new RegistryClient(opts)

  App.initialize(db)
  this.preloaded = this.db.model('Preloaded', PreloadedSchema)

  this.logger = getLogger('binder-deploy-kubernetes')
}

/**
 * API handler that responds all applications (potentially only those matching a template)
 * running on the cluster
 */
ClusterManager.prototype.getAllApplications = function (api) {
  var self = this
  var template = api.params['template-name'] || {}
  App.find(api.params, function (err, matches) {
    if (err) {
      return api._badDatabase()
    } else {
      var formatted = matches.map(function (match) {
        return {
          id: match.id,
          'template-name': match.templateName,
          location: match.location,
          status: match.state
        }
      })
      return api._success(formatted)
    }
  })
}

/**
 * API handler that deploys an application on a Kubernetes cluster
 */
ClusterManager.prototype.createApplication = function (api) {
  var self = this
  var templateName = api.params['template-name']
  var cullTimeout = api.params['cull-timeout']
  self.logger.info('creating application with template {0}'.format(templateName))
  // TODO pooling is currently disabled until further testing
  /*
  if (this.opts.pool.enabled) {
    var appPool = _.find(this.pools.find({ templateName: templateName }), function (pool) {
      return pool.available() > 0
    })
    if (appPool) {
      appPool.assign(function (err, slot) {
        if (err) {
          return res.status(500).send('could not create application: {0}').format(err)
        }
        var rsp = {
          id: slot.id,
          location: slot.location
        }
        res.json(rsp)
      })
    } else {
      res.status(500).send('no pools available for template: {0}'.format(template.name))
    }
  } else {
  */
  self.registry.fetchTemplate(templateName, function (err, template) {
    if (err) return api._registryError()
    template['template-name'] = template.name
    var app = new App(template)
    if (cullTimeout) app.cullTimeout = cullTimeout
    self.logger.info('app created with template {0}, deploying with id {1}'.format(template, app.id))
    app.save(function (err) {
      if (err) {
        return api._badDatabase()
      }
      return api._success({
        id: app.id
      })
    })
  })
}

/**
 * API handler that gets information assicated with a single deployment
 */
ClusterManager.prototype.getApplication = function (api) {
  var self = this
  var template = api.params['template-name']
  var id = api.params.id
  App.findOne({ id: id }, function (err, app) {
    if (err) return api._badDatabase()
    if (!app || (app === {})) {
      return api._noRecord()
    } else {
      var formatted = {
        id: app.id,
        'template-name': app.templateName,
        location: app.location,
        status: app.state
      }
      api._success(formatted)
    }
  })
}

/**
 * Preloads a template onto all nodes of the cluster
 */
ClusterManager.prototype.preload = function (api) {
  var self = this
  var template = api.params['template-name']
  var kube = kubeClient()
  var updateOpts = { upsert: true, setDefaultsOnInsert: true }
  var pre = function (next) {
    var info = { name: template, status: 'loading' }
    self.preloaded.update({ name: template }, info, updateOpts, function (err) {
      return next(err)
    })
  }
  var post = function (next) {
    var info = { name: template, status: 'completed' }
    self.preloaded.update({ name: template }, info, updateOpts, function (err) {
      return next(err)
    })
  }
  var preload = function (next) {
    self.registry.fetchTemplate(template, function (err, template) {
      if (err) {
        api._registryError()
        return next(new Error('registry error: ' + err))
      }
      kube.nodes.get(function (err, nodes) {
        if (err) {
          api._badKubeRequest()
          return next(new Error('bad kube request: ' + err))
        }
        async.each(nodes, function (node, next) {
          template['template-name'] = template.name
          var app = new App(template)
          app.node = node.metadata.name
          app.pullPolicy = 'Always'
          // the app can be culled immediately after deployment
          app.cullTimeout = 1
          self.logger.info('preloading {0} onto {1}'.format(template, node.metadata.name))
          app.save(function (err) {
            return next(err)
          })
        }, function (err) {
          if (err) {
            api._badDatabase()
            return next(new Error('bad database: ' + err))
          }
          return next(null)
        })
      })
    })
  }
  async.series([
    pre,
    preload,
    post
  ], function (err) {
    if (err) {
      self.logger.error(err)
      return api._unknownFailure()
    }
    return api._success({
      template: template
    })
  })
}

/**
 * Get the status of a preloading template
 */
ClusterManager.prototype.preloadStatus = function (api) {
  var self = this
  var name = api.params['template-name']
  self.preloaded.findOne({ name: name }, function (err, status) {
    if (err) return api._badDatabase()
    status = status || {}
    return api._success(status)
  })
}

module.exports = ClusterManager
