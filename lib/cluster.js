var _ = require('lodash')
var format = require('string-format')
format.extend(String.prototype)

var App = require('./state/app.js')
var RegistryClient = require('./registry.js')
var getLogger = require('binder-logging').getLogger

function ClusterManager (db, opts) {
  this.opts = opts
  this.db = db
  this.registry = new RegistryClient(opts)

  App.initialize(db)

  this.logger = getLogger('binder-deploy-kubernetes')
}

/**
 * HTTP handler that responds all applications (potentially only those matching a template)
 * running on the cluster
 */
ClusterManager.prototype.getAllApplications = function (req, res) {
  var self = this
  var template = req.params.template
  this.logger.info('HTTP: getting all applications for template: {0}'.format(template))
  App.find(template, function (err, matches) {
    if (err) {
      self.logger.error('HTTP: could not get all applications for template {0}: {1}'.format(template, err))
      res.status(500).send('could not get all applications: {0}'.format(err))
    } else {
      self.logger.info('HTTP: successfully got all applications for template {0}'.format(template))
      var formatted = matches.map(function (match) {
        return {
          id: match.id,
          template: match.template,
          location: match.location,
          status: match.state
        }
      })
      res.json(formatted).end()
    }
  })
}

ClusterManager.prototype.createApplication = function (req, res) {
  var self = this
  var templateName = req.params.template
  self.logger.info('HTTP: creating application with template {0}'.format(templateName))
  if (!templateName) {
    res.status(500).send('template not specified in request')
  } else {
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
      self.registry.fetchTemplate(templateName, function (err, template) {
        if (err) return res.status(500).send(err)
        var app = new App(template)
        self.logger.info('HTTP: app created with template {0}, deploying with id {1}'.format(template, app.id))
        app.save(function (err) {
          if (err) {
            self.logger.error('HTTP; could not create app {0}: {1}'.format(app.id, err))
            return res.status(500).send(err)
          }
          return res.json({
            id: app.id
          })
        })
      })
    }
  }
}

ClusterManager.prototype.getApplication = function (req, res) {
  var self = this
  var template = req.params.template
  var id = req.params.id
  self.logger.info('HTTP: getting application with template {0} and id {1}'.format(template, id))
  App.findOne({ id: id }, function (err, app) {
    if (err) {
      self.logger.error('HTTP: App.findOne failed: {0}'.format(err))
      res.status(500).send('error while searching for app with id: {0}'.format(id))
    }
    if (!app) {
      self.logger.error('HTTP: no application found with template {0} and id {1}'.format(template, id))
      res.status(500).send('no apps found with ID {0}'.format(id))
    } else {
      self.logger.info('HTTP: found application with template {0} and id {1}'.format(template, id))
      var formatted = {
        id: app.id,
        template: app.template,
        location: app.location,
        status: app.state
      }
      res.json(formatted)
    }
  })
}

ClusterManager.prototype.preload = function (req, res) {
  var self = this
  var template = req.params.template
}

module.exports = ClusterManager
