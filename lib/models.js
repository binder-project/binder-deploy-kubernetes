// models.js defines all the data structures used to store information that should persist across
// HTTP connections. These data structures should have both in-memory and database-backed modes.

var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var format = require('string-format')
format.extend(String.prototype)

var getLogger = require('binder-logging').getLogger

/**
 * A Model is a persistable object that optionally contains callbacks for handling creation,
 * deletion, updating and querying
 * @constructor
 */
function Model (opts) {
  opts = opts || {}
  this.id = opts.id || hat()
  this.name = opts.name || this.constructor.name

  this.logger = getLogger('binder-deploy-kubernetes')
}
Model.schema = {}
Model.initialize = function (db) {
  var model = db.model(this.name, this.schema)
  this.mongooseModel = model
  this.prototype.mongooseModel = model
}

/**
 * Handles any subclass-specific model creation logic
 * @param {function} cb - callback(err)
 */
Model.prototype._create = function (cb) {
  return cb(null)
}

/**
 * Handles any subclass-specific model deletion logic
 * @param {function} cb - callback(err)
 */
Model.prototype._delete = function (cb) {
  return cb(null)
}

/**
 * Handles any subclass-specific model update logic
 * @param {object} template - template containing fields to update in the model
 * @param {function} cb - callback(err)
 */
Model.prototype._update = function (template, cb) {
  return cb(null)
}

/**
 * Serializes the Model into a JSON object
 */
Model.prototype._serialize = function () {
  return {
    id: this.id
  }
}

/**
 * Searches the Model's collection for Models that match the template.
 * @param {object} template - object with properties to match against Models
 * @param {function} cb - callback of form (err, [object,..])
 */
Model.find = function (template, cb) {
  if (!this.mongooseModel) {
    return cb(new Error('cannot call Model.find before initializing the Model'))
  }
  var self = this
  this.mongooseModel.find(template, function (err, results) {
    if (err) return cb(err)
    return cb(null, _.map(results, function (item) { return new self(item) }))
  })
}

/**
 * Return the first object found that matches a template
 * @param {object} template - object with properties to match against models
 * @param {function} cb - callback of form (err, object)
 */
Model.findOne = function (template, cb) {
  if (!this.mongooseModel) {
    return cb(new Error('cannot call Model.findOne before initializing the Model'))
  }
  var self = this
  this.mongooseModel.findOne(template, function (err, item) {
    if (err) return cb(err)
    return cb(null, new self(item))
  })
}

/**
 * Remove all items matching a template
 * @param {object} template - object to match against
 * @param {object} opts - options
 * @param {function} cb - callback(err)
 */
Model.remove = function (template, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!this.mongooseModel) {
    return cb(new Error('cannot call Model.remove before initializing the Model'))
  }
  var self = this
  this.mongooseModel.find(template, function (err, results) {
    if (err) return cb(err)
    async.each(results, function (obj, next) {
      var model = new self(obj)
      model.remove(opts, function (err) {
        return next(err)
      })
    }, function (err) {
      return cb(err)
    })
  })
}

Model.prototype._save = function (cb) {
  var self = this
  var obj = self._serialize()
  self.mongooseModel.findOneAndUpdate({ id: self.id }, obj, { upsert: true, overwrite: true }, function (err, result) {
    return cb(err)
  })
}

Model.prototype._remove = function (cb) {
  var self = this
  self.mongooseModel.remove({ id: self.id }, function (err) {
    return cb(err)
  })
}

/**
 * Creates (or upserts) a Model into its collection
 * @param {object} opts - options
 * @param {function} cb - callback that takes err argument
 */
Model.prototype.save = function (opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!this.mongooseModel) {
    return cb(new Error('cannot call Model.save before initializing the Model'))
  }
  var self = this
  this.logger.info('adding {0} to collection: {1}'.format(this.id, this.constructor.name))
  this._create(function (err) {
    if (err) {
      if (!opts.force) {
        self.logger.error('model insertion of {0} failed: {1}'.format(self.id, err))
        return cb(err)
      }
    }
    self._save(cb)
  })
}

/**
 * Remove a Models from its collection
 * @param {object} opts - options
 * @param {function} cb - callback that takes err argument
 */
Model.prototype.remove = function (opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!this.mongooseModel) {
    return cb(new Error('cannot call Model.remove before initializing the Model'))
  }
  var self = this
  this.logger.info('removing {0} from collection: {1}'.format(this.id, this.constructor.name))
  this._delete(function (err) {
    if (err) {
      if (!opts.force) {
        self.logger.error('model deletion of {0} failed: {1}'.format(self.id, err))
        return cb(err)
      }
    }
    self._remove(cb)
  })
}

Model.count = function (cb) {
  if (!this.mongooseModel) {
    return cb(new Error('cannot call Model.count before initializing the Model'))
  }
  this.mongooseModel.count(function (err, count) {
    if (err) return cb(err)
    return cb(null, count)
  })
}

module.exports = {
  Model: Model
}
