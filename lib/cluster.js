var _ = require('lodash'),
var format = require('string-format')
format.extend(String.prototype)

var settings = require('../config/main.js'),
    logger = require('./logger.js')

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

ClusterManager.prototype.createApplication = function (req, req) {
  var  

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
