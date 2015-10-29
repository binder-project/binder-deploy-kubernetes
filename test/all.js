var _ = require('lodash')

var tests = []

_.forEach(_.flatten(tests), function (test) {
  test()
})

