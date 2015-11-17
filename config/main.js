// Kubernetes configuration options
var kube = {
  proxyHost: 'localhost',
  proxyPort: 8083,
  apiVersion: 'v1'
}

// Logging settings
var logging = {
  file: 'binder-deploy-kubernetes.log'
}

// Storage settings
var storage = {
  // storage can either be 'in-memory' on 'mongo'
  mode: 'in-memory',

  mongo: {
    poolCollection: 'pools',
    appCollection: 'running_apps'
  }
}

// Pool settings
var pool = {
  size: 1
}

module.exports = {
  port: 8080,
  kube: kube,
  storage: storage,
  logging: logging,
  pool: pool
}
