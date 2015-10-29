
var settings = require('../config/main.js')
var Collection = require('./models.js').Collection

function PoolManager(opts) {
  this.opts = opts
  this.cluster = opts.cluster

  this.pools = new Pools()
}

PoolManager.prototype.getAllPools = function (req, res) {

}

PoolManager.prototype.createPool = function (req, res) {

}

PoolManager.prototype.deletePool = function (req, res) {

}

PoolManager.prototype.getPool = function (req, res) {

}

module.exports = PoolManager
