var util = require('util')

var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var mongoose = require('mongoose')
var format = require('string-format')
format.extend(String.prototype)

var kubeClient = require('../client')
var proxyClient = require('../proxy').getInstance
var Model = require('../models').Model

function App (template) {
  // app information relevant to the spec
  Model.call(this, template)
  this.templateName = template.templateName || template['template-name']
  this.port = template.port || 8888

  if (template.command && template.command.length !== 0) {
    this.command = template.command
  } else {
    this.command = this._defaultCommand()
  }

  if (template['image-source'] && !template['image-source'].endsWith(':latest')) {
    this.imageSource = template['image-source'] + ':latest'
  } else {
    this.imageSource = template['image-source']
  }

  this.limits = template.limits
  this.services = template.services
  this.imageName = template['image-name']
  // the default inactivity period is 60 minutes
  this.cullTimeout = template['cull-timeout'] || 1000 * 60 * 60
  this.inactiveTime = template['inactive-time'] || 0

  // app information relevant to deployment
  this.deployTime = template['deploy-time']
  this.state = template.state || 'pending'
  // location is set once the app is deployed
  this.location = template.location
  // optionally assign the app to a specific node
  this.node = template.node
  this.pullPolicy = 'Always'

  // Kubernetes client
  this.client = kubeClient()

}
util.inherits(App, Model)
_.assignIn(App, Model)

App.schema = {
  id: { type: String, unique: true },
  port: Number,
  command: [String],
  'template-name': String,
  limits: mongoose.Schema.Types.Mixed,
  services: mongoose.Schema.Types.Mixed,
  'image-name': String,
  'image-source': String,
  'cull-timeout': Number,
  'inactive-time': Number,
  'deploy-time': Date,
  state: String,
  location: String
}

App.prototype._serialize = function () {
  return {
    id: this.id,
    port: this.port,
    command: this.command,
    'template-name': this.templateName,
    limits: this.limits,
    services: this.services,
    'image-name': this.imageName,
    'image-source': this.imageSource + ':latest',
    'deploy-time': this.deployTime,
    'cull-timeout': this.cullTimeout,
    'inactive-time': this.inactiveTime,
    state: this.state,
    location: this.location
  }
}

App.prototype.logInfo = function (msg) {
  this.logger.info(msg, { id: this.id })
}

App.prototype.logError = function (msg) {
  this.logger.error(msg, { id: this.id })
}

App.prototype._defaultCommand = function () {
  return [
    '/home/main/start-notebook.sh',
    '--ip=\'*\'',
    '--port={0}'.format(this.port),
    '--NotebookApp.base_url=\'{0}\''.format(this._location()),
    '--debug'
  ]
}

App.prototype._location = function () {
  return '/user/{0}'.format(this.id)
}

App.prototype._namespace = function () {
  return {
    kind: 'Namespace',
    metadata: {
      name: this.id,
      labels: {
        name: this.id,
        binder: 'true'
      }
    }
  }
}

App.prototype._frontendPod = function () {
  var pod = {
    kind: 'Pod',
    metadata: {
      name: 'frontend-server',
      labels: {
        name: 'frontend-server',
        id: this.id,
        templateName: this.imageName
      },
      namespace: this.id
    },
    spec: {
      containers: [
        {
          name: 'frontend-server',
          image: this.imageSource,
          ports: [{ 
            containerPort: this.port,
            protocol: 'TCP'
          }],           
          command: this.command,
          imagePullPolicy: this.pullPolicy
        }
      ],
      dnsPolicy: 'ClusterFirst',
      restartPolicy: 'Always'
    }
  }
  if (this.node) {
    pod.spec.nodeName = this.node  
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

App.prototype._create = function (cb) {
  this.logInfo('starting to deploy')
  var self = this
  this.state = 'deploying'
  var spec = this.spec()

  // immediately call the callback on creation (state updates will happen in the 'background')
  cb()

  var createNamespace = function (next) {
    var namespace = self._namespace()
    self.logInfo('creating namespace: {0}'.format(namespace.metadata.name))
    self.client.namespaces.changeState({
      state: namespace,
      delta: { status: { phase: 'Active' } },
      action: self.client.namespaces.create
    }, function (err, namespace) {
      if (err) return next(err)
      self.logInfo('created namespace')
      next(null)
    })
  }

  var deployPod = function (next) {
    if (!spec.pod) {
      return next(null, null)
    }
    self.logInfo('deploying frontend pod')
    self.logInfo('spec.pod: ' + JSON.stringify(spec.pod))
    self.client.pods.changeState({
      state: spec.pod,
      times: 300,
      interval: 1000,
      condition: function (pods) {
        var readyPods = _.filter(pods, function (pod) {
          var status = { type: 'Ready', status: 'True' }
          var ready = _.filter(pod.status.conditions, status)
          return ready.length !== 0 && pod.status.podIP
        })
        if (readyPods.length !== 0) return readyPods
      },
      action: self.client.pods.create
    }, function (err, pods) {
      self.logInfo('err: {0}, pod: {1}'.format(err, JSON.stringify(pod)))
      if (err) return next(err)
      var pod = pods[0]
      var podIP = _.get(pod, 'status.podIP')
      self.podIP = podIP
      return next(null)
    })
  }

  var deployServices = function (next) {
    if (!spec.services) {
      return next(null)
    }
    async.each(spec.services, function (service, iNext) {
      // Do not wait for any particular state transition
      self.client.services.changeState({
        state: service,
        delta: {},
        action: self.client.services.create
      }, function (err, service) {
        if (err) return iNext(err)
      }),
      function (err) {
        return next(err)
      }
    })
  }


  async.series([
    createNamespace,
    deployServices,
    deployPod,
    self.makeRoute.bind(self)
  ], function (err) {
    if (err) {
      self.logError('failed to deploy app: {0}, err: {1}'.format(self.id, JSON.stringify(err)))
      self.state = 'failed'
      self._save(function (err) {
        if (err) {
          self.logError('could not save app state after launch failed: {0}'.format(err))
        }
      })
    } else {
      self.logInfo('successfully deployed app: {0} at location: {1}'.format(self.id, self._location()))
      self.state = 'deployed'
      var proxy = proxyClient()
      self.location = proxy.lookupIP + self._location()
      self.deployTime = new Date()
      self._save(function (err) {
        if (err) {
          self.logError('could not save app state after launch succeeded: {0}'.format(err))
        }
      })
    }
  })
}

App.prototype._update = function (cb) {
  var self = this
  this.logInfo('updating')
  this.state = 'pending'
  var app = this
  async.series([
    app.delete,
    app.create
  ], function (err) {
    if (err) {
      self.logError('failed to update app: {0}'.format(this.id))
    } else {
      self.logInfo('updated app: {0}'.format(this.id))
    }
  })
}

App.prototype._delete = function (cb) {
  this.logInfo('deleting app')
  var self = this
  this.state = 'pending'
  this.client.namespaces.changeState({
    state: self._namespace(),
    condition: function (namespaces) {
      return !_.some(_.filter(namespaces, function (ns) {
        return _.get(ns, 'metadata.name') === self.id
      }))
    },
    action: self.client.namespaces.delete
  }, function (err, namespaces) {
    if (err) return cb(err)
    var proxy = proxyClient()
    var location = self._location()
    self.logInfo('deleted app: {0}'.format(this.id))
    self.state = 'deleted'
    self._save(function (err) {
      if (err) {
        self.logError('could not save app state after launch failed: {0}'.format(err))
      }
      self.logInfo('removing proxy route for location {0}'.format(location))
      // removing the proxy route is not as critical as removing the namespace
      proxy.removeProxyRoute(location, function (err) {
        if (err) {
          self.logError('in delete: {0}'.format(err))
        }
        return cb(err)
      })
    })
  })
}

App.prototype.makeRoute = function (cb) {
  if (!this.podIP) {
    this.logError('cannot make route -- no podIP')
    return cb(new Error('cannot make a route for an app that\'s not deployed'))
  }
  var proxy = proxyClient()
  var location = this._location()
  var target = 'http://' + this.podIP + ':' + this.port
  this.logInfo('registering proxy route {0} -> {1}'.format(location, target))
  proxy.registerProxyRoute(location, target, function (err) {
    return cb(err, location)
  })
}

module.exports = App


