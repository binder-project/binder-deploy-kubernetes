var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var urljoin = require('url-join')
var request = require('request')
var KubeClient = require('kube-stream')
var format = require('string-format')
format.extend(String.prototype) 
var defaultLogger = require('./logging.js')

function ProxyClient (opts) {
  this.opts = opts || {}
  this.namespace = opts.namespace || 'default'
  this.token = this.opts.token || hat()
  this.client = new KubeClient()

  // ips are set after the proxy has been create
  this.registerIP = null
  this.lookupIP = null

  this.logger = this._makeLogger(defaultLogger())
}

ProxyClient.prototype._makeLogger = function (base) {
  var self = this
  base.rewriters.push(function (level, msg, meta) {
    meta.component = 'ProxyClient'
    return meta
  })
  return base
}

ProxyClient.prototype._startPod = function (cb) {
  this.logger.info('starting proxy pod')
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
              containerPort: 8080,
              protocol: 'TCP'
            },
            {
              containerPort: 8001,
              protocol: 'TCP'
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
              containerPort: 27017,
              protocol: 'TCP'
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
  var self = this
  this.client.pods.changeState({
    state: pod,
    delta: { status: { phase: 'Running' }},
    action: this.client.pods.create
  }, function (err, pod) {
    if (err) {
      self.logger.info('could not start proxy pod: {0}'.format(err))
    } else {
      self.logger.info('started proxy pod')
    }
    return cb(err) 
  })
}

ProxyClient.prototype._getIngressIP = function (service) {
  return _.get(service, 'status.loadBalancer.ingress[0].ip')
}

ProxyClient.prototype._startService = function (name, service, cb) {
  var self = this
  this.logger.info('starting service: {0}'.format(name))
  this.client.services.changeState({
    state: service,
    condition: function (services) {
      var service = _.find(services, function (s) {
        return self._getIngressIP(s)
      })
      return service
    },
    times: 20,
    interval: 20000,
    action: this.client.services.create
  }, function (err, service) {
    if (err) {
      self.logger.info('could not start service {0}: {1}'.format(name, err))
      return cb(err)
    }
    ip = self._getIngressIP(service)
    self.logger.info('started service {0} -- ingressIP: {1}'.format(name, ip))
    return cb(null, ip)
  })
}

ProxyClient.prototype._startRegistrationService = function (cb) {
  var service = {
    kind: 'Service',
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
  this._startService('registration', service, cb)
}

ProxyClient.prototype._startLookupService = function (cb) {
  var service = {
    kind: 'Service',
    metadata: {
      name: 'proxy-lookup',
      namespace: this.namespace,
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
  this._startService('lookup', service, cb)
}

ProxyClient.prototype._startReplicationController = function (cb) {
  this._startPod(cb)
}

ProxyClient.prototype._getRunningInfo(cb) {
  var self = this
  self.logger.info('getting info on running proxy services')
  var getServiceInfo = function (name) {
    return function (next) { 
      self.client.services.get({
        template: { 
          metadata: {
            name: name,
            namespace: self.namespace
          }
      }}, function (err, services) {
        if (err) return next(err)
        var service = services[0]
        var ip = self._getIngressIP(service)
        self.logger.info('found ingress IP {0} for {1}'.format(ip, name))
        return cb(null, ip)
      })
    }
  }
  var getAuthToken = function (next) {
    self.client.pods.get({
      template: {
        metadata: {
          name: 'proxy-server',
          namespace: self.namespace
        }
      }
    }, function (err, pods) {
      if (err) return next(err)
      var pod = pods[0]
      var token = _.get(pod, 'spec.containers[0].env[0].value')
      self.logger.info('found auth token {0}'.format(token))
      return next(null, token)
    })
  }
  async.parallel([
    getServiceInfo('proxy-lookup'),
    getServiceInfo('proxy-registration'),
    getAuthToken
  ], function (err, results) {
    if (err) {
      self.logger.error('in _getRunningInfo: {0}'.format(err))
      return cb(err)
    }
    var info = {
      lookupIP: results[0],
      registerIP: results[1],
      token: results[2]
    }
    return cb(null, info)
  })
}

ProxyClient.prototype.isRunning = function (cb) {
  this.logger.info('checking if proxy is running')
  var self = this
  var checkResource = function (resource, template) {
    return function (next) { 
      var name = _.get(template, 'metadata.name')
      self.logger.info('checking if {0} is running'.format(name))
      resource.get({
        template: template
      }, function (err, resources) {
        if (err) return next(err)
        if (resources.length > 0) {
          self.logger.info('{0} is running'.format(name))
          return next(null, true)
        }
        self.logger.info('{0} is not running'.format(name))
        return next(null, false)
      })
    }
  }
  var podTemplate = { 
    metadata: { name: 'proxy-server' },
    status: { phase: 'Running' }
  }
  var serviceTemplate = function (name) {
    return { metadata: { name: 'proxy-' + name }} 
  }
  async.parallel([
    checkResource(this.client.pods, podTemplate),
    checkResource(this.client.services, serviceTemplate('registration')),
    checkResource(this.client.services, serviceTemplate('lookup'))
  ], function (err, results) {
      if (err) {
        self.logger.error('in isRunning: {0}'.format(err))
        return cb(err)
      }
      self.logger.info('isRunning finished')
      var running = _.every(results, Boolean)
      if (running) {
        self.logger.info('the cluster proxy is running')
      } else {
        self.logger.info('the cluster proxy is not running')
      }
      return cb(null, running)
  })
}

ProxyClient.prototype.launchClusterProxy = function (cb) {
  this.logger.info('about to start the cluster proxy')
  var self = this
  this.isRunning(function (err, running) {
    if (err) return cb(err)
    if (running) {
      self.logger.warning('cluster proxy already running')
      return cb(null)
    }
    self.logger.info('cluster proxy not running -- starting launch')
    var tasks = [
          self._startReplicationController.bind(self),
          self._startRegistrationService.bind(self),
          self._startLookupService.bind(self)
      ]
    async.parallel(tasks, function (err, ips) {
      if (err) {
        self.logger.error('in launchClusterProxy: {0}'.format(err))
        return cb(err)
      }      
      self.lookupIP = ips[2]
      self.registerIP = ips[1]
      self.logger.info('successfully launched cluster proxy -- lookupIP: {0}, registerIP: {1}'
                  .format(self.lookupIP, self.registerIP))
      return cb(null)
    })
  })
}

ProxyClient.prototype.stopClusterProxy = function (cb) {
  this.logger.info('stopping cluster proxy')
  cb(new Error('stopClusterProxy not implemented'))
}

ProxyClient.prototype.registerProxyRoute = function (route, target, cb) {
  this.logger.info('registering proxy route: {0} -> {1}'.format(route, target))
  var self = this
  this.isRunning(function (err, running) {
    if (err) return cb(err)
    var msg = null
    if (!running) {
      msg = 'cluster proxy not running -- cannot register route'
      self.logger.error(msg)
      return cb(new Error(msg))
    } if (!self.registerIP) {
      msg = 'registerIP not set -- cannot register route'
      self.logger.error(msg)
      return cb(new Error(msg))
    }
    var opts = {
      url: urljoin('http://' + self.registerIP, '/api/routes', route),
      method: 'POST',
      json: true,
      body: { 'target': target },
      headers: { 'Authorization': 'token {0}'.format(self.token) }
    }
    self.logger.debug('sending request to: {0}'.format(JSON.stringify(opts)))
    request.post(opts, function (err, response, body) {
      if (err) return cb(err)
      if (response.statusCode !== 201) {
        var msg = 'could not register proxy route -- bad response: {0}'.format(JSON.stringify(response))
        self.logger.error(msg)
        return cb(msg)
      }
      return cb(null)
    })
  })
}

ProxyClient.prototype.removeProxyRoute = function (route, cb) {
  var self = this
  self.logger.info('removing proxy route: {0}'.format(route))
  this.isRunning(function (err, running) {
    if (err) {
      self.logger.error('could not remove proxy route: {0}'.format(err))
      return cb(err)
    }
    var msg = null
    if (!running) {
      msg = 'cluster proxy not running -- cannot remove route'
      self.logger.error(msg)
      return cb(new Error(msg))
    } if (!self.registerIP) {
      msg = 'registerIP not set -- cannot register route'
      self.logger.error(msg)
      return cb(new Error(msg))
    }
    var opts = {
      url: urljoin('http://' + self.registerIP, '/api/routes', route),
      method: 'DELETE',
      headers: { 'Authorization': 'token {0}'.format(self.token) }
    }
    self.logger.debug('sending request to {0}'.format(JSON.stringify(opts)))
    request(opts, function (err, response, body) {
      if (err) {
        self.logger.error('could not remove proxy route: {0}'.format(err))
        return cb(err)
      }
      if (response.statusCode !== 204) {
        msg = 'could not register proxy route -- bad response: {0}'.format(JSON.stringify(response))
        self.logger.error(msg)
        return cb(msg)
      }
      return cb(null)
    })
  })
}

ProxyClient.prototype.getRoutes = function (opts, cb) {
  opts = opts || {}
  if (typeof opts === 'function') {
    cb = opts 
    opts = {}
  }
  var age = opts.age
  this.logger.info('getting proxy routes with age: {0}'.format(age))
  if (!this.registerIP) {
    var msg = 'cannot get all routes: this.registerIP is not set'
    this.logger.error(msg)
    return cb(new Error(msg))
  }
  var url = urljoin('http://' + this.registerIP, '/api/routes') 
  if (age) {
    var now = new Date()
    var then = new Date(now - age * 60 * 1000)
    url = url + '?inactive_since={0}'.format(then.toISOString())
  }
  this.logger.debug('route query url: {0}'.format(url))
  var opts = {
    url: url,
    json: true,
    headers: { 'Authorization' : 'token {0}'.format(this.token) }
  }
  this.logger.debug('full route query options: {0}'.format(JSON.stringify(opts)))
  request(opts, function (err, response, body) {
    if (err) return cb(err)
    return cb(null, body)
  })
}

var singleton = null

var getInstance = function () {
  if (singleton) {
    return singleton
  } 
  singleton = new ProxyClient()
  return singleton
}
module.exports = getInstance
