var _ = require('lodash')
var format = require('string-format')
format.extend(String.prototype)

var settings = require('../config/main.js')
var logger = require('./logging.js')

function ClusterManager(opts) {
  this.opts = opts
  this.pools = require('./state/pool.js').pools
  this.apps = require('./state/app.js').apps
}

/**
 * HTTP handler that responds all applications (potentially only those matching a template) 
 * running on the cluster
 */
ClusterManager.prototype.getAllApplications = function (req, res) {
  var template = req.params.template
  this.apps.find(template, function (err, apps) {
    if (err) {
      res.status(500).send('Could not get all applications: {0}'.format(err))
    } else {
      res.write(apps).end()
    }
  })
}

ClusterManager.prototype.createApplication = function (req, res) {
  var template = req.params.template
  if (!template) {
    res.status(500).send('Template not specified in request')
  } else {
    var appPool = _.find(this.pools.find({ templateName: template.name }), function (pool) {
      return pool.available() > 0
    })
    if (appPool) {
      appPool.assign(function (err, slot) {
        if (err) {
          return res.status(500).send('Could not create application: {0}').format(err)
        }
        var rsp = {
          id: slot.id,
          location: slot.location
        }
        res.json(rsp)
      })
    } else {
      res.status(500).send('No pools available for template: {0}'.format(template.name))
    }
  }
}

ClusterManager.prototype.getApplication = function (req, res) {
  var template = req.params.template
  var id = req.params.id
  var matching = this.apps.find({ id: id })
  if (!matching) {
    res.status(500).send('No apps found with ID {0}'.format(id))
  } else {
    res.json(matching)
  }
}

module.exports = ClusterManager
