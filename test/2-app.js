var _ = require('lodash')
var async = require('async')
var assert = require('assert')
var KubeClient = require('kube-stream')
var utils = require('kube-test-utils')

var App = require('../lib/state/app.js').App
var RegistryClient = require('../lib/registry.js')
var ProxyClient = require('../lib/proxy.js')

var clusterAvailable = require('./1-main.js').clusterAvailable

var namespace = 'binder-testing'
var proxyClient = null

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
        if (err) throw err
        console.log('Created {0} namespace...'.format(_.get(nsTemplate, 'metadata.name')))
        done()
      })
    })
  }
})

describe('Proxy', function () {
  describe('(remote)', function () {

    proxyClient = new ProxyClient({
      namespace: namespace
    })

    var tests = {

      'should create the proxy pods/services': function (done) {
        // give the proxy six minutes to start up
        this.timeout(360000)
        proxyClient.launchClusterProxy(function (err) {
          if (err) throw err
          done()
        })
      },

      'should have the proxy IPs after proxy creation': function (done) {
        assert.notEqual(proxyClient.lookupIP, null)
        assert.notEqual(proxyClient.registerIP, null)
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
          assert.equal(routes['/user/blah'].target, '9.9.9.9')
          done()
        })
      }, 

      'should be able to get inactive routes': function (done) {
        proxyClient.getRoutes({ age: 10 }, function (err, routes) {
          if (err) throw err
          assert.equal(routes['/user/blah'], null)
          proxyClient.getRoutes({ age: 0.0001 }, function (err, routes) {
            if (err) throw err
            assert.equal(routes['/user/blah'].target, '9.9.9.9')
            done()
          })
        })
      },

      'should be able to remove routes': function (done) {
        proxyClient.getRoutes(function (err, routes) {
          if (err) throw err
          assert.notEqual(routes.length, 0)
          var routeKeys = _.keys(routes)
          assert.equal(routeKeys.length, 1)
          async.each(routeKeys, function (route, next) {
            proxyClient.removeProxyRoute(route, function (err) {
              if (err) throw err
              next(null)
            })
          }, function (err) { 
            if (err) throw err
            proxyClient.getRoutes(function (err, routes) {
              if (err) throw err
              assert.deepEqual(routes, {})
              done()
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
    registry = new RegistryClient({
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
    var kubeClient = null

    // set during testing
    var app = null
    var location = null

    before(function () {
      kubeClient = new KubeClient()
    })

    describe('standalone', function () { 
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
                // ensure the proxy route has been removed
                assert.deepEqual(routes, {})
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

    describe('through collection', function () {

      var apps = require('../lib/state/app.js').apps
      var app = null

      var tests = {

        'adding to collection should create on cluster': function (done) {
          registry.fetchTemplate(name, function (err, template) {
            if (err) throw err
            app = new App(template)
            apps.insert(app, function (err) {
              if (err) throw err
              assert.equal(apps.length(), 1)
              var template = { 'image-name': 'binder-project-example-requirements' } 
              apps.findOne(template, function (err, one) {
                if (err) throw err
                assert(one)
                assert.equal(one.imageName, 'binder-project-example-requirements')
                // ensure that the app is running on the cluster
                kubeClient.pods.get({
                  template: { metadata: { namespace: app.id }}
                }, function (err, pods) {
                  assert.equal(pods.length, 1)
                  var pod = pods[0]
                  assert.equal(_.get(pod, 'status.phase'), 'Running')
                  done()
                })
              })
            })
          })
        }, 

        'removing from collection should remove from cluster': function (done) {
          var template = { metadata: { namespace: app.id }}
          apps.remove(template, function (err) {
            if (err) throw err
              // ensure that the app is no longer on the cluster
            kubeClient.pods.get({
              template: template
            }, function (err, pods) {
              if (err) throw err
              assert(pods.length, 0)
              done()
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
