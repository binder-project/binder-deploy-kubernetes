var _ = require('lodash')
var assert = require('assert')
var KubeClient = require('kube-stream')
var utils = require('kube-test-utils')

var App = require('../lib/state/app.js').App
var RegistryClient = require('../lib/registry.js')
var ProxyClient = require('../lib/proxy.js')

var clusterAvailable = require('./main.js').clusterAvailable

var namespace = 'binder-testing'

before(function initialize(done) {
  if (clusterAvailable()) {
    var client = new KubeClient()
    client.namespaces.delete({
    }, function (err, ns) {
      if (err) console.log('WARNING: ' + err + ', proceeding anyway')
      client.namespaces.create({
        template: utils.makeNamespace(namespace)
      }, function (err, ns) { 
        if (err) console.log('WARNING: ' + err + ', proceeding anyway')
        console.log('Waiting for remote setup to complete...')
        setTimer(function () { 
          done()
        }, 1000)
      })
    })
  }
})

describe('Proxy', function () {
  describe('(remote)', function () {
    var proxyClient = new ProxyClient({
      namespace: namespace
    })

    var tests = {

      'should create the proxy pods/services': function (done) {
        proxyClient.launchClusterProxy(function (err) {
          if (err) throw err
          next()
        })
      },

      'should have the proxy IPs after proxy creation': function (done) {
        assert.notEqual(proxyClient.lookupIP, null)
        assert.notEqual(proxyClient.registrationIP, null)
        done()
      },
      
      'should be able to register routes': function (done) {
        proxyClient.registerProxyRoute('/user/blah', '9.9.9.9', function (err) {
          if (err) throw err
          done()
        })
      },

      'should be able to get all routes': function (done) {
        proxyClient.getRoutes(function (err, routes) {
          if (err) throw err
          assert.equal(routes.length, 1)
          done()
        })
      }, 

      'should be able to get inactive routes': function (done) {
        proxyClient.getRoutes({ age: 10 }, function (err, routes) {
          if (err) throw err
          assert.equal(routes.length, 0)
          proxyClient.getRoutes({ age: 0.0001 }, function (err, routes) {
            if (err) throw err
            assert.equal(routes.length, 1)
            done()
          })
        })
      }

      'should be able to remove routes': function (done) {
        proxyClient.getRoutes(function (err, routes) {
          if (err) throw err
          assert.notEqual(routes.length, 0)
          _.forEach(_.keys(routes), function (route) {
            proxyClient.removeProxyRoute(route, function (err) {
              if (err) throw err
            })
          })
          proxyClient.getRoutes(function (err, routes) {
            if (err) throw err
            assert.equal(routes.length, 0)
          })
        })
      }
   }

   before(function () {
     if (!clusterAvailable()) {
       console.log('WARNING: skipping proxy test because cluster is unavailable')
       this.skip()
     }
   })

   _.map(_.keys(tests), function (name) {
     it(name, tests[name])
   })
  })
})

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
    var proxyClient = new ProxyClient({
      namespace: namespace
    })
    var kubeClient = new KubeClient()

    // set during testing
    var app = null
    var location = null

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
        app.makeRoute(function (err, location) {
          if (err) throw err
          assert.equals(location, app._location())
          done()
        })
      },

      'should be accessible through the proxy after route creation', function (done) {
        var url = urljoin('http://' + proxyClient.lookupIP, location)
        request(url, function (err, req, rsp) {
          if (err) throw err
          assert.notEqual(rsp.statusCode, null)
          assert.notEqual(rsp.statusCode, 404)
          assert.notEqual(rsp.statusCode, 503)
          done()
        })
      }

      'should do the correct cleanup once deleted': function (done) {
        app.delete(function (err) {
          if (err) throw err
          // ensure the pod has been deleted
          kubeClient.pods.get({
            template: app._frontendPod()
          }, function (err, pods) {
            if (err) throw err
            assert.equal(pods.length, 0)
            proxyClient.getRoutes(function (err, routes) {
              if (err) throw err
              assert.equals(routes.length, 0)
              // ensure the proxy route has been removed
              done()
            })
          })
        })
      },
    }

   before(function () {
     if (!clusterAvailable()) {
       console.log('WARNING: Skipping remote App tests because cluster is unavailable')
       this.skip()
     }
   })

   _.map(_.keys(tests), function (name) {
     it(name, tests[name])
   })
  })
})

describe('Pool', function () {

})
