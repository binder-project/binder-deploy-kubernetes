var _ = require('lodash')
var async = require('async')
var moment = require('moment')
var format = require('string-format')
format.extend(String.prototype)

var App = require('../lib/state/app')
var getLogger = require('binder-logging').getLogger
var settings = require('../lib/settings')
var proxyClient = require('../lib/proxy').getInstance

var logger = getLogger('binder-kubernetes-daemon')

var period = 5 * 60 * 1000

setInterval(function () {
  App.find({}, function (err, apps) {
    if (err) logger.error('could not cleanup apps: {0}'.format(err))
    var proxy = proxyClient(settings)
    proxy.getRoutes({ age: period }, function (err, routes) {
      if (err) logger.error('could not cleanup apps: {0}'.format(err))
      async.each(apps, function (app, next) {
        if (app.location in routes) {
          app.inactiveTime += period
          var cullTimeout = app.cullTimeout
          if (app.deployTime && app.inactiveTime > cullTimeout) {
            logger.info('culling app: {0}'.format(app.id))
            app.remove(function (err) {
              return next(err)
            })
          } else {
            app._save(function (err) {
              if (err) logger.error('could not save updated inactive app: {0}'.format(err))
            })
          }
        } else {
          app.inactiveTime = 0
          app._save(function (err) {
            if (err) logger.error('could not save updated active app: {0}'.format(err))
          })
        }
      }, function (err) {
        if (err) logger.error('could not cleanup apps: {0}'.format(err))
      })
    })
  })
}, period)
