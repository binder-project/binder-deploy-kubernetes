
var urljoin = require('url-join')
var request = require('request')

var settings = require('../config/main.js')

/**
 * Client for fetching templates from a Binder registry
 * @constructor
 */
function RegistryClient (opts) {
  this.opts = opts
  this.host = opts.host || settings.registry.host
  this.port = opts.port || settings.registry.port
}

/**
 * Fetch a template from a Binder registry.
 * @param {string} name - template name
 * @param {function} cb - callback(err, template)
 */
RegistryClient.prototype.fetchTemplate = function (name, cb) {
  var url = urljoin(this.host + ':' + this.port, 'templates', name)
  request(url, function (err, response, body) {
    if (err) return cb(err)
    cb(null, body)
  })
}

module.exports = RegistryClient
