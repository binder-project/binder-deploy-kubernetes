var _ = require('lodash')
var assert = require('assert')

var Collection = require('../lib/models.js').Collection

describe('Collection', function () {

  function good (cb) { cb(null) }
  function bad (cb) { cb(new Error('bad')) }
  function GoodModel(obj) {
    obj = obj || {}
    return _.extend(obj, {
      create: good,
      update: good,
      delete: good
    })
  }
  function alwaysBad (cb){ cb(new Error('always bad')) }
  function BadModel(obj) {
    obj = obj || {}
    return _.extend(obj, {
      create: bad,
      update: bad,
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

    it('should correctly update models')

    it('should correctly find models')

    it('should return an empty list if models matching a template are not found')

  })
})
