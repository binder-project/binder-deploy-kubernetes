var _ = require('lodash')
var assert = require('assert')

var App = require('../lib/state/app.js').App
var RegistryClient = require('../lib/registry.js')

var onlyLocal = require('./main.js').clusterAvailable

describe('App', function () {
  var registry = new RegistryClient({
    templateDir: './examples/'
  })

  describe('(local)', function () {
    describe('from template', function () {
      it('should produce a valid pod specification', function (done) {
        var name = 'binder-project-example-requirements'
        registry.fetchTemplate(name, function (err, template) {
          if (err) throw err
          var app = new App(template)
          var spec = app.spec()
          assert(spec)
          assert.equal(app.command, spec.pod.spec.containers[0].command)
          assert.equal(app.id, spec.pod.metadata.labels.id)
          //TODO more sophisticated schema testing
          done()
        })
      })
    })
  })

  describe('(remote)', function () {
    var name = 'binder-project-example-requirements'
    var app = null

    var tests = {

      'should correctly create pods/services': function (done) {
        registry.fetchTemplate(name, function (err, template) {
          if (err) throw err
          app = new App(template)
          app.create(function (err) {
            if (err) throw err
            done()
          })
        })
      },

      'should register routes with the cluster proxy': function (done) {

      },

      'should do the correct cleanup once deleted': function (done) {

      },

      'should handle updates': function (done) {

      }

    }

   before(function () {
     if (!clusterAvailable()) {
       this.skip()
     }
   })

    _.map(_.keys(tests), function (name) {
      it(name, tests[name])
    })
  })
})
