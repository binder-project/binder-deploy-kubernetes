var program = require('commander')
var cli = require('./lib/cli.js')

program
  .version('0.0.1')

cli.standaloneCLI(program)
if (process.argv.length === 2) program.help()
program.parse(process.argv)


