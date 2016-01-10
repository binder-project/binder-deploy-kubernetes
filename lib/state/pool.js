var _ = require('lodash')

var async = require('async')

var settings = require('../../config/main.js')
var defaultLogger = require('../logging.js')
var App = require('./app.js').App
var RegistryClient = require('../registry.js')
var Collection = require('../models.js').Collection

function Pool (opts) {
  this.opts = opts
  this.templateName = opts.templateName
  this.desiredSize = opts.size || settings.pool.size
  this.size = 0

  // use the singleton App collection
  this.apps = require('./app.js').apps
  this.registry = new RegistryClient()
  this.template = null
  this.slots = []

  this.logger = this._makeLogger(defaultLogger())
}

Pool.prototype._makeLogger = function (base) {
  var self = this
  base.rewriters.push(function (level, msg, meta) {
    meta.component = 'Pool'
    meta.templateName = self.templateName
    return meta
  })
  return base
}

Pool.prototype._createSlots = function (size, cb) {
  var self = this
  if (!this.template) {
    return cb(new Error('cannot create slots without a template'))
  }
  async.each(_.range(size), function (i, next) {
    var app = new App(self.template)
    self.apps.insert(app, function (err) {
      if (err) {
        self.logger.error(err)
        return next(err)
      }
      self.slots.push({
        allocated: false,
        id: app.id,
        location: null,
        allocTime: null
      })
      self.size += 1
      next(null)
    })
  }, function (err) {
    if (err) self.logger.error('could not create apps in pool: ' + err)
    return cb(err)
  })
}

Pool.prototype._deleteSlots = function (size, cb, opts) {
  var force = opts.force || false
  var self = this
  // try to remove only unallocated slots (unless force is true)
  var toRemove = null
  if (size) {
    toRemove = _.where(this.slots, { allocated: false })
  } else {
    toRemove = this.slots
  }
  if (toRemove.length <= size) {
    async.each(toRemove, function (slot, next) {
      var id = slot.id
      // TODO: make sure Collection supports indices for fast lookup
      self.apps.remove({ id: id }, function (err) {
        if (!err) self.size -= 1
        next(err)
      })
    }, function (err) {
      if (err) {
        return cb(err)
      }
      self.slots = _.without.apply(_, self.slots, toRemove)
      cb(null)
    })
  } else if (force) {
    return cb(new Error('force option unimplemented. cannot delete allocated slots.'))
  } else {
    return cb(new Error('cannot delete allocated slots (rerun with force=false to delete)'))
  }
}

Pool.prototype.create = function (cb) {
  var self = this
  var handleTemplate = function (err, template) {
    if (err) {
      self.logger.error('could not fetch template from registry: ' + err)
      return cb(err)
    }
    self.template = template
    self._createSlots(self.desiredSize, cb)
  }
  this.registry.fetchTemplate(this.templateName, handleTemplate)
}

Pool.prototype.resize = function (size, cb) {
  this.desiredSize = size
  var delta = this.size - this.desiredSize
  var diff = Math.abs(delta)
  if (delta > 0) {
    this._createSlots(diff, cb)
  } else if (delta < 0) {
    this._deleteSlots(diff, cb)
  } else {
    cb(null)
  }
}

Pool.prototype.available = function () {
  return _.where(this.slots, { allocated: false }).length
}

Pool.prototype.assign = function (cb) {
  var self = this
  var slot = _.find(this.slots, { allocated: false })
  var app = this.apps.findOne({ id: slot.id })
  if (app) {
   // there should only be a single app with the given id
    app.makeRoute(function (err, location) {
      if (err) {
        self.logger.error('could not register route for app: ' + slot.id)
        return cb(err)
      }
      slot.location = location
      slot.allocated = true
      slot.allocTime = (new Date()).toJSON()
      cb(null, slot)
    })
  }
}

Pool.prototype.delete = function (cb) {
  this._deleteSlots(null, function (err) {
    if (err) return cb(err)
    cb(null)
  })
}

module.exports = {
  Pool: Pool,
  pools: new Collection('pools')
}
