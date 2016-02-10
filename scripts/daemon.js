var async = require('async')
var format = require('string-format')
format.extend(String.prototype)

var App = require('../lib/state/app.js')
var getLogger = require('binder-logging').getLogger

var logger = getLogger('binder-kubernetes-daemon')

setInterval(function () {
  App.find({}, function (err, apps) {
    if (err) {
      logger.error('could not cleanup apps: {0}'.format(err))
    }
    async.each(apps, function (app, next) {
      var now = new Date()
      var cullTimeout = app.cullTimeout || 60 * 60 * 1000
      if (app.deployTime && ((now - app.deployTime) > cullTimeout)) {
        logger.info('culling app: {0}'.format(app.id))
        app.remove(function (err) {
          return next(err)
        })
      }
    }, function (err) {
      if (err) {
        logger.error('could not cleanup apps: {0}'.format(err))
      }
    })
  })
}, 300000)
