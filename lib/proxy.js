
var async = require('async')
var hat = require('hat')
var format = require('string-format')
format.extend(String.prototype)

var logger = require('./logging.js')
var kubeClient = require('./client.js')

function ProxyClient (opts) {
  this.opts = opts
  this.token = opts.token || hat()
  this.client = kubeClient()
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

ProxyClient.prototype.isRunning = function (cb) {
}

ProxyClient.prototype.launchClusterProxy = function (cb) {
  this.isRunning(function (err, running) {
    if (err) return cb(err)
    if (running) {
      logger.warning('cluster proxy already running')
      return cb(null)
    }
    var components = [
      this._startReplicationController,
      this._startRegistrationService,
      this._startLookupService
    ]
    async.parallel(components, function (err) {
      cb(err)
    })
  })
}

ProxyClient.prototype.stopClusterProxy = function (cb) {
  cb(new Error('stopClusterProxy not implemented'))
}

ProxyClient.prototype.registerProxyRoute = function (route, cb) {

}

ProxyClient.removeProxyRoute = function (route, cb) {

}

module.exports = ProxyClient
