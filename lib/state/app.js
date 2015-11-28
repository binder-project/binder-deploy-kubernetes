var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var format = require('string-format')
format.extend(String.prototype)

var kubeClient = require('../client.js')
var settings = require('../../config/main.js')
var logger = require('../logging.js')
var proxyClient = require('../proxy.js')
var Collection = require('../models.js').Collection

function App (template) {
  // app information relevant to the spec
  this.name = template.name
  this.id = this._generateId()
  this.port = template.port || 8888
  this.command = template.command || this._defaultCommand()
  this.limits = template.limits
  this.services = template.services
  this.imageName = template['image-name']
  this.imageSource = template['image-source']
  this.cullTimeout = template['cull-timeout']

  // app information relevant to deployment
  this.deployTime = null
  this.state = 'pending'

  // Kubernetes client
  this.client = kubeClient()
}

App.prototype._defaultCommand = function () {
  return [
    '/home/main/start-notebook.sh',
    '--ip=\'*\'',
    '--port={0}'.format(this.port),
    '--NotebookApp.base_url=\'/{0}'.format(this._location()),
    '--debug'
  ]
}

App.prototype._generateId = function () {
  return hat()
}

App.prototype._location = function () {
  return '/user/{0}'.format(this.id)
}

App.prototype._frontendPod = function () {
  var pod = {
    kind: 'Pod',
    apiVersion: settings.kube.apiVersion,
    metadata: {
      name: 'frontend-server',
      labels: {
        name: 'frontend-server',
        id: this.id
      },
      namespace: this.id
    },
    spec: {
      containers: [
        {
          name: 'frontend-server',
          image: this.imageSource,
          ports: [{ 'containerPort': this.port }],           
          command: this.command
        }
      ]
    }
  }
  if (this.limits) {
    pod.spec.containers[0].resources = {
      limits: this.limits
    }
  }
  return pod
}

App.prototype.spec = function () {
  /* {
   *  pod: (frontend-pod),
   *  services: [],
   *  replicationControllers: []
   * }
   */
  // TODO handle services/replicationControllers
  return {
    pod: this._frontendPod()
  }
}

App.prototype.create = function (cb) {
  var self = this
  this.state = 'deploying'
  var spec = this.spec()

  var createNamespace = function (next) {
    var namespace = {
      kind: 'Namespace',
      apiVersion: settings.kube.apiVersion,
      metadata: {
        name: this.id,
        labels: {
          name: this.id
        }
      }
    }
    self.client.namespaces.create(namespace, function (err) {
      if (err) {
        logger.error('could not create namespace: {0}'.format(err))
        return next(err)
      }
      return next(null)
    })
  }

  var deployPods = function (next) {
    self.client.pods.create(spec.pod, function (err) {
      if (err) {
        next(err)
      } else {
        async.retry({times: 30, interval: 1}, function (iNext) {
          // TODO: getting all pods until query string is better documented
          self.client.pods.get(function (err, pods) {
            if (err) {
              return next(err)
            }
            if (pods) {
              var frontendPod = _.find(pods[0].items, function (pod) {
                var isFrontend = _.find(pod.metadata.labels, function (label) {
                  label === 'frontend-pod'
                })
                var isApp = (pod.metadata.name === self.id)
                return isApp && isFrontend
              })
              var phase = frontendPod.status.phase
              var podIP = frontendPod.status.podIP
              if (phase === 'Running') {
                iNext(null, podIP)
              }
            }
          })
        }, function (err, podIP) {
          if (err) {
            logger.error('could not get node IP of pod: {0}'.format(err))
            return next(err)
          }
          return next(null, podIP)
        })
      }
    })
  }

  var deployServices = function (next) {
    async.each(spec.services, function (service, innerNext) {
      self.client.services.create(service, function (err) {
        innerNext(err)
      })
    }, function (err) {
      if (err) {
        logger.error('could not deploy service: {0}'.format(err))
        return next(err)
      }
      next(err)
    })
  }

  var deployReplicationControllers = function (next) {
    async.each(spec.replicationControllers, function (rc, innerNext) {
      self.client.replicationControllers.create(rc, function (err) {
        innerNext(err)
      })
    }, function (err) {
      if (err) {
        logger.error('could not deploy replicationController: {0}'.format(err))
        return next(err)
      }
      next(err)
    })
  }

  async.waterfall([
    createNamespace,
    deployServices,
    deployReplicationControllers,
    deployPods
  ], function (err, podIP) {
    if (err) {
      logger.error('failed to deploy app: {0}'.format(this.id))
    } else {
      logger.info('successfully deployed app: {0} at location: {1}'.format(this.id, this._location()))
      self.state = 'deployed'
      self.podIP = podIP
      self.deployTime = (new Date()).toJSON()
    }
  })
}

App.prototype.update = function (cb) {
  this.state = 'pending'
  var app = this
  async.series([
    app.delete,
    app.create
  ], function (err) {
    if (err) {
      logger.error('failed to update app: {0}'.format(this.id))
    } else {
      logger.info('updated app: {0}'.format(this.id))
    }
  })
}

App.prototype.delete = function (cb) {
  var self = this
  this.state = 'pending'
  this.client.namespaces.delete(this.id, function (err) {
    if (err) {
      logger.error('failed to delete app: {0}'.format(this.id))
    } else {
      var proxy = proxyClient()
      var location = this._location()
      proxy.removeProxyRoute(location, function (err) {
        if (err) return cb(err)
        logger.info('deleted app: {0}'.format(this.id))
        self.state = 'deleted'
        cb(null)
      })
    }
  })
  // TODO other cleanup steps here
}

App.prototype.makeRoute = function (cb) {
  if (!this.podIP) {
    return cb(new Error('cannot make a route for an app that\'s not deployed'))
  }
  var proxy = proxyClient()
  var location = this._location()
  proxy.registerProxyRoute(location, 'http://' + this.podIP + ':' + this.port, function (err) {
    cb(err, location)
  })
}

module.exports = {
  App: App,
  apps: new Collection('apps')
}


