var _ = require('lodash')
var shell = require('shelljs')

var startWithPM2 = require('binder-utils').startWithPM2
var Module = require('./server.js')

/**
 * The argument-parsing and action components of a CLI command are separated so that the CLI
 * can both be imported from other modules and launched via PM2
 */
function Command (name, cli, action) {
  if (!(this instanceof Command)) {
    return new Command(name, cli, action)
  }
  this.name = name
  this.cli = cli
  this.action = action
}

/**
 * Add an action for this command to the main program
 *
 * @param {Program} program - main commander program
 */
Command.prototype.makeAction = function (program) {
  program.command(this.name)
  this.cli(program)
  program.action(this.action)
  return program
}

var commands = [
  Command('start', function (program) {
    program
      .description('Start the binder-deploy-kubernetes server')
      .option('-p, --port', 'the binder-deploy-kubernetes server port')
    return program
  }, function (options) {
    var module = new Module(options)
    module.start()
  }),
  Command('stop', function (program) {
    program.description('Stop the binder-deploy-kubernetes server')
    return program
  }, function (options) {
    console.log('Stopping the binder-deploy-kubernetes server...')
    shell.exec(['pm2', 'stop', 'binder-deploy-kubernetes'])
  })
  // TODO: add any module-specific commands here
]

var setupProgram = function (commands, program) {
  program.option('-a, --apiKey', 'Binder API key')
  program.options('-c, --config', 'Module configuration file')
  _.forEach(commands, function (cmd) {
    program.command(cmd.name)
    cmd.cli(program)
    program.action(cmd.action)
  })
}

var pm2CLI = function (program) {
  if (!program) {
    program = require('commander')
  }
  // Replace all actions with PM2 subprocess creation
  var pm2Commands = _.map(commands, function (cmd) {
    cmd.action = function (options) {
      startWithPM2({
        script: './lib/cli.js',
        args: process.argv
      })
    }
  })
  setupProgram(pm2Commands, program)
}

var standaloneCLI = function (program) {
  if (!program) {
    program = require('commander')
  }
  setupProgram(commands, program)
}

if (require.main === module) {
  var program = standaloneCLI()
  program.parse(process.argv)
} else {
  module.exports = {
    standaloneCLI: standaloneCLI,
    pm2CLI: pm2CLI
  }
}
