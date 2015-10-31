var async = require('async')
var hat = require('hat')
var format = require('string-format')
format.extend(String.prototype)

var client = require('../client.js')
var proxy = require('../proxy.js')
var settings = require('../../config/main.js')
var logger = require('../logging.js')

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
}

App.prototype._defaultCommand = function () {
  return [
    '/home/main/start-notebook.sh',
    '--ip=\'*\'',
    '--port={0}'.format(this.ports),
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
      }
    },
    spec: {
      containers: [
        {
          name: 'frontend-server',
          image: this.imageName,
          ports: this.ports.map(function (port) { 
            return { 'containerPort': port }
          }),
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
  this.state = 'deploying'
  var spec = this.spec()

  var app = this
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
    client.namespaces.create(namespace, function (err) {
      if (err) {
        logger.error('could not create namespace: {0}'.format(err))
        return next(err)
      }
      return next(null)
    })
  }

  var deployPods = function (next) {
    client.pods.create(spec.pod, function (err) {
      if (err) {
        next(err)
      } else {
        async.retry({times: 30, interval: 1}, function (iNext) {
          client.pods.get({
            labelSelector: app.id
          }, function (err, pods) {
            if (err) {
              return next(err)
            }
            if (pods) {
              var frontendPod = pods[0]
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
      client.services.create(service, function (err) {
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
      client.replicationControllers.create(rc, function (err) {
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

  var registerProxyRoute = function (next, podIP) {
    proxy.register(this.location, 'http://' + podIP + ':' + this.port)
  }

  async.waterfall([
    createNamespace,
    deployServices,
    deployReplicationControllers,
    deployPods,
    registerProxyRoute
  ], function (err) {
    if (err) {
      logger.error('failed to deploy app: {0}'.format(this.id))
    } else {
      logger.info('successfully deployed app: {0} at location: {1}'.format(this.id, this._location()))
      this.state = 'deployed'
      this.deployTime = (new Date()).toJSON()
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
  this.state = 'pending'
  client.namespaces.delete(this.id, function (err) {
    if (err) {
      logger.error('failed to delete app: {0}'.format(this.id))
    } else {
      logger.info('deleted app: {0}'.format(this.id))
      this.state = 'deleted'
    }
  })
  // TODO other cleanup steps here
}

module.exports = App


