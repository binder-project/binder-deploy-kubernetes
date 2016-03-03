var _ = require('lodash')
var async = require('async')
var moment = require('moment')
var format = require('string-format')
format.extend(String.prototype)

var App = require('../lib/state/app')
var getLogger = require('binder-logging').getLogger
var getDatabase = require('binder-db').getDatabase
var settings = require('../lib/settings')
var proxyClient = require('../lib/proxy').getInstance

var logger = getLogger('binder-kubernetes-daemon')

var age = 60
var period = 5 * 60 * 1000

// TODO: rewrite the whole API using futures...
setInterval(function () {
  getDatabase(function (err, db) {
    if (err) logger.error('could not cleanup apps: {0}'.format(err))
    App.initialize(db)
    App.find({}, function (err, apps) {
      var ids = _.map(apps, function (app) { return app.id })
      console.log('found the following apps: {0}'.format(JSON.stringify(ids)))
      if (err) return logger.error('could not cleanup apps: {0}'.format(err))
      var proxy = proxyClient(settings)
      proxy.getRoutes({ age: age }, function (err, routes) {
        console.log('found the following routes: ' + JSON.stringify(routes))
        if (err) return logger.error('could not cleanup apps: {0}'.format(err))
        async.each(apps, function (app, next) {
          if (app.location in routes) {
            console.log('app is inactive: {0}'.format(JSON.stringify(app.id)))
            app.inactiveTime += period
            var cullTimeout = app.cullTimeout
            if (app.deployTime && app.inactiveTime > cullTimeout) {
              logger.info('culling app: {0}'.format(app.id))
              app.remove(function (err) {
                return next(err)
              })
            } else {
              console.log('app was inactive, but not removing: {0}'.format(app.id))
              app._save(function (err) {
                if (err) return logger.error('could not save updated inactive app: {0}'.format(err))
              })
            }
          } else {
            app.inactiveTime = 0
            app._save(function (err) {
              if (err) return logger.error('could not save updated active app: {0}'.format(err))
            })
          }
        }, function (err) {
          if (err) return logger.error('could not cleanup apps: {0}'.format(err))
        })
      })
    })
  })
}, period)
