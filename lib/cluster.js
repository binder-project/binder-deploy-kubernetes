var _ = require('lodash'),
var format = require('string-format')
format.extend(String.prototype)

var settings = require('../config/main.js')
var logger = require('./logging.js')
var App = require('./app.js')

function ClusterManager(opts) {
  this.opts = opts
  this.apps = require('./apps.js')
  this.pools = require('./pools.js')
}

/**
 * HTTP handler that responds all applications (potentially only those matching a template) 
 * running on the cluster
 */
ClusterManager.prototype.getAllApplications = function (req, res) {
  var template = req.params.template
  this.apps.find(template, function (err, apps) {
    if (err) {
      res.status(500).end()
    } else {
      res.write(apps).end()
    }
  })
}

ClusterManager.prototype.createApplication = function (req, res) {
  var template = req.params.template
  if (!template) {
    res.status(500).end()
  } else {
    var appPools =  this.pools.find({template: template.name})
    if (appPools) {
      var pool = appPools[0]
      if (pool.unallocated) {
        var id = pool.unallocated.pop()
        this.pools.update(pool, function (err) {
          logger.error('could not update unallocated slots for pool: {0}'.format(template.name)) 
        })
        rsp = {
          id: id,
          location: App.location(id)
        }
        res.json(rsp)
      }
    } else {
      var app = new App(template) 
      this.apps.insert(app.pod(), function (err) {
        logger.error('could not create app: {0}'.format(app.id))
      })
    }
  }
}

ClusterManager.prototype.getApplication = function (req, res) {
  var self = this

  var template = req.params.template
  var id = req.params.id

  this.client.namespaces.get(function (err, apiRes) {
    if (err) {
      return res.status(500).end()
    }
    var namespaces = apiRes[0].items
    var 
  })
}

ClusterManager.prototype.getLocation = function (id) {
  return '/user/{0}'.format(id)
}

module.exports = ClusterManager
