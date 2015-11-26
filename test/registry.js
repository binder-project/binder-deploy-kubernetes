var assert = require('assert')
var RegistryClient = require('../lib/registry.js')

describe('Registry', function () {
  
  describe('local', function () {

    var registry = null

    describe('good directory', function () {

      beforeEach(function () {
        registry = new RegistryClient({
          templateDir: 'examples/'
        })
      })

      describe('#fetchTemplate', function () {
        it('should find the correct template file in templateDir', function (done) {
          registry.fetchTemplate('binder-project-example-requirements', function (err, template) {
            if (err) throw err
            assert(template)
            done()
          })
        })
        it('show throw an error if a template does not exist', function (done) {
          registry.fetchTemplate('binder-project-baadd-example', function (err, template) {
            assert(err)
            done()
          })
        })
      })
    })

    describe('bad directory', function () {

      beforeEach(function () {
        registry = new RegistryClient({
          templateDir: './baddirectory'
        })
      })
      
      describe('#fetchTemplate', function () {
        it('should throw an error if the template directory is not found', function (done) {
          registry.fetchTemplate('binder-project-example-requirement', function (err, template) {
           assert(err)
           done()
          })
        })
      })
    })

  })
})
