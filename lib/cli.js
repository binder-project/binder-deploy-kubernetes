var _ = require('lodash')
var fs = require('fs')
var shell = require('shelljs')
var path = require('path')

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

var makeCommands = function () {
  var commands = [
    Command('start', function (program) {
      return program
        .description('Start the binder-deploy-kubernetes server')
        .option('-a, --api-key <key>', 'Binder API key')
        .option('-p, --port <port>', 'the binder-deploy-kubernetes server port')
        .option('-c, --config <path>', 'Module configuration file')
    }, function (options) {
      console.log('Starting the binder-deploy-kubernetes server...')
      var opts = {}
      if (options.config) {
        _.merge(opts, JSON.parse(fs.readFileSync(path.resolve(options.config))))
      } if (options.port) {
        opts.port = options.port
      } if (options.apiKey) {
        opts.apiKey = options.apiKey
      }
      var module = new Module(opts)
      module.start()
    }),
    Command('stop', function (program) {
      return program
        .description('Stop the binder-deploy-kubernetes server')
    }, function (options) {
      console.log('Stopping the binder-deploy-kubernetes server...')
      shell.exec('pm2 delete binder-deploy-kubernetes-start')
    })
  ]
  return commands
}

var setupProgram = function (commands, program) {
  _.forEach(commands, function (cmd) {
    var command = program.command(cmd.name)
    command = cmd.cli(command)
    command.action(cmd.action)
  })
}

var pm2CLI = function (program) {
  if (!program) {
    program = require('commander')
  }
  // Replace all actions with PM2 subprocess creation
  var pm2Commands = _.map(makeCommands(), function (cmd) {
    if (cmd.name === 'start') {
      cmd.action = function (options) {
        console.log('Starting the binder-deploy-kubernetes server...')
        startWithPM2({
          name: 'binder-deploy-kubernetes-' + cmd.name,
          exec_mode: 'cluster',
          instances: 1,
          script: path.join(__dirname, 'cli.js'),
          args: process.argv.slice(2)
        })
      }
    }
    return cmd
  })
  setupProgram(pm2Commands, program)
  return program
}

var standaloneCLI = function (program) {
  if (!program) {
    program = require('commander')
  }
  setupProgram(makeCommands(), program)
  return program
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
