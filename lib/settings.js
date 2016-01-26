var path = require('path')
var fs = require('fs')

// Binder module settings must be stored in conf/main.json
var fullSettings = JSON.parse(fs.readFileSync(path.join(__dirname, '../conf/main.json')))
var packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')))
fullSettings.name = packageJson.name

module.exports = fullSettings
