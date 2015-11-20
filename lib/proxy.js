var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var urljoin = require('url-join')
var request = require('request')
var format = require('string-format')
format.extend(String.prototype)

var logger = require('./logging.js')
var kubeClient = require('./client.js')

function ProxyClient (opts) {
  this.opts = opts
  this.token = opts.token || hat()
  this.client = kubeClient()

  // ips are set after the proxy has been create
  this.registerIP = null
  this.lookupIP = null

  // options for proxy IP
  this.retryInterval = opts.retryInterval || 5
  this.retryTimes = opts.retryTimes || 30
}

ProxyClient.prototype._startPod = function (cb) {
  var pod = {
    kind: 'Pod',
    apiVersion: 'v1',
    metadata: {
      name: 'proxy-server',
      labels: {
        name: 'proxy-server'
      }
    },
    spec: {
      containers: [
        {
          name: 'proxy-server',
          image: 'andrewosh/proxy-server:latest',
          env: [
            {
              name: 'CONFIGPROXY_AUTH_TOKEN',
              value: '{0}'.format(this.token)
            }
          ],
          command: ['configurable-http-proxy', '--port', '8080', '--error-path', '/home/main/error_pages',
            '--api-port', '8081', '--api-ip', '0.0.0.0', '--log-level', 'debug'],
          ports: [
            {
              containerPort: 8080
            },
            {
              containerPort: 8001
            }
          ]
        },
        {
          name: 'proxy-db',
          image: 'andrewosh/proxy-mongodb:latest',
          volumeMounts: [
            {
              name: 'proxy-route-storage',
              mountPath: '/data/db'
            }
          ],
          ports: [
            {
              containerPort: 27017
            }
          ]
        }
      ],
      volumes: [
        {
          name: 'proxy-route-storage',
          emptyDir: {}
        }
      ]
    }
  }
  this.client.pods.create(pod, function (err) {
    cb(err)
  })
}

ProxyClient.prototype._startRegistrationService = function (cb) {
  var service = {
    kind: 'Service',
    apiVersion: 'v1',
    metadata: {
      name: 'proxy-registration',
      labels: {
        name: 'proxy-registration'
      }
    },
    spec: {
      type: 'LoadBalancer',
      ports: [
        {
          port: 80,
          targetPort: 8081
        }
      ],
      selector: {
        name: 'proxy-server'
      }
    }
  }
  this.client.services.create(service, function (err) {
    cb(err)
  })
}

ProxyClient.prototype._startLookupService = function (cb) {
  var service = {
    kind: 'Service',
    apiVersion: 'v1',
    metadata: {
      name: 'proxy-lookup',
      labels: {
        name: 'proxy-lookup'
      }
    },
    spec: {
      type: 'LoadBalancer',
      ports: [
        {
          port: 80,
          targetPort: 8080
        }
      ],
      selector: {
        name: 'proxy-server'
      }
    }
  }
  this.client.services.create(service, function (err) {
    cb(err)
  })
}

ProxyClient.prototype._startReplicationController = function (cb) {
  this._startPod(cb)
}

ProxyClient.prototype._getProxyIP = function (label) {
  var self = this
  var getter = function (cb) {
    async.retry({ times: self.retryTimes, interval: self.retryInterval }, function (next) {
      // TODO getting all services until query string is better documented
      this.client.services.get(function (err, services) {
        if (err) return next(err)
        if (services) {
          var proxyService = _.find(services[0].items, function (service) {
            return service.metadata.name === label
          })
          if (!proxyService) {
            next(new Error('proxy service: {0} does not exist'.format(label)))
          } else {
            var ingressIP = _.get(proxyService, 'status.loadBalancer.ingress[0].ip')
            if (!ingressIP) {
              next(new Error('ingress IP not yet created for proxy service: {0}'.format(label)))
            } else {
              next(ingressIP)
            }
          }
        }
      })
    }, function (err, ip) {
      if (err) return cb(err)
      cb(null, ip)
    })
  }
  return getter
}

ProxyClient.prototype.isRunning = function (cb) {
  // TODO: getting all pods until query string is better documented
  async.parallel([
    function (next) {
      this.client.pods.get(function (err, pods) {
        var proxyPod = _.find(pods[0].items, function (pod) {
          return _.get(pod, 'metadata.name') === 'proxy-server'
        })
        if (err) return next(err)
        if (proxyPod) {
          return next(null, true)
        }
        next(null, false)
      })
    }, function (next) {
      this.client.services.get(function (err, services) {
        var proxyServices = _.where(services[0].items, function (service) {
          var name = _.get(service, 'metadata.name')
          return name === 'proxy-lookup' || name === 'proxy-registration'
        })
        if (err) return next(err)
        if (proxyServices.length === 2) {
          return next(null, true)
        }
        next(null, false)
      })
    }],
    function (err, results) {
      if (err) return cb(err)
      return cb(null, _.every(results, Boolean))
    })
}

ProxyClient.prototype.launchClusterProxy = function (cb) {
  var self = this
  this.isRunning(function (err, running) {
    if (err) return cb(err)
    if (running) {
      logger.warning('cluster proxy already running')
      return cb(null)
    }
    async.series([
      function (next) {
        var tasks = [
          self._startReplicationController,
          self._startRegistrationService,
          self._startLookupService
        ]
        async.parallel(tasks, function (err) {
          return next(err)
        })
      },
      function (next) {
        var tasks = [
          self._getProxyIP('proxy-lookup'),
          self._getProxyIP('proxy-registration')
        ]
        async.parallel(tasks, function (err, results) {
          if (err) return next(err)
          var lookupIP = results[0]
          var registrationIP = results[1]
          if (lookupIP && registrationIP) {
            self.lookupIP = lookupIP
            self.registrationIP = registrationIP
            return next(null)
          }
          return next(new Error('proxy lookupIP or registrationIP not specified'))
        })
      }],
      function (err) {
        return cb(err)
      })
  })
}

ProxyClient.prototype.stopClusterProxy = function (cb) {
  cb(new Error('stopClusterProxy not implemented'))
}

ProxyClient.prototype.registerProxyRoute = function (route, target, cb) {
  var self = this
  this.isRunning(function (err, running) {
    if (err) return cb(err)
    var msg = null
    if (!running) {
      msg = 'cluster proxy not running -- cannot register route'
      logger.error(msg)
      return cb(new Error(msg))
    } if (!this.registerIP) {
      msg = 'registerIP not set -- cannot register route'
      logger.error(msg)
      return cb(new Error(msg))
    }
    var opts = {
      url: urljoin('http://' + this.registerIP, route),
      json: true,
      body: { 'target': target },
      headers: { 'Authorization': self.token }
    }
    request.post(opts, function (err, response, body) {
      if (err) return cb(err)
      if (response.statusCode !== 200) {
        var msg = 'could not register proxy route -- bad status code'
        logger.error(msg)
        return cb(msg)
      }
      return cb(null)
    })
  })
}

ProxyClient.removeProxyRoute = function (route, cb) {
  var self = this
  this.isRunning(function (err, running) {
    if (err) return cb(err)
    var msg = null
    if (!running) {
      msg = 'cluster proxy not running -- cannot remove route'
      logger.error(msg)
      return cb(new Error(msg))
    } if (!this.registerIP) {
      msg = 'registerIP not set -- cannot register route'
      logger.error(msg)
      return cb(new Error(msg))
    }
    var opts = {
      url: urljoin('http://' + self.registerIP, route),
      method: 'DELETE',
      headers: { 'Authorization': self.token }
    }
    request(opts, function (err, response, body) {
      if (err) return cb(err)
      if (response.statusCode !== 210) {
        msg = 'could not register proxy route -- bad status code'
        logger.error(msg)
        return cb(msg)
      }
      return cb(null)
    })
  })
}

var singleton = null
var singletonOpts = null

var getInstance = function (opts) {
  if (singleton === null || !_.isEqual(singletonOpts, opts)) {
    singleton = new ProxyClient(opts)
    singletonOpts = opts
  }
  return singleton
}

module.exports = getInstance
