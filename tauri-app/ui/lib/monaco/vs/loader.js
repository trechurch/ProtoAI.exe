/*! Minimal AMD loader for Monaco */
var require = (function () {
  var modules = {};
  function define(id, deps, factory) {
    modules[id] = { deps, factory, instance: null };
  }
  function resolve(id) {
    var m = modules[id];
    if (!m.instance) {
      var args = m.deps.map(resolve);
      m.instance = m.factory.apply(null, args);
    }
    return m.instance;
  }
  return function (deps, callback) {
    var args = deps.map(resolve);
    callback.apply(null, args);
  };
})();
