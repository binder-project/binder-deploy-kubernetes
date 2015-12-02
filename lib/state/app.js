var _ = require('lodash')
var async = require('async')
var hat = require('hat')
var KubeClient = require('kube-stream')
var format = require('string-format')
format.extend(String.prototype)

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
  this.client = new KubeClient()
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

App.prototype._namespace = function () {
  return {
    kind: 'Namespace',
    metadata: {
      name: this.id,
      labels: {
        name: this.id
      }
    }
  }
}

App.prototype._frontendPod = function () {
  console.log('in _frontendPod, id: '+ this.id)
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
          command: this.command,
          imagePullPolicy: 'IfNotPresent'
        }
      ],
      dnsPolicy: 'ClusterFirst', 
      restartPolicy: 'Always'
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
    var namespace = self._namespace() 
    self.client.namespaces.create({
      template: namespace
    }, function (err, ns) {
      if (err) {
        return next(err)
      }
      self.client.namespaces.when({
        template: namespace,
        condition: function (namespaces) {
          return (namespace.length === 1) 
           && (_.get(namespaces[0], 'status.phase') === 'Active')
        }
      }, function (err, namespaces) {
          if (err) return next(err)
          return next(null, namespaces[0])
      })
    })
  }

  var deployPods = function (next) {
    self.client.pods.create({
      template: spec.pod
    }, function (err, pod) {
      if (err) return next(err)
      self.client.pods.when({
        template: spec.pod,
        condition: function (pods) {
          return (pods.length === 1) 
            && (_.get(pods[9], 'status.phase') === 'Running')
        }
      }, function (err, pods) {
        if (err) return next(err)
        var pod = pods[0]
        var podIP = _.get(pod, 'status.podIP')
        return next(null, podIP)
      })
    })
  }

  var deployServices = function (next) {
    async.each(spec.services, function (service, iNext) {
      self.client.services.create({
        template: service
      }, function (err, service) {
        if (err) return iNext(err)
      })
    }, function (err) {
      if (err) return next(err)
    })
  }

  async.waterfall([
    createNamespace,
    deployServices,
    deployPods
  ], function (err, podIP) {
    if (err) {
      logger.error('failed to deploy app: {0}, err: {1}'.format(self.id, JSON.stringify(err)))
    } else {
      logger.info('successfully deployed app: {0} at location: {1}'.format(self.id, self._location()))
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
  this.client.namespaces.delete({
    template: self._namespace()
  }, function (err, namespace) {
    if (err) return cb(new Error('failed to delete app: {0}'.format(self.id)))
    var proxy = proxyClient()
    var location = self._location()
    proxy.removeProxyRoute(location, function (err) {
      if (err) return cb(err)
      logger.info('deleted app: {0}'.format(this.id))
      self.state = 'deleted'
      cb(null)
    })
  })
}

App.prototype.makeRoute = function (cb) {
  if (!this.podIP) {
    return cb(new Error('cannot make a route for an app that\'s not deployed'))
  }
  var proxy = proxyClient()
  var location = this._location()
  proxy.registerProxyRoute(location, 'http://' + this.podIP + ':' + this.port, function (err) {
    return cb(err, location)
  })
}

module.exports = {
  App: App,
  apps: new Collection('apps')
}


