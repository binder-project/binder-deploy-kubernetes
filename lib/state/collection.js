// models.js defines all the data structures used to store information that should persist across 
// HTTP connections. These data structures should have both in-memory and database-backed modes.

var _ = require('lodash'),
    async = require('async')

var settings = require('../../config/main.js'),
    logger = require('../logger.js'),
    MongoDb = require('./mongo.js')

/**
 * A Model is any collection of JS objects that can optionally be written to persistent storage
 * and queried.
 * @constructor
 */
function Collection (coll, opts) {
  this.name = opts.name || 'default'
  this.mode = settings.storage.mode

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
    // ensure that each item in the collection is an object
    _.forEach(this.coll, function (model) {
      if (!typeof model === 'object') {
        throw Error('collection initialized with an array containing invalid types')
      }
    })
    // insert each item into the database if there's a database
    if (this.db) {
      async.eachSeries(coll, function (item, next) {
        var handleInsert = function (err) {
          if (err) {
            next(err)
          }
          next(null)
        }
        this.insert(item, handleInsert)
      }, function (err) {
        if (err) throw Error('could not insert initial collection into the DB')
      })
    }

    // set the intial collection
    this.coll = coll
  } else if (coll) {
    throw Error('a collection must be initialized with either an array or nothing')
  } else {
    this.coll = []
  }
}

/**
 * Searches the collection for Models that match the template (optionally querying the db)
 * @param {object} template - object with properties to match against Models
 */
Collection.prototype.find = function (template) {
  // Always do fast, in-memory searches (adds/removes are just written back to DB)
  return _.where(this.coll, template)
}

/**
 * Insert Models into the Collection
 * @param {Model} model - Model to add to the collection (optionally write to the db)
 * @param {function} cb - callback that takes err argument
 */
Collection.prototype.insert = function (model, cb) {
  // Insert into the DB first. If that fails, the whole operation should fail
  var addItem = function (err) {
    logger.debug('adding {0} to collection: {1}'.format(JSON.stringify(model), this.name))
    if (err) {
      logger.error(err)
      cb(err)
    }
    this.coll.push(model)
    cb(null)
  }
  if (this.db) {
    this.db.insert(model, addItem)
  } else {
    addItem(null)
  }
}

/**
 * Remove models that match a template from the collection
 * @param {object} template - object with properties to match against Models
 * @param {function} cb - callback that takes err argument
 */
Collection.prototype.remove = function (template, cb) {
  // Remove from the DB first. If that fails, the whole operation should fail
  var removeItem = function (err) {
    logger.debug('removing {0} from collection: {1}'.format(JSON.stringify(template), this.name))
    if (err) {
      logger.error(err)
      cb(err)
    }
    this.coll = _.filter(this.coll, !_.match(template))
    cb(null)
  }
  if (this.db) {
    this.db.remove(model, removeItem)
  } else {
    removeItem(null)
  }
}
