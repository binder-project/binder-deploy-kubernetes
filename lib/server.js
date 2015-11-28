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
var logger = require('./logging.js')
var proxyClient = require('./proxy.js')
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
  var app = express()
  var authHandler = function (req, res, next) {
    var credentials = req.headers['authorization']
    if (credentials && credentials === this.apiKey) {
      next()
    } else {
      res.status(403).end()
    }
  }

  var authRouter = express.Router()
  var openRouter = express.Router()
  app.use(bodyParser.json())

  // all requests handled by the authRouter are authorized
  authRouter.use(authHandler)
  authRouter.route('/applications/:template')
    .get(this.cluster.getAllApplications.bind(this.cluster))
  authRouter.route('/pools/')
    .get(this.pools.getAllPools.bind(this.pools))
  authRouter.route('/pools/:template')
    .post(this.pools.createPool.bind(this.pools))
    .delete(this.pools.deletePool.bind(this.pools))
  // all administrative commands go through the authRouter
  authRouter.route('/stop/')
    .post(this.stop)

  // all requests handled by the openRouter aren't authorized
  openRouter.route('/applications/:template')
    .post(this.cluster.createApplication.bind(this.cluster))
  openRouter.route('/applications/:template/:id')
    .post(this.cluster.getApplication.bind(this.cluster))
  openRouter.route('/pools/:template')
    .get(this.pools.getPool.bind(this.pools))

  app.route('/', authRouter)
  app.route('/', openRouter)

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
    this.stop()
  })
  proxy.start()
  return [proxy]
}

DeployServer.prototype.start = function () {
  if (!this.server) {
    // Launch background processes
    this.backgroundTasks = this._startBackgroundTasks()

    // Initialization must happen after background tasks are started
    this.cluster = new ClusterManager()
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
  }3
}

module.exports = DeployServer
