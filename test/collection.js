var _ = require('lodash')
var assert = require('assert')

var testUtil = require('./util.js')
var Collection = require('../lib/models.js').Collection

describe('Collection', function () {

  function good (cb) { cb(null) }
  function bad (cb) { cb(new Error('bad')) }
  function GoodModel(obj) {
    obj = obj || {}
    return _.extend(obj, {
      create: good,
      update: function (update, cb) {
        _.extend(this, update)
        cb(null)
      },
      delete: good
    })
  }
  function alwaysBad (cb){ cb(new Error('always bad')) }
  function BadModel(obj) {
    obj = obj || {}
    return _.extend(obj, {
      create: bad,
      update: function (update, cb) {
        cb(new Error('always bad'))
      },
      delete: bad
    })
  }

  describe('initialization', function () {
    it('should handle initialization with an Array', function () {
      var array = _.map(_.range(10), function (item) {
        return GoodModel()
      })
      var coll = new Collection({
        collection: array
      })
      assert.equal(coll.coll.length, 10)
      assert.equal(coll.length(), 10)
    })
    it('should handle empty initialization', function () {
      var coll = new Collection()
      assert.equal(coll.coll.length, 0)
      assert.equal(coll.length(), 0)
    })
  })

  describe('manipulation', function () {
    var collection = new Collection()

    describe('insertion', function () {

      it('should insert if creation succeeds', function (done) {
        var model = GoodModel()
        collection.insert(model, function (err) {
          if (err) throw err
          assert.equal(collection.length(), 1)
          done()
        })
      })

      it('should not insert if creation fails', function (done) {
        var model = BadModel()
        collection.insert(model, function (err) {
          assert(err)
          done()
        })
      })

      it('should insert if model does not require creation', function (done) {
        var model = {a: 1}
        collection.insert(model, function (err) {
          if (err) throw err
          assert.equal(collection.length(), 2)
          done()
        })
      })

    })

    describe('deletion', function () {

      before(function () {
        var l = [GoodModel(), GoodModel({a: 1}), BadModel({b: 1}), {c: 1}]
        collection = new Collection({
          collection: l
        })
      })

      it('should delete if deletion succeeds', function (done) {
        var template = {a: 1}
        assert.equal(collection.length(), 4)
        collection.remove(template, function (err) {
          if (err) throw err
          assert.equal(collection.length(), 3)
          done()
        })
      })

      it('should not delete if deletion fails', function (done) {
        var template = {b: 1} 
        assert.equal(collection.length(), 3)
        collection.remove(template, function (err) {
          assert(err)
          assert.equal(collection.length(), 3)
          done()
        })
      })

      it('should not delete if object does not require deletion', function (done) {
        var template = {c: 1}
        assert.equal(collection.length(), 3)
        collection.remove(template, function (err) {
          if (err) throw err
          // ensure that ALL matching objects were removed
          assert.equal(collection.length(), 2)
          done()
        })
      })

    })

    describe('querying', function () {

      before(function () {
        var l = [{}, {a: 1, b: 2}, GoodModel({b: 2}), BadModel({b: 2}), GoodModel({a: 1})]
        collection = new Collection({
          collection: l
        })
      })

      it('should find all items with an empty template', function (done) {
        var template = {}
        assert.equal(collection.length(), 5)
        collection.find(template, function (err, items) {
          if (err) throw err
          assert.deepEqual(items, collection.coll)
          done()
        })
      })

      it('should find full items with partial templates', function (done) {
        var template = {a: 1}
        collection.find(template, function (err, items) {
          if (err) throw err
          assert.equal(items.length, 2)
          done()
        })
      })

      it('should return a single item for findOne', function (done) {
        var template = {a: 1}
        collection.findOne(template, function (err, items) {
          if (err) throw err
          assert(!(items instanceof Array))
          assert.deepEqual(items, {a: 1, b: 2})
          done()
        })
      })
    })

    describe('updating', function () {

      before(function () {
        var l = [GoodModel(), GoodModel({a: 1}), BadModel({b: 1}), {c: 1}]
        collection = new Collection({
          collection: l
        })
      })

      it('should update if model updating succeeds', function (done) {
        var template = {a: 1}
        var update = {a: 4}
        collection.findOne(template, function (err, item) {
          if (err) throw err
          assert(testUtil.isEqual(item, GoodModel({a: 1})))
          collection.update(template, update, function (err) {
            if (err) throw err
            collection.findOne(update, function (err, item) {
              if (err) throw err
              assert(testUtil.isEqual(item, GoodModel({a: 4})))
              done()
            })
          })
        })
      })

      it('should not update if model updating fails', function (done) {
        var template = {b: 1}
        var update = {b: 4}
        collection.findOne(template, function (err, item) {
          if (err) throw err
          assert(testUtil.isEqual(item, BadModel({b: 1})))
          collection.update(template, update, function (err) {
            assert(err)
            collection.findOne(template, function (err, item) {
              if (err) throw err
              assert(testUtil.isEqual(item, BadModel({b: 1})))
              done()
            })
          })
        })
      })

      it('should update if model does not require updating', function (done) {
        var template = {c: 1}
        var update = {c: 4}
        collection.findOne(template, function (err, item) {
          if (err) throw err
          assert(testUtil.isEqual(item, {c: 1}))
          collection.update(template, update, function (err) {
            if (err) throw err
            collection.findOne(update, function (err, item) {
              if (err) throw err
              assert(testUtil.isEqual(item, {c: 4}))
              done()
            })
          })
        })
      })

    })


    it('should return an empty list if models matching a template are not found')

  })
})
