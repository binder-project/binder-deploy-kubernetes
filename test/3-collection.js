var util = require('util')

var _ = require('lodash')
var async = require('async')
var assert = require('assert')

var testUtil = require('./util.js')
var Model = require('../lib/models.js').Model
var getDatabase = require('binder-db').getDatabase

describe('Model', function () {

  function GoodModel (template) {
    Model.call(this, template)
  }
  util.inherits(GoodModel, Model)
  _.assignIn(GoodModel, Model)

  GoodModel.schema = {
    id: { type: String, unique: true },
    name: String
  }
  GoodModel.prototype._serialize = function () {
    return {
      id: this.id,
      name: this.name
    }
  }

  function BadModel (template) {
    Model.call(this, template)
  }
  util.inherits(BadModel, Model)
  _.assignIn(BadModel, Model)

  BadModel.schema = {
    id: { type: String, unique: true },
    name: String
  }
  BadModel.prototype._serialize = function () {
    return {
      id: this.id,
      name: this.name
    }
  }

  BadModel.prototype._create = function (cb) {
    return cb(new Error('bad model is bad!'))
  }
  BadModel.prototype._delete = function (cb) {
    return cb(new Error('bad model is bad!'))
  }
  BadModel.prototype._update = function (template, cb) {
    return cb(new Error('bad model is bad!'))
  }

  var flushCollection = function (coll, cb) {
    coll.remove({}, { force: true }, function (err) {
      return cb(err)
    })
  }

  before(function (done) {
    getDatabase(function (err, db) {
      if (err) throw err
      GoodModel.initialize(db)
      BadModel.initialize(db)
      async.parallel([
        _.partial(flushCollection, GoodModel),
        _.partial(flushCollection, BadModel)
      ], function (err) {
        if (err) throw err
        done()
      })
    })
  })

  describe('insertion', function () {
    it('should insert if creation succeeds', function (done) {
      var model = new GoodModel()
      model.save(function (err) {
        if (err) throw err
        GoodModel.count(function (err, length) {
          if (err) throw err
          assert.equal(length, 1)
          done()
        })
      })
    })

    it('should not insert if creation fails', function (done) {
      var model = new BadModel()
      model.save(function (err) {
        assert(err)
        BadModel.count(function (err, length) {
          if (err) throw err
          assert.equal(length, 0)
          done()
        })
      })
    })
  })

  describe('deletion', function () {
    before(function (done) {
      // BadModel._create will become good for now
      BadModel.prototype._create = function (cb) { return cb(null) }
      async.each(_.range(5), function (i, next) {
        var good = new GoodModel({ name: String(i) })
        var bad = new BadModel({ name: String(i) })
        async.series([
          good.save.bind(good),
          bad.save.bind(bad)
        ], function (err) {
          return next(err)
        })
      }, function (err) {
        if (err) throw err
        done()
      })
    })

    it('should delete if deletion succeeds', function (done) {
      GoodModel.remove({ name: '0' }, function (err) {
        if (err) throw err
        GoodModel.count(function (err, length) {
          if (err) throw err
          assert.equal(length, 5)
          done()
        })
      })
    })

    it('should not delete if deletion fails', function (done) {
      BadModel.remove({ name: '0' }, function (err) {
        assert(err)
        BadModel.count(function (err, length) {
          if (err) throw err
          assert.equal(length, 5)
          done()
        })
      })
    })
  })

  describe('querying', function () {

    it('should find all items with an empty template', function (done) {
      BadModel.find({}, function (err, models) {
        if (err) throw err
        assert.equal(models.length, 5)
        done()
      })
    })

    it('should find all items matching a template', function (done) {
      BadModel.find({ name: '1' }, function (err, models) {
        if (err) throw err
        assert.equal(models.length, 1)
        done()
      })
    })

    it('should return a single item for findOne', function (done) {
      BadModel.findOne({ name: '1' }, function (err, model) {
        if (err) throw err
        assert.equal(model.name, '1')
        done()
      })
    })
  })
})
