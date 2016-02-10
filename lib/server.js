var BinderModule = require('binder-module')
var inherits = require('inherits')
var shell = require('shelljs')

var PoolManager = require('./pool.js')
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
  BinderDeployKubernetes.super_.call(this, settings, opts)
  console.log('this.opts: ' + JSON.stringify(this.opts))
  this.kubePort = this.opts.kube.proxyPort
}

inherits(BinderDeployKubernetes, BinderModule)

/**
 * Attached module's routes/handlers to the main app object
 */
BinderDeployKubernetes.prototype._makeRoutes = function (app, authHandler) {
  app.route('/applications/:template/:id')
    .get(this.cluster.getApplication.bind(this.cluster))
  app.route('/applications/:template?')
    .get(authHandler, this.cluster.getAllApplications.bind(this.cluster))
    .post(this.cluster.createApplication.bind(this.cluster))
  // TODO pooling is disabled for now
  /*
  app.route('/pools/')
    .get(authHandler, this.pools.getAllPools.bind(this.pools))
  app.route('/pools/:template?')
    .get(this.pools.getPool.bind(this.pools))
    .post(authHandler, this.pools.createPool.bind(this.pools))
    .delete(authHandler, this.pools.deletePool.bind(this.pools))
  */
  // all administrative commands go through the authRouter
  app.route('/stop/')
    .post(authHandler, this.stop)
}

/**
 * Performs all module-specific startup behavior
 */
BinderDeployKubernetes.prototype._start = function (cb) {
  var self = this
  var port = this.kubePort
  var app = {
    name: 'binder-kubernetes-proxy',
    script: shell.which('kubectl.sh'),
    args: ['proxy', '--port={0}'.format(port)],
    exec_interpreter: 'none',
    silent: true
  }
  startWithPM2(app)

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
  if (this.db) {
    this.db.disconnect()
  }
  shell.exec(['pm2', 'delete', 'binder-kubernetes-proxy'])
  return cb()
}

module.exports = BinderDeployKubernetes
