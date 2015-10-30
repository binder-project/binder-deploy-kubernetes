// models.js defines all the data structures used to store information that should persist across 
// HTTP connections. These data structures should have both in-memory and database-backed modes.

var _ = require('lodash')
var async = require('async')

var settings = require('../../config/main.js')
var logger = require('../logging.js')
var MongoDb = require('./mongo.js')

/**
 * A Model is any collection of JS objects that can optionally be written to persistent storage
 * and queried.
 * @constructor
 */
function Collection (opts) {
  this.name = opts.name || 'default'
  this.mode = settings.storage.mode
  this.load = opts.load
  this.save = opts.save
  this.delete = opts.delete

  if (this.mode === 'mongo') {
    // TODO intialize database connection
    this.db = new MongoDb(opts.db)
  } else if (this.mode === 'in-memory') {
    // Keep all records in memory
    this.db = null
  } else {
    throw Error('requesting an unsupported database type')
  }

  var self = this
  if (this.load) {
    this.load(function (err, coll) {
      if (err) {
        throw Error('fetching collection from the load endpoint failed')
      }
      self.coll = coll
    })
  }
}

/**
 * Fetch all records using the collection's loader function (this.load). This method should 
 * respect the cache timeouts in opts if they're specified
 *
 * @param {function} cb - callback(err, [object,...])
 */
Collection.prototype._fetch = function (cb) {
  // TODO check cache times here
  if (this.load) {
    this.load(cb)
  }
}

/**
 * Searches the collection for Models that match the template (optionally fetching data from 
 * the Collection's loader (backing endpoint).
 *
 * @param {object} template - object with properties to match against Models
 * @param {function} cb - callback(err, [object,..])
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
  if (this.load) {
    this._fetch(query)
  } else {
    query(null, this.coll)
  }
}

/**
 * Insert Models into the Collection
 *
 * @param {Model} model - Model to add to the collection (optionally write to the db)
 * @param {function} cb - callback(error)
 */
Collection.prototype.insert = function (model, cb) {
  var addItem = function (next) {
    logger.debug('adding {0} to collection: {1}'.format(JSON.stringify(model), this.name))
    if (err) {
      logger.error(err)
      return next(err)
    }
    if (this.db) {
      this.db.insert(model, function (err) {
        this.coll.push(model)
        next(err)
      })
    } else {
      this.coll.push(model)
      next(null)
    }
  }

  var tasks = {}
  if (this.save) {
    tasks.one = _.partial(this.save.bind(this), model)
    tasks.two = addItem.bind(this)
  } else {
    tasks.one = addItem.bind(this)
  }
  async.series(tasks, function (err, results) {
    cb(err)
  })
}

/**
 * Remove models that match a template from the collection
 *
 * @param {object} template - object with properties to match against models
 * @param {function} cb - callback(error)
 */
Collection.prototype.remove = function (template, cb) {
  var removeItem = function (next) {
    logger.debug('removing {0} from collection: {1}'.format(JSON.stringify(template), this.name))
    if (err) {
      logger.error(err)
      return next(err)
    }
    if (this.db) {
      this.db.remove(model, removeItem)
    }
    this.coll = _.filter(this.coll, !_.match(template))
    next(null)
  }
}

/**
 * Update a model in a collection that has been modified. It will be updated in the database,
 * this.delete will be called on the old record, and this.save will be called on the new record.
 *
 * @param {object} template - object with properties to match against models
 * @param {object} cb - callback(error)
 */
Collection.prototype.update = function (template, cb) {
}

module.exports = Collection
