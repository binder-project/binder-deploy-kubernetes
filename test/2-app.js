var _ = require('lodash')
var assert = require('assert')
var KubeClient = require('kube-stream')
var utils = require('kube-test-utils')

var App = require('../lib/state/app.js').App
var RegistryClient = require('../lib/registry.js')
var ProxyClient = require('../lib/proxy.js')

var clusterAvailable = require('./1-main.js').clusterAvailable

var namespace = 'binder-testing'

/**
 * Remove the old testing namespace and create a new one (if a cluster is available)
 */
before(function initialize(done) {
  this.timeout(10000)
  if (clusterAvailable()) {
    var client = new KubeClient()
    var nsTemplate = utils.makeNamespace(namespace)
    console.log('About to delete old testing namespace, if it exists')
    client.namespaces.changeState({
      state: nsTemplate,
      condition: function (namespaces) {
        return (namespaces.length === 0) 
      },
      action: client.namespaces.delete
    }, function (err, ns) {
      console.log('About to create testing namespace')
      if (err) console.log('WARNING: Could not delete binder-testing namespace -- continuing')
      client.namespaces.changeState({
        state: nsTemplate,
        delta: { status: { phase: 'Active' }},
        action: client.namespaces.create
      }, function (err, ns) {
        console.log('After creating test namespace, err: ' + err)
        if (err) throw err
        console.log('Created {0} namespace...'.format(_.get(nsTemplate, 'metadata.name')))
        done()
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
        this.timeout(50000)
        proxyClient.launchClusterProxy(function (err) {
          console.log('err: ' + JSON.stringify(err))
          if (err) throw err
          done()
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
      },

      'should be able to remove routes': function (done) {
        proxyClient.getRoutes(function (err, routes) {
          if (err) throw err
          assert.notEqual(routes.length, 0)
          async.each(_.keys(routes), function (route, next) {
            proxyClient.removeProxyRoute(route, function (err) {
              if (err) throw err
              next(null)
            })
          }, function (err) { 
            if (err) throw err
            proxyClient.getRoutes(function (err, routes) {
              if (err) throw err
              assert.equal(routes.length, 0)
            })
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

  var registry = null

  before(function () {
    var registry = new RegistryClient({
      templateDir: './examples/'
    })
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
    var proxyClient = null
    var kubeClient = null

    // set during testing
    var app = null
    var location = null

    before(function () {
      proxyClient = new ProxyClient({
        namespace: namespace
      })
      kubeClient = new KubeClient()
    })

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

      'should be accessible through the proxy after route creation': function (done) {
        var url = urljoin('http://' + proxyClient.lookupIP, location)
        request(url, function (err, req, rsp) {
          if (err) throw err
          assert.notEqual(rsp.statusCode, null)
          assert.notEqual(rsp.statusCode, 404)
          assert.notEqual(rsp.statusCode, 503)
          done()
        })
      },

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
      }
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

/**
 * Remove the testing namespace after remote testing has finished (and a cluster is available)
 */
after(function cleanup() {
  if (clusterAvailable()) {
    var ns = utils.makeNamespace('binder-testing')
    var client = new KubeClient()
    client.namespaces.delete({
      template: ns
    }, function (err, ns) {
      if (err) console.log('WARNING: ' + err + ', proceeding anyway')
    })
  }
})
