var _ = require('lodash')
var async = require('async')
var assert = require('assert')
var request = require('request')
var urljoin = require('url-join')
var KubeClient = require('kube-stream')
var utils = require('kube-test-utils')

var Pool = require('../lib/state/pool.js').Pool
var App = require('../lib/state/app.js').App
var RegistryClient = require('../lib/registry.js')
var proxyClient = require('../lib/proxy.js').getInstance
var ProxyClient = require('../lib/proxy.js').ProxyClient
var DeployServer = require('../lib/server.js')
var settings = require('../lib/settings.js')
var getDatabase = require('binder-db').getDatabase

var clusterAvailable = require('./1-main.js').clusterAvailable

var namespace = 'binder-testing'

var makeRemote = function (tests) {
  before(function () {
    if (!clusterAvailable()) {
      console.log('WARNING: skipping proxy test because cluster is unavailable')
      this.skip()
    }
  })
  _.map(_.keys(tests), function (name) {
   it(name, tests[name])
  })
}

// the proxy client can be shared across test suite
var proxy

// Implementation Tests

describe.skip('Proxy', function () {

  /**
   * Remove the old testing namespace and create a new one (if a cluster is available)
   */
  before(function initialize (done) {
    this.timeout(10000)
    if (clusterAvailable()) {
      var client = new KubeClient()
      var nsTemplate = utils.makeNamespace(namespace)
      console.log('About to delete old testing namespace, if it exists')
      client.namespaces.when({
        state: nsTemplate,
        condition: function (namespaces) {
          var nss = _.filter(namespaces, nsTemplate)
          return nss.length === 0
        },
        action: client.namespaces.delete
      }, function (err, ns) {
        if (err) console.error('WARNING: Could not delete binder-testing namespace -- continuing')
        console.log('About to create testing namespace')
        client.namespaces.changeState({
          state: nsTemplate,
          delta: { status: { phase: 'Active' } },
          action: client.namespaces.create
        }, function (err, ns) {
          if (err) throw err
          console.log('Created {0} namespace...'.format(_.get(nsTemplate, 'metadata.name')))
          done()
        })
      })
    }
  })

  describe('(remote)', function () {
    var tests = {
      'should be initialized correctly': function (done) {
        proxy = proxyClient(settings)
        done()
      },
      'should create the proxy pods/services': function (done) {
        // give the proxy six minutes to start up
        this.timeout(360000)
        proxy.launchClusterProxy(function (err) {
          if (err) throw err
          done()
        })
      },
      'should have the proxy IPs after proxy creation': function (done) {
        assert.notEqual(proxy.lookupIP, null)
        assert.notEqual(proxy.registerIP, null)
        done()
      },
      'should be able to register routes': function (done) {
        proxy.registerProxyRoute('/user/blah', '9.9.9.9', function (err) {
          if (err) throw err
          done()
        })
      },
      'should be able to get all routes': function (done) {
        proxy.getRoutes(function (err, routes) {
          if (err) throw err
          assert.equal(routes['/user/blah'].target, '9.9.9.9')
          done()
        })
      }, 
      'should be able to get inactive routes': function (done) {
        proxy.getRoutes({ age: 10 }, function (err, routes) {
          if (err) throw err
          assert.equal(routes['/user/blah'], null)
          proxy.getRoutes({ age: 0.0001 }, function (err, routes) {
            if (err) throw err
            assert.equal(routes['/user/blah'].target, '9.9.9.9')
            done()
          })
        })
      },
      'should be able to remove routes': function (done) {
        proxy.getRoutes(function (err, routes) {
          if (err) throw err
          assert.notEqual(routes.length, 0)
          var routeKeys = _.keys(routes)
          assert.equal(routeKeys.length, 1)
          async.each(routeKeys, function (route, next) {
            proxy.removeProxyRoute(route, function (err) {
              if (err) throw err
              next(null)
            })
          }, function (err) {
            if (err) throw err
            proxy.getRoutes(function (err, routes) {
              if (err) throw err
              assert.deepEqual(routes, {})
              done()
            })
          })
        })
      },
      'should restore itself from the cluster state': function (done) {
        var proxy = new ProxyClient(settings)
        proxy.registerProxyRoute('/user/blah', '9.9.9.9', function (err) {
          if (err) throw err
          proxy.getRoutes({ age: 10 }, function (err, routes) {
            if (err) throw err
            assert.equal(routes['/user/blah'], null)
            proxy.getRoutes({ age: 0 }, function (err, routes) {
              if (err) throw err
              assert.equal(routes['/user/blah'].target, '9.9.9.9')
              done()
            })
          })
        })
      }
   }
   makeRemote(tests)
  })
})

describe.skip('App', function () {
  var registry = null

  before(function (done) {
    registry = new RegistryClient({
      registry: {},
      test: {
        testing: true,
        templateDir: './examples/'
      }
    })
    getDatabase(function (err, db) {
      App.initialize(db)
      done()
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
          this.timeout(50000000)
          registry.fetchTemplate(name, function (err, template) {
            if (err) throw err
            app = new App(template)
            app.save(function (err) {
              if (err) throw err
              async.retry({ times: 20, interval: 5000 }, function (next) {
                if (app.state === 'deployed') {
                  return next(null)
                }
                return next('retry')
              }, function (err) {
                if (err) throw err
                done()
              })
            })
          })
        },

        'should register routes with the cluster proxy': function (done) {
          app.makeRoute(function (err, loc) {
            if (err) throw err
            assert.equal(loc, app._location())
            location = app._location()
            done()
          })
        },

        'should be accessible through the proxy after route creation': function (done) {
          this.timeout(60000)
          var url = urljoin('http://' + proxy.lookupIP, location)
          console.log('url: ' + url)
          request(url, function (err, rsp) {
            if (err) throw err
            assert.notEqual(rsp.statusCode, null)
            assert.notEqual(rsp.statusCode, 404)
            assert.notEqual(rsp.statusCode, 503)
            done()
          })
        },

        'should do the correct cleanup once deleted': function (done) {
          this.skip()
          this.timeout(60000)
          app.remove(function (err) {
            if (err) throw err
            // ensure the pod has been deleted
            kubeClient.pods.get({
              template: app._frontendPod()
            }, function (err, pods) {
              if (err) throw err
              assert.equal(pods.length, 0)
              proxy.getRoutes(function (err, routes) {
                if (err) throw err
                // ensure the proxy route has been removed
                assert.deepEqual(_.keys(routes), ['/user/blah'])
                done()
              })
            })
          })
        }
      }
      makeRemote(tests)
    })
  })
})

// TODO these are skipped for now
describe.skip('Pool', function () {

  var registry = null
  var kube = null

  var pool = null
  // apps is a singleton
  var apps = require('../lib/state/app.js').apps

  before(function () {
    registry = new RegistryClient({
      registry: {},
      test: {
        testing: true,
        templateDir: './examples/'
      }
    })
    kube = new KubeClient()
  })

  describe('standalone', function () {
    var tests = {
      'should handle creation': function (done) {
        var templateName = 'binder-project-example-requirements'
        pool = new Pool({
          templateName: templateName ,
          size: 5,
        })
        pool.create(function (err) {
          if (err) throw err
          assert.equal(apps.length(), 5)
          assert.equal(pool.available(), 5)
          // ensure that the apps are running on the cluster
          kube.pods.get({
            template: { metadata: { labels: { templateName: templateName}}}
          }, function (err, pods) {
            if (err) throw err
            assert.equal(pods.length, 5)
            _.forEach(pods, function (pod) {
              assert.equal(_.get(pod, 'status.phase'), 'Running')
            })
            done()
          })
        })
      },
      'should handle assigning': function (done) {
        pool.assign(function (err, slot) {
          if (err) throw err
          assert.equal(pool.available(), 4)
          // TODO resume here 
        })
      }, 
      'should handle resizing': function (done) {
      },
      'should handle deletion': function (done) {
      }
    }
    makeRemote(tests)
  })

  describe('through collection', function () {
    var tests = {
      'should handle creation': function (done) {
      },
      'should handle deletion': function (done) {
      },
      'should handle multiple templates': function (done) {
      }
    }
    makeRemote(tests)
  })
})

// External API tests

// skip these thests for now
describe.skip('Pools', function () {

  var tests = {
    'should get all pools': function (done) {
    }, 
    'should get pools for a template': function (done) {
    },
    'should create pools': function (done) {
    },
    'should delete pools': function (done) {
    },
    'should resize pools': function (done) {
    }
  }
  makeRemote(tests)
})

describe.skip('Cluster', function () {

  var deployServer = null
  var baseUrl = null
  var apiKey = null

  // used during testing
  var id = null

  before(function () {
    deployServer = new DeployServer()
    baseUrl = 'http://localhost:' + deployServer.port
    apiKey = deployServer.apiKey
    deployServer.start()
  })

  after(function () {
    if (deployServer) {
      // deployServer.stop()
    }
  })

  var tests = {

    'should create applications': function (done) {
      var opts = {
        url: urljoin(baseUrl, 'applications', 'binder-project-example-requirements'),
        method: 'POST',
        json: true
      }
      request(opts, function (err, rsp, body) {
        if (err) throw err
        assert.notEqual(rsp.statusCode, 403)
        assert.notEqual(rsp.statusCode, 404)
        assert.notEqual(rsp.statusCode, 500)
        id = body.id
        done()
      })
    },

    'should get all applications matching a template': function (done) {
      var opts = {
        url: urljoin(baseUrl, 'applications', 'binder-project-example-requirements'),
        headers: {
          'Authorization': apiKey
        }
      }
      request(opts, function (err, rsp, body) {
        if (err) throw err
        assert.notEqual(rsp.statusCode, 403)
        assert.notEqual(rsp.statusCode, 404)
        assert.notEqual(rsp.statusCode, 500)
        done()
      })
    },

    'should get all applications': function (done) {
      var opts = {
        url: urljoin(baseUrl, 'applications/'),
        headers: {
          'Authorization': apiKey
        }
      }
      request(opts, function (err, rsp) {
        if (err) throw err
        assert.notEqual(rsp.statusCode, 403)
        assert.notEqual(rsp.statusCode, 404)
        assert.notEqual(rsp.statusCode, 500)
        done()
      })
    }, 

    'should not get all applications if not authorized': function (done) {
      var opts = {
        url: urljoin(baseUrl, 'applications/'),
      }
      request(opts, function (err, rsp) {
        if (err) throw err
        assert.equal(rsp.statusCode, 403)
        done()
      })
    }, 


    'should get individual applications': function (done) {
      var opts = {
        url: urljoin(baseUrl, 'applications', 'binder-project-example-requirements', id)
      }
      request(opts, function (err, rsp) {
        if (err) throw err
        assert.notEqual(rsp.statusCode, 403)
        assert.notEqual(rsp.statusCode, 404)
        assert.notEqual(rsp.statusCode, 500)
        done()
      })
    },

    'after creating an App, should poll until status is \'deployed\'': function (done) {
      this.timeout(50000)
      async.retry({ times: 20, interval: 5000 }, function (next) {
        console.log('Retrying...')
        var opts = {
          url: urljoin(baseUrl, 'applications', 'binder-project-example-requirements', id),
          json: true
        }
        request(opts, function (err, rsp, body) {
          console.log('inner err: ' + err)
          if (err) throw err
          assert.notEqual(rsp.statusCode, 403)
          assert.notEqual(rsp.statusCode, 404)
          assert.notEqual(rsp.statusCode, 500)
          console.log('body: ' + JSON.stringify(body))
          if (body.location && (body.status === 'deployed')) { 
            console.log('finished...')
            return next(null)
          } else {
            console.log('about to retry...')
            return next('retrying...')
          }
        })
      }, function (err) {
        console.log('err: ' + err)
        if (err) throw err
        done()
      })
    }
  }
  makeRemote(tests)
})

/**
 * Remove the testing namespace after remote testing has finished (and a cluster is available)
 */
/*
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
*/
