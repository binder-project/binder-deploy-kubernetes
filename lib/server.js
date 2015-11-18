var http = require('http')

var _ = require('lodash')
var express = require('express')
var forever = require('forever-monitor')
var format = require('string-format')
format.extend(String.prototype)

var settings = require('../config/main.js')
var PoolManager = require('./pools.js')
var ClusterManager = require('./cluster.js')
var logger = require('./logging.js')

/**
 * An HTTP server that provides the binder-deploy API and launches
 * instances of Binder templates on Kubernetes
 * @constructor
 */
var DeployServer = function (options) {
  options = options || {}

  this.apiKey = options.apiKey || hat()
  console.log('apiKey: {0}'.format(this.apiKey))
  this.port = options.port || settings.port

  return this
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
  var port = settings.kubeProxy.port
  var proxyCmd = ['kubectl.sh', 'proxy', '--port={0}'.format(port)]
  var proxy = new (forever.Monitor)(proxyCmd, {
    max: 3
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
  if (this.server) {

    // Launch background processes
    this.backgroundTasks = this._startBackgroundTasks()

    // Initialization must happen after background tasks are started
    this.cluster = new ClusterManager()
    this.pools = new PoolManager()
    this.server = this._createServer()

    console.log('Starting Kubernetes deploy server on port {0} ...'.format(this.port))
    this.server.listen(this.port)
    return this.apiKey
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

var start = function (opts) {
  var deployServer = new DeployServer(opts)
}
