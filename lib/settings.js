var path = require('path')
var jsonfile = require('jsonfile')

var confPath = path.join(process.env['HOME'], '.binder/deploy.conf')
module.exports = jsonfile.readFileSync(confPath)
