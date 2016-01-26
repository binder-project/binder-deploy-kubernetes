var program = require('commander')
var cli = require('./lib/cli.js')

program
  .version('0.0.1')

cli.pm2CLI(program)
program.parse(process.argv)


