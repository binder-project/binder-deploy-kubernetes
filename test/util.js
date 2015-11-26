var _ = require('lodash')

module.exports = {
  // http://stackoverflow.com/questions/30212323/javascript-compare-objects-having-functions-using-lodash-isequal
  isEqual: function (o1, o2) {
      return _.isEqual(_.omit(o1, _.functions(o1)), _.omit(o2, _.functions(o2)))
  }
}
