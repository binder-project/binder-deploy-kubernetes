var MongoClient = require('mongodb').MongoClient

var App = require('../lib/state/app')
var getLogger = require('binder-logging').getLogger
var settings = require('../lib/settings')
var proxyClient = require('../lib/proxy').getInstance
var RegistryClient = require('../lib/registry')


var logger = getLogger('binder-deploy-health-check')

var registry = new RegistryClient(settings)

var mongoUrl = 'mongodb://' + settings.db.host + ':' + settings.db.port + '/binder'

MongoClient.connect(mongoUrl, function (err, db) {
  if (err) return logger.error('could not connect to db at', mongoUrl)

  function checkFailed (err) {
    db.collection('health').updateOne({ 'type': 'deploy' }, { $set: {
      status: 'failed',
      lastCheck: new Date()
    } }, { upsert: true }, function (err) {
      if (err) logger.error('could not update deploy health:', err)
    })
  }

  function checkPassed () {
    db.collection('health').updateOne({ 'type': 'deploy' }, { $set: {
      status: 'passed',
      lastCheck: new Date()
    } }, { upsert: true }, function (err) {
      if (err) logger.error('could not update deploy health:', err)
    })
  }

  setInterval(function () {
    registry.fetchTemplate('binder-project-example-requirements', function (err, template) {
      if (err) return checkFailed(err)
      var app = new App(template)
      app.cullTimeout = 1
      app.save(function (err) {
        if (err) return checkFailed(err)
        return checkPassed()
      })
    })
  }, settings.healthInterval)
}

