var winston = require('winston')

var settings = require('../config/main.js')

var logger = new (winston.Logger)({
  transports: [
    // TODO disable the console logger in production
    new (winston.transports.Console)(),
    new (winston.transports.File)({
      filename: settings.logging.file,
      handleExceptions: true,
      humanReadableUnhandledException: true
    })
  ]
})

module.exports = logger
