var fs = require('fs')
var path = require('path')

var urljoin = require('url-join')
var request = require('request')

/**
 * Client for fetching templates from a Binder registry
 * @constructor
 */
function RegistryClient (opts) {
  this.opts = opts || {}
  this.host = this.opts.registry.host
  this.port = this.opts.registry.port

  // used in testing
  this.templateDir = this.opts.test.templateDir
}

/**
 * Fetch a template from a Binder registry.
 * @param {string} name - template name
 * @param {function} cb - callback(err, template)
 */
RegistryClient.prototype.fetchTemplate = function (name, cb) {
  if (this.opts.test.testing && this.templateDir) {
    // in test mode, read templates from disk
    fs.readFile(path.join(this.templateDir, name + '.json'), function (err, data) {
      if (err) return cb(err)
      return cb(null, JSON.parse(data))
    })
  } else {
    var url = urljoin(this.host + ':' + this.port, 'templates', name)
    var options = {
      url: url,
      json: true
    }
    request(options, function (err, response, body) {
      if (err) return cb(err)
      cb(null, body)
    })
  }
}

module.exports = RegistryClient
