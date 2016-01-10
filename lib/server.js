var http = require('http')

var _ = require('lodash')
var hat = require('hat')
var express = require('express')
var forever = require('forever-monitor')
var bodyParser = require('body-parser')
var format = require('string-format')
format.extend(String.prototype)

var settings = require('../config/main.js')
var PoolManager = require('./pool.js')
var ClusterManager = require('./cluster.js')
var logger = require('./logging.js')()
var proxyClient = require('./proxy.js').getInstance
var kubeClient = require('./client.js')

/**
 * An HTTP server that provides the binder-deploy API and launches
 * instances of Binder templates on Kubernetes
 * @constructor
 */
var DeployServer = function (options) {
  options = options || {}
  this.options = options

  this.apiKey = options.apiKey || process.env.BINDER_API_KEY || hat()
  this.port = options.port || process.env.BINDER_DEPLOY_PORT || settings.port
  this.kubePort = options.kubePort || process.env.BINDER_KUBE_PORT || settings.kube.proxyPort
}

DeployServer.prototype._createServer = function () {
  var self = this
  var app = express()

  var authHandler = function (req, res, next) {
    var credentials = req.headers['authorization']
    if (credentials && credentials === self.apiKey) {
      next()
    } else {
      res.status(403).end()
    }
  }

  app.use(bodyParser.json())

  app.route('/applications/:template/:id')
    .get(this.cluster.getApplication.bind(this.cluster))
  app.route('/applications/:template?')
    .get(authHandler, this.cluster.getAllApplications.bind(this.cluster))
    .post(this.cluster.createApplication.bind(this.cluster))
  app.route('/pools/')
    .get(authHandler, this.pools.getAllPools.bind(this.pools))
  app.route('/pools/:template?')
    .get(this.pools.getPool.bind(this.pools))
    .post(authHandler, this.pools.createPool.bind(this.pools))
    .delete(authHandler, this.pools.deletePool.bind(this.pools))
  // all administrative commands go through the authRouter
  app.route('/stop/')
    .post(authHandler, this.stop)

  return http.createServer(app)
}

DeployServer.prototype._startBackgroundTasks = function () {
  var port = this.kubePort
  var proxyCmd = ['kubectl.sh', 'proxy', '--port={0}'.format(port)]
  var proxy = new (forever.Monitor)(proxyCmd, {
    max: 3,
    silent: true
  })
  proxy.on('exit', function () {
    logger.error('Kubernetes proxy exited.')
  })
  proxy.start()
  return [proxy]
}

DeployServer.prototype.start = function () {
  if (!this.server) {
    this.backgroundTasks = this._startBackgroundTasks()

    // Initialization must happen after background tasks are started
    this.cluster = new ClusterManager({
      pool: settings.pool.enabled
    })
    this.pools = new PoolManager()
    this.server = this._createServer()

    // Initialize the singleton proxy client here (any special options here)
    var proxy = proxyClient()
    // Initialize the singleton Kubernetes client here
    var kube = kubeClient()

    console.log('Starting Kubernetes deploy server on port {0} ...'.format(this.port))
    this.server.listen(this.port)
    return this.apiKey
  } else {
    logger.error('DeployServer has already been started')
  }
}

DeployServer.prototype.stop = function () {
  console.log('Stopping Kubernetes deploy server...')
  if (this.server) {
    this.server.close()
    _.forEach(this.backgroundTasks, function (task) {
      task.stop()
    })
  }
}

module.exports = DeployServer
