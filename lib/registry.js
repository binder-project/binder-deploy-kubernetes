
var request = require('request')

var settings = require('../config/main.js')

/**
 * Client for fetching templates from a Binder registry
 * @constructor
 */
function RegistryClient(opts) {
  this.opts = opts
  this.host = opts.host || settings.registry.host
  this.port = opts.port || settings.registry.port
}

RegistryClient.prototype.getTemplate = function (name) {
  
}
