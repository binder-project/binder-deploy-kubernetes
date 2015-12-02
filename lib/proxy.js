var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var urljoin = require('url-join')
var request = require('request')
var format = require('string-format')
format.extend(String.prototype)

var logger = require('./logging.js')
var KubeClient = require('kube-stream')

module.exports = function ProxyClient (opts) {
  this.opts = opts || {}
  this.namespace = opts.namespace || 'default'
  this.token = this.opts.token || hat()
  this.client = new KubeClient()

  // ips are set after the proxy has been create
  this.registerIP = null
  this.lookupIP = null
}

ProxyClient.prototype._startPod = function (cb) {
  var pod = {
    kind: 'Pod',
    metadata: {
      name: 'proxy-server',
      namespace: this.namespace,
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
          ],
          imagePullPolicy: 'Always'
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
          ],
          imagePullPolicy: 'Always'
        }
      ],
      volumes: [
        {
          name: 'proxy-route-storage',
          emptyDir: {}
        }
      ],
      dnsPolicy: 'ClusterFirst',
      restartPolicy: 'Always'
    }
  }
  this.client.pods.create({
    template: pod
  }, function (err, pod) {
    return cb(err)
  })
}

ProxyClient.prototype._startRegistrationService = function (cb) {
  var service = {
    kind: 'Service',
    apiVersion: 'v1',
    metadata: {
      name: 'proxy-registration',
      namespace: this.namespace,
      labels: {
        name: 'proxy-registration'
      }
    },
    spec: {
      type: 'LoadBalancer',
      sessionAffinity: 'None',
      ports: [
        {
          port: 80,
          targetPort: 8081,
          protocol: 'TCP'
        }
      ],
      selector: {
        name: 'proxy-server'
      }
    }
  }
  this.client.services.create({
    template: service
  }, function (err, service) {
    return cb(err)
  })
}

ProxyClient.prototype._startLookupService = function (cb) {
  var service = {
    kind: 'Service',
    apiVersion: 'v1',
    metadata: {
      name: 'proxy-lookup',
      namespace: this.namespace
      labels: {
        name: 'proxy-lookup'
      }
    },
    spec: {
      type: 'LoadBalancer',
      sessionAffinity: 'None',
      ports: [
        {
          port: 80,
          targetPort: 8080,
          protocol: 'TCP'
        }
      ],
      selector: {
        name: 'proxy-server'
      }
    }
  }
  this.client.services.create({
    template: service
  }, function (err, service) {
    return cb(err)
  })
}

ProxyClient.prototype._startReplicationController = function (cb) {
  this._startPod(cb)
}

ProxyClient.prototype._getProxyIP = function (label) {
  var self = this
  var getIngressIP(service) {
    return _.get(service, 'status.loadBalancer.ingress[0].ip')
  }
  var getter = function (cb) {
    this.client.services.when({
      template: { metadata: { name: label}},
      condition: function (services) {
        if (services.length == 1) {
          var service = services[0]
          var ingressIP = getIngressIP(service)
          if (ingressIP) {
            return true
          }
        }
        return false
      }
    }, function (err, services) {
      if (err) return cb(err)
      var service = services[0]
      return cb(null, getIngressIP(service))
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
          self._startReplicationController.bind(self),
          self._startRegistrationService.bind(self),
          self._startLookupService.bind(self)
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
      headers: { 'Authorization': 'token {0}'.format(self.token) }
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
      headers: { 'Authorization': 'token {0}'.format(self.token) }
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

ProxyClient.getRoutes = function (opts, cb) {
  opts = opts || {}
  if (typeof opts === 'function') {
    cb = opts 
    opts = {}
  }
  var age = opts.age
  if (!this.registerIP) {
    return cb(new Error('cannot get all routes without first starting the proxy'))
  }
  var url = urljoin('http://' + this.registerIP) 
  if (age) {
    var now = new Date()
    var then = new Date(now - age * 60 * 1000)
    url = url + '?{0}'.format(then.toISOString())
  }
  var opts = {
    url: url,
    json: true
    headers: { 'Authorization' : 'token {0}'.format(this.token) }
  }
  request(opts, function (err, response, body) {
    if (err) return cb(err)
    return cb(null, body)
  })
}
