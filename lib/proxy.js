var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var urljoin = require('url-join')
var request = require('request')
var format = require('string-format')
format.extend(String.prototype)

var kubeClient = require('./client')
var getLogger = require('binder-logging').getLogger

function ProxyClient (opts) {
  this.opts = opts || {}
  this.namespace = opts.test.testing ? 'binder-testing' : 'default'
  this.provider = opts.kube.provider || 'vagrant'
  this.client = kubeClient()

  // ips and token are set during creation
  this.token = null
  this.registerIP = null
  this.lookupIP = null
  this.vmIP = null

  this.logger = getLogger('binder-deploy-kubernetes')
}

ProxyClient.prototype.logInfo = function (msg) {
  this.logger.info(msg, { component: 'ProxyClient' })
}

ProxyClient.prototype.logError = function (msg) {
  this.logger.error(msg, { component: 'ProxyClient' })
}

ProxyClient.prototype.logDebug = function (msg) {
  this.logger.debug(msg, { component: 'ProxyClient' })
}

ProxyClient.prototype._startPod = function (token, cb) {
  this.logInfo('starting proxy pod')
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
              value: '{0}'.format(token)
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
    condition: function (pods) {
      var readyStatus = { type: 'Ready', status: 'True' }
      return (pods.length > 0) && (_.filter(pods[0].status.conditions, readyStatus).length > 0)
    },
    times: 20,
    interval: 20000,
    action: this.client.pods.create
  }, function (err, pod) {
    if (err) {
      self.logInfo('could not start proxy pod: ' + err)
    } else {
      self.logInfo('started proxy pod')
    }
    return cb(err)
  })
}

ProxyClient.prototype._getIngressIP = function (service) {
  if (this.provider === 'vagrant') {
    var nodePort = _.get(service, 'spec.ports[0].nodePort')
    if (!nodePort) {
      return null
    }
    return this.vmIP + ':' + nodePort
  } else {
    return _.get(service, 'status.loadBalancer.ingress[0].ip')
  }
}

ProxyClient.prototype._startService = function (name, service, cb) {
  var self = this
  this.logInfo('starting service: {0}'.format(name))
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
      self.logInfo('could not start service {0}: '.format(name) + err)
      return cb(err)
    }
    var ip = self._getIngressIP(service)
    self.logInfo('started service {0} -- ingressIP: {1}'.format(name, ip))
    return cb(null, ip)
  })
}

ProxyClient.prototype._startRegistrationService = function (cb) {
  var spec = {
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
  if (this.provider === 'vagrant') {
    spec.type = 'NodePort'
    spec.ports[0].nodePort = 30290
  } else {
    spec.type = 'LoadBalancer'
    spec.sessionAffinity = 'None'
  }
  var service = {
    kind: 'Service',
    metadata: {
      name: 'proxy-registration',
      namespace: this.namespace,
      labels: {
        name: 'proxy-registration'
      }
    },
    spec: spec
  }
  this._startService('registration', service, cb)
}

ProxyClient.prototype._startLookupService = function (cb) {
  var spec = {
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
  if (this.provider === 'vagrant') {
    spec.type = 'NodePort'
    spec.ports[0].nodePort = 30291
  } else {
    spec.type = 'LoadBalancer'
    spec.sessionAffinity = 'None'
  }

  var service = {
    kind: 'Service',
    metadata: {
      name: 'proxy-lookup',
      namespace: this.namespace,
      labels: {
        name: 'proxy-lookup'
      }
    },
    spec: spec
  }
  this._startService('lookup', service, cb)
}

ProxyClient.prototype._startReplicationController = function (token, cb) {
  this._startPod(token, cb)
}

ProxyClient.prototype._getRunningInfo = function (cb) {
  var self = this
  self.logInfo('getting info on running proxy services')
  var getVMInfo = function (next) {
    if (self.provider === 'vagrant') {
      self.client.nodes.get(function (err, nodes) {
        if (err) return next(err)
        self.vmIP = _.get(nodes[0], 'spec.externalID')
        return next(null)
      })
    } else {
      return next(null)
    }
  }
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
        self.logInfo('found ingress IP {0} for {1}'.format(ip, name))
        return next(null, ip)
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
      self.logInfo('pods: {0}'.format(JSON.stringify(pods)))
      var pod = pods[0]
      var token = _.get(pod, 'spec.containers[0].env[0].value')
      return next(null, token)
    })
  }
  async.series([
    getVMInfo,
    getServiceInfo('proxy-lookup'),
    getServiceInfo('proxy-registration'),
    getAuthToken
  ], function (err, results) {
    if (err) {
      self.logError('error in _getRunningInfo: ' + err)
      return cb(err)
    }
    var info = {
      lookupIP: results[1],
      registerIP: results[2],
      token: results[3]
    }
    self.logInfo('in _getRunningInfo, info: {0}'.format(JSON.stringify(info)))
    return cb(null, info)
  })
}

ProxyClient.prototype.launchClusterProxy = function (cb) {
  this.logInfo('checking if the cluster proxy needs to be started')
  var self = this
  this._getRunningInfo(function (err, info) {
    if (err) return cb(err)
    if (info.registerIP && info.lookupIP && info.token) {
      self.logger.warn('cluster proxy already running')
      self.registerIP = info.registerIP
      self.lookupIP = info.lookupIP
      self.token = info.token
      return cb(null)
    }
    self.logInfo('cluster proxy not fully running -- starting launch')
    var token = hat()
    var tasks = [_.partial(self._startReplicationController.bind(self), token)]
    if (!info.registerIP) {
      tasks.push(self._startRegistrationService.bind(self))
    }
    if (!info.lookupIP) {
      tasks.push(self._startLookupService.bind(self))
    }
    async.parallel(tasks, function (err, ips) {
      if (err) {
        self.logError('in launchClusterProxy: ' + err)
        return cb(err)
      }      
      self.lookupIP = ips[2]
      self.registerIP = ips[1]
      self.logInfo('successfully launched cluster proxy -- lookupIP: {0}, registerIP: {1}'
                  .format(self.lookupIP, self.registerIP))
      return cb(null)
    })
  })
}

ProxyClient.prototype.stopClusterProxy = function (cb) {
  this.logInfo('stopping cluster proxy')
  cb(new Error('stopClusterProxy not implemented'))
}

ProxyClient.prototype._ensureLaunched = function (func, cb) {
  if (!this.token) {
    this.launchClusterProxy(function (err) {
      if (err) return cb(err)
      func(cb)
    })
  } else {
    func(cb)
  }
}

ProxyClient.prototype.registerProxyRoute = function (route, target, cb) {
  var self = this
  var register = function (route, target, cb) {
    this.logInfo('registering proxy route: {0} -> {1}'.format(route, target))
    var self = this
    var opts = {
      url: urljoin('http://' + self.registerIP, '/api/routes', route),
      method: 'POST',
      json: true,
      body: { 'target': target },
      headers: { 'Authorization': 'token {0}'.format(self.token) }
    }
    self.logDebug('sending request to: {0}'.format(JSON.stringify(opts)))
    request.post(opts, function (err, response, body) {
      if (err) return cb(err)
      if (response.statusCode !== 201) {
        var msg = 'could not register proxy route -- bad response: {0}'.format(JSON.stringify(response))
        self.logError(msg)
        return cb(new Error(msg))
      }
      return cb(null)
    })
  }
  if (!this.token) {
    this.launchClusterProxy(function (err) {
      if (err) return cb(err)
      register.bind(self)(route, target, cb)
    })
  } else {
    register.bind(self)(route, target, cb)
  }
}

ProxyClient.prototype.removeProxyRoute = function (route, cb) {
  var self = this
  var remove = function (route, cb) {
    var self = this
    self.logInfo('removing proxy route: {0}'.format(route))
    var opts = {
      url: urljoin('http://' + self.registerIP, '/api/routes', route),
      method: 'DELETE',
      headers: { 'Authorization': 'token {0}'.format(self.token) }
    }
    self.logDebug('sending request to {0}'.format(JSON.stringify(opts)))
    request(opts, function (err, response, body) {
      if (err) {
        self.logError('could not remove proxy route: ' + err)
        return cb(err)
      }
      if (response.statusCode !== 204) {
        var msg = 'could not register proxy route -- bad response: {0}'.format(JSON.stringify(response))
        self.logError(msg)
        return cb(msg)
      }
      return cb(null)
    })
  }
  if (!this.token) {
    this.launchClusterProxy(function (err) {
      if (err) return cb(err)
      remove.bind(self)(route, cb)
    })
  } else {
    remove.bind(self)(route, cb)
  }
}

ProxyClient.prototype.getRoutes = function (opts, cb) {
  var self = this
  opts = opts || {}
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  var get = function (opts, cb) {
    var age = opts.age
    this.logInfo('getting proxy routes with age: {0}'.format(age))
    if (!this.registerIP) {
      var msg = 'cannot get all routes: this.registerIP is not set'
      this.logError(msg)
      return cb(new Error(msg))
    }
    var url = urljoin('http://' + this.registerIP, '/api/routes')
    if (age) {
      var now = new Date()
      var then = new Date(now - age * 60 * 1000)
      url = url + '?inactive_since={0}'.format(then.toISOString())
    }
    this.logDebug('route query url: {0}'.format(url))
    opts = {
      url: url,
      json: true,
      headers: { 'Authorization': 'token {0}'.format(this.token) }
    }
    this.logDebug('full route query options: {0}'.format(JSON.stringify(opts)))
    request(opts, function (err, response, body) {
      if (err) return cb(err)
      body = body || []
      return cb(null, body)
    })
  }
  if (!this.token) {
    this.launchClusterProxy(function (err) {
      if (err) return cb(err)
      get.bind(self)(opts, cb)
    })
  } else {
    get.bind(self)(opts, cb)
  }
}

var singleton = null

var getInstance = function (opts) {
  if (singleton) {
    return singleton
  }
  singleton = new ProxyClient(opts)
  return singleton
}
module.exports = {
  getInstance: getInstance,
  ProxyClient: ProxyClient
}
