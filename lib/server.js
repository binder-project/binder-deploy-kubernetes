var path = require('path')

var _ = require('lodash')
var async = require('async')
var inherits = require('inherits')
var shell = require('shelljs')

var BinderModule = require('binder-module')
var ClusterManager = require('./cluster.js')
var proxyClient = require('./proxy.js').getInstance
var kubeClient = require('./client.js')
var startWithPM2 = require('binder-utils').startWithPM2
var getDatabase = require('binder-db').getDatabase
var settings = require('./settings.js')

/*
 * An HTTP server that implements the API of a Binder component
 * @constructor
 */
function BinderDeployKubernetes (opts) {
  if (!(this instanceof BinderDeployKubernetes)) {
    return new BinderDeployKubernetes(opts)
  }
  BinderDeployKubernetes.super_.call(this, 'binder-deploy-kubernetes', 'deploy', settings, opts)
  this.kubePort = this.opts.kube.proxyPort
}

inherits(BinderDeployKubernetes, BinderModule)

/**
 * Declare which functions implement the binder-deploy API
 */
BinderDeployKubernetes.prototype._makeBinderAPI = function () {
  return {
    deploy: this.cluster.createApplication.bind(this.cluster),
    statusOne: this.cluster.getApplication.bind(this.cluster),
    statusAll: this.cluster.getAllApplications.bind(this.cluster)
  }
  // TODO pooling is disabled for now
  /*
  app.route('/pools/')
    .get(authHandler, this.pools.getAllPools.bind(this.pools))
  app.route('/pools/:template?')
    .get(this.pools.getPool.bind(this.pools))
    .post(authHandler, this.pools.createPool.bind(this.pools))
    .delete(authHandler, this.pools.deletePool.bind(this.pools))
  */
}

BinderDeployKubernetes.prototype._makeOtherRoutes = function (app, authHandler) {
  // all administrative commands go through the authRouter
  app.route('/stop/')
    .post(authHandler, this.stop)
  app.route('/preload/:template')
    .post(authHandler, this.cluster.preload.bind(this.cluster))
}

/**
 * Performs all module-specific startup behavior
 */
BinderDeployKubernetes.prototype._start = function (cb) {
  var self = this
  var port = this.kubePort
  this.backgroundTasks = [
    {
      name: 'binder-kubernetes-proxy',
      script: shell.which('kubectl.sh'),
      args: ['proxy', '--port={0}'.format(port)],
      exec_interpreter: 'none',
      silent: true
    },
    {
      name: 'binder-kubernetes-daemon',
      script: path.join(__dirname, '../scripts/daemon.js'),
      silent: true
    }
  ]
  _.forEach(this.backgroundTasks, function (task) {
    self.logger.info('starting background task: {0}'.format(task.name))
    startWithPM2(task)
  })

  var initialize = function (err, conn) {
    if (err) return cb(err)
    self.db = conn
    // Initialization must happen after background tasks are started
    self.cluster = new ClusterManager(self.db, self.opts)
    // self.pools = new PoolManager(self.opts)

    // Initialize the singleton proxy client here (any special options here)
    proxyClient(self.opts)
    // Initialize the singleton Kubernetes client here
    kubeClient(self.opts)
    return cb()
  }

  if (this.opts.db) {
    getDatabase(this.opts.db, initialize)
  } else {
    getDatabase(initialize)
  }
}

/**
 * Performs all module-specific stopping behavior
 */
BinderDeployKubernetes.prototype._stop = function (cb) {
  var self = this
  if (this.db) {
    this.db.disconnect()
  }
  if (this.backgroundTasks) {
    async.each(this.backgroundTasks, function (task, next) {
      var name = task.name
      self.logger.info('stopping background task: {0}'.format(name))
      shell.exec(['pm2', name])
      next()
    }, function (err) {
      return cb(err)
    })
  } else {
    return cb()
  }
}

module.exports = BinderDeployKubernetes
