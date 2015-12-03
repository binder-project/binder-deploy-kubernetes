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

ProxyClient.prototype._makeLogger(base) {
  var self = this
  base.filters.push(function (level, msg, meta) {
    return 'App - {0} : {1} '.format(self.imageName, self.id) + msg
  })
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
  this.client.pods.changeState({
    state: pod,
    delta: { status: { phase: 'Running' }},
    action: this.client.pods.create
  }, function (err, pod) {
    if (err) {
      this.logger.info('could not start proxy pod: {0}'.format(err))
    } else {
      this.logger.info('started proxy pod')
    }
    return cb(err) 
  })
}

ProxyClient.prototype._startService = function (name, service, cb) {
  this.logger.info('starting service: {0}'.format(name))
  var getIngressIP = function (service) {
    return _.get(service, 'status.loadBalancer.ingress[0].ip')
  }
  this.client.services.changeState({
    state: service,
    condition: function (services) {
      if (services.length != 1) { 
        return false
      }
      return getIngressIP(services[0])
    },
    actionOpts: {
      times: 10,
      interval: 20
    },
    action: this.client.services.create
  }, function (err, service) {
    if (err) {
      this.logger.info('could not start service {0}: {1}'.format(name, err))
      return cb(err)
    }
    ip = getIngressIP(service)
    this.logger.info('started service {0} -- ingressIP: {1}'.format(name, ip))
    return cb(null, {
      name: ip
    })
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
  this._startService('registration', service, cb)
}

ProxyClient.prototype._startLookupService = function (cb) {
  var service = {
    kind: 'Service',
    apiVersion: 'v1',
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
  this._startService('registration', service, cb)
}

ProxyClient.prototype._startReplicationController = function (cb) {
  this._startPod(cb)
}

ProxyClient.prototype.isRunning = function (cb) {
  this.logger.info('checking if proxy is running')
  var self = this
  async.parallel([
    function (next) {
      self.logger.info('checking if the proxy pod is running')
      self.client.pods.get(function (err, pods) {
        var proxyPod = _.find(pods[0].items, function (pod) {
          return _.get(pod, 'metadata.name') === 'proxy-server'
        })
        if (err) return next(err)
        if (proxyPod) {
          self.logger.info('proxy pod is running')
          return next(null, true)
        }
        self.logger.info('proxy pod is not running')
        next(null, false)
      })
    }, function (next) {
      self.logger.info('checking if proxy services are running')
      self.client.services.get(function (err, services) {
        var proxyServices = _.where(services[0].items, function (service) {
          var name = _.get(service, 'metadata.name')
          return name === 'proxy-lookup' || name === 'proxy-registration'
        })
        if (err) return next(err)
        if (proxyServices.length === 2) {
          self.logger.info('proxy services are running')
          return next(null, true)
        }
        self.logger.info('proxy services are not running')
        next(null, false)
      })
    }],
    function (err, results) {
      if (err) {
        self.logger.error('in isRunning: {0}'.format(err))
        return cb(err)
      }
      self.logger.info('isRunning succeeded')
      return cb(null, _.every(results, Boolean))
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
      self.lookupIP = ips['lookup']
      self.registerIP = ips['registration']
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
    } if (!this.registerIP) {
      msg = 'registerIP not set -- cannot register route'
      self.logger.error(msg)
      return cb(new Error(msg))
    }
    var opts = {
      url: urljoin('http://' + this.registerIP, route),
      json: true,
      body: { 'target': target },
      headers: { 'Authorization': 'token {0}'.format(self.token) }
    }
    self.logger.debug('sending request to: {0}'.format(JSON.stringify(opts)))
    request.post(opts, function (err, response, body) {
      if (err) return cb(err)
      if (response.statusCode !== 200) {
        var msg = 'could not register proxy route -- bad status code'
        self.logger.error(msg)
        return cb(msg)
      }
      return cb(null)
    })
  })
}

ProxyClient.removeProxyRoute = function (route, cb) {
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
    } if (!this.registerIP) {
      msg = 'registerIP not set -- cannot register route'
      self.logger.error(msg)
      return cb(new Error(msg))
    }
    var opts = {
      url: urljoin('http://' + self.registerIP, route),
      method: 'DELETE',
      headers: { 'Authorization': 'token {0}'.format(self.token) }
    }
    self.logger.debug('sending request to {0}'.format(JSON.stringify(opts)))
    request(opts, function (err, response, body) {
      if (err) {
        self.logger.error('could not remove proxy route: {0}'.format(err))
        return cb(err)
      }
      if (response.statusCode !== 210) {
        msg = 'could not register proxy route -- bad status code'
        self.logger.error(msg)
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
  this.logger.info('getting proxy routes with age: {0}'.format(age))
  if (!this.registerIP) {
    var msg = 'cannot get all routes: this.registerIP is not set'
    this.logger.error(msg)
    return cb(new Error(msg))
  }
  var url = urljoin('http://' + this.registerIP) 
  if (age) {
    var now = new Date()
    var then = new Date(now - age * 60 * 1000)
    url = url + '?{0}'.format(then.toISOString())
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

module.exports = ProxyClient
