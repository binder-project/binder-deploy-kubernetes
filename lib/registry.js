var fs = require('fs') 
var path = require('path')

var urljoin = require('url-join')
var request = require('request')

var settings = require('../config/main.js')

/**
 * Client for fetching templates from a Binder registry
 * @constructor
 */
function RegistryClient (opts) {
  this.opts = opts || {}
  this.host = this.opts.host || settings.registry.host
  this.port = this.opts.port || settings.registry.port

  // used in testing
  this.templateDir = null || this.opts.templateDir
  if (settings.test.testing && !this.templateDir) {
    this.templateDir = settings.test.templateDir
  }
}

/**
 * Fetch a template from a Binder registry.
 * @param {string} name - template name
 * @param {function} cb - callback(err, template)
 */
RegistryClient.prototype.fetchTemplate = function (name, cb) {
  if (this.templateDir) {
    // in test mode, read templates from disk
    fs.readFile(path.join(this.templateDir, name +'.json'), function (err, data) {
      if (err) return cb(err)
      return cb(null, JSON.parse(data))
    })
  } else {
    var url = urljoin(this.host + ':' + this.port, 'templates', name)
    var options = {
      
    }
    request(url, function (err, response, body) {
      if (err) return cb(err)
      cb(null, body)
    })
  }
}

module.exports = RegistryClient
