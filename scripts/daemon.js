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

var age = 1
var period = 1 * 60 * 1000

// TODO: rewrite the whole API using futures...
setInterval(function () {
  getDatabase(function (err, db) {
    if (err) logger.error('could not cleanup apps: {0}'.format(err))
    App.initialize(db)
    App.find({ state: 'deployed' }, function (err, apps) {
      if (err) return logger.error('could not cleanup apps: {0}'.format(err))
      var ids = _.map(apps, function (app) { return app.id })
      var proxy = proxyClient(settings)
      proxy.getRoutes({ age: age }, function (err, routes) {
        console.log('found the following routes: ' + JSON.stringify(routes))
        if (err) return logger.error('could not cleanup apps: {0}'.format(err))
        async.eachLimit(apps, 5, function (app, next) {
          if (app._location() in routes) {
            console.log('****************')
            console.log('app is inactive: {0}'.format(JSON.stringify(app.id)))
            console.log('inactiveTime: {0}, deployTime: {1}, cullTimeout: {2}'.format(app.inactiveTime, app.deployTime, app.cullTimeout))
            app.inactiveTime += period
            if (app.deployTime && app.inactiveTime > app.cullTimeout) {
              logger.info('culling app: {0}'.format(app.id))
              app._delete(function (err) {
                return next(err)
              })
            } else {
              console.log('app was inactive, but not removing: {0}'.format(app.id))
              app._save(function (err) {
                if (err) return logger.error('could not save updated inactive app: {0}'.format(err))
                return next(err)
              })
            }
          } else {
            app.inactiveTime = 0
            app._save(function (err) {
              if (err) return logger.error('could not save updated active app: {0}'.format(err))
              return next(err)
            })
          }
        }, function (err) {
          if (err) return logger.error('could not cleanup apps: {0}'.format(err))
        })
      })
    })
  })
}, period)
