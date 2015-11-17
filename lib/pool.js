var settings = require('../config/main.js')
var logger = require('./logging.js')
var Pool = require('./state/pool.js').Pool

function PoolManager(opts) {
  this.opts = opts
  this.cluster = opts.cluster
  this.pools = require('./state/pool.js').pools
}

PoolManager.prototype.getAllPools = function (req, res) {
  this.pools.find(null, function (err, pools) {
    if (err) {
      return res.status(500).send(err)
    }
    res.json(pools)
  }) 
}

PoolManager.prototype.createPool = function (req, res) {
  var template = req.params.template
  var size = req.body.size
  if (!size || !template) {
    return res.status(500).send('did not specify template or size')
  }
  var existingPool = this.pools.findOne({ templateName: template })
  if (existingPool) {
    var existingSize = existingPool.size
    if (existingSize !== size) {
      existingPool.resize(size, function (err) {
        if (err) {
          res.status(500).send(err)
        }
        res.status(200).end()
      })
    }
  } else {
    var pool = new Pool({
      templateName: template,
      size: size
    })
    this.pools.insert(pool, function (err) {
      if (err) {
        return res.status(500).send(err)
      }
      res.status(200).end()
    })
  }
}

PoolManager.prototype.deletePool = function (req, res) {
  var template = req.params.template
  if (!template) {
    return res.status(500).send('did not specify template')
  }
  this.pools.remove({ templateName: template }, function (err) {
    if (err) {
      return res.status(500).send(err)
    }
    res.status(200)
  })
}

PoolManager.prototype.getPool = function (req, res) {

}

module.exports = PoolManager
