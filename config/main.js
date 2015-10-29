// Top-level binder-deploy settings
port = 8080

// Kubernetes configuration options
var kube = {
  proxyHost: 'localhost',
  proxyPort: 8083
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
