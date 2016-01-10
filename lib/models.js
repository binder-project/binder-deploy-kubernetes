// models.js defines all the data structures used to store information that should persist across
// HTTP connections. These data structures should have both in-memory and database-backed modes.

var _ = require('lodash')
var async = require('async')
var format = require('string-format')
format.extend(String.prototype)

var settings = require('../config/main.js')
var logger = require('./logging.js')()
var MongoDb = require('./state/db/mongo.js')

/**
 * A Model is any collection of JS objects that can optionally be written to persistent storage
 * and queried.
 * @constructor
 */
function Collection (opts) {
  if (typeof opts === 'string') {
    this.name = opts
    opts = {} 
  } else {
    opts = opts || {}
    this.name = opts.name || 'default'
  }
  this.mode = settings.storage.mode
  var coll = opts.collection

  // select the database
  if (this.mode === 'mongo') {
    // TODO intialize database connection
    this.db = new MongoDb(opts.db)
  } else if (this.mode === 'in-memory') {
    // Keep all records in memory
    this.db = null
  } else {
    throw Error('requesting an unsupported database type')
  }

  // insert the initial collection into the database, if necessary
  if (coll && (coll instanceof Array)) {
    _.forEach(this.coll, function (model) {
      if (!typeof model === 'object') {
        throw Error('collection initialized with an array containing invalid types')
      }
    })

    if (this.db) {
      async.eachSeries(coll, function (item, next) {
        var handleInsert = function (err) {
          next(err)
        }
        this.insert(item, handleInsert)
      }, function (err) {
        if (err) throw Error('could not insert initial collection into the DB')
      })
    }

    this.coll = coll
  } else if (coll) {
    throw Error('a collection must be initialized with either an array or nothing')
  } else {
    this.coll = []
  }
}

/**
 * Searches the collection for Models that match the template.
 * @param {object} template - object with properties to match against Models
 * @param {function} cb - callback of form (err, [object,..])
 */
Collection.prototype.find = function (template, cb) {
  var query = function (err, coll) {
    logger.debug('searching for {0} in collection: {1}'.format(JSON.stringify(template), this.name))
    if (err) {
      return cb(err)
    }
    if (template) {
      cb(null, _.where(coll, template))
    } else {
      cb(null, coll)
    }
  }
  query(null, this.coll)
}

/**
 * Return the first object found that matches a template
 * @param {object} template - object with properties to match against models
 * @param {function} cb - callback of form (err, object)
 */
Collection.prototype.findOne = function (template, cb) {
  var query = function (err, coll) {
    var logString = 'searching for first instance of {0} in collection: {1}'
    logger.debug(logString.format(JSON.stringify(template), this.name))
    if (err) {
      return cb(err)
    }
    if (template) {
      cb(null, _.findWhere(coll, template))
    } else if (coll) {
      cb(null, coll[0])
    } else {
      cb(null, null)
    }
  }
  query(null, this.coll)
}

/**
 * Insert Models into the Collection
 * @param {Model} model - Model to add to the collection (optionally write to the db)
 * @param {function} cb - callback that takes err argument
 */
Collection.prototype.insert = function (model, cb) {
  logger.debug('adding {0} to collection: {1}'.format(JSON.stringify(model), this.name))
  var self = this

  var handleCreate = function (next) {
    logger.info('in handleCreate')
    if (model.create) { 
      logger.info('calling create')
      model.create(function (err) { 
        logger.info('in create, err: ' + err)
        if (err) { 
          logger.error('model creation failed')
          return next(err)
        }
        logger.info('in handleCreate, calling next with null')
        return next(null) 
      })
    } else {
      return next(null)
    }
  }

  var handleDb = function (next) {
    logger.info('in handleDb')
    if (self.db) {
      self.db.insert(model, function (err) {
        if (err) { 
          logger.error('db insertion failed')
          return next(err)
        }
        return next(null)
      })
    } else {
      return next(null)
    }
  }

  self.coll.push(model)
  async.series([
    handleCreate,
    handleDb
  ], function (err) {
    logger.info('after the async parallel for model {0} with err: {1}!'.format(JSON.stringify(model), err))
    if (err) {
      logger.error('could not insert model {0} into collection {1}, err: {2} '.format(JSON.stringify(model, self.name, err)))
      _.remove(self.coll, model)
    }
  })
  logger.info('about to call cb with no error')
  return cb(null)
}

/**
 * Remove models that match a template from the collection
 * @param {object} template - object with properties to match against Models
 * @param {function} cb - callback that takes err argument
 */
Collection.prototype.remove = function (template, cb) {
  var self = this
  // Remove from the DB first. If that fails, the whole operation should fail
  var removeItem = function (err) {
    logger.debug('removing {0} from collection: {1}'.format(JSON.stringify(template), this.name))
    if (err) {
      logger.error(err)
      return cb(err)
    }
    var toRemove = _.filter(self.coll, _.matches(template))
    async.each(toRemove, function (model, next) {
      if (model.delete) {
        model.delete(next)
      } else {
        next(null)
      }
    }, function (err) {
      if (err) return cb(err)
      self.coll = _.filter(self.coll, _.negate(_.matches(template)))
      cb(null)
    })
  }
  if (this.db) {
    self.db.remove(template, removeItem)
  } else {
    removeItem(null)
  }
}

/**
 * Update the models that match a template with new properties
 * @param {object} template - object with properties to match against models
 * @param {object} update - object containing keys/values to update in the original model
 * @param {function} cb - callback that takes err argument
 */
Collection.prototype.update = function (template, update, cb) {
  var self = this
  logger.debug('updating {0} with properties {1} in collection {2}'.format(JSON.stringify(template),
     JSON.stringify(update),
     this.name))
  var updateItem = function (err) {
    if (err) {
      logger.error(err)
      return cb(err)
    }
    var toUpdate = _.filter(self.coll, _.matches(template))
    async.each(toUpdate, function (model, next) {
      if (model.update) {
        model.update(template, function (err) {
          if (err) return next(err)
          _.extend(model, update)
          next(null)
        })
      } else {
        _.extend(model, update)
        next(null)
      }
    }, function (err) {
      return cb(err)
    })
  }
  if (this.db) {
    self.db.update(template, update, updateItem)
  } else {
    updateItem(null)
  }
}

Collection.prototype.length = function () {
  return this.coll.length
}

module.exports = {
  Collection: Collection
}
