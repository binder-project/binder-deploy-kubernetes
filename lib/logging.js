var _ = require('lodash')
var winston = require('winston')

var settings = require('../config/main.js')

var productionOpts = function() {
  return { level: 'verbose',
    transports: [
      new (winston.transports.Console)(),
      new (winston.transports.File)({
        filename: settings.logging.file,
        handleExceptions: true,
        humanReadableUnhandledException: true
      })
    ]
  }
}

var testingOpts =  function () {
 return { level: 'debug',
    transports: [
      new (winston.transports.Console)(),
      new (winston.transports.File)({
        filename: settings.logging.testFile,
        handleExceptions: true,
        humanReadableUnhandledException: true
      })
    ]
  }
}

function getDefault() {
  if (settings.test.testing) {
    return new winston.Logger(testingOpts())
  } else {
    return new winston.Logger(productionOpts())
  }
}

module.exports = getDefault
