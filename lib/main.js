const fileSystemS3 = require('./fileSystemS3')

module.exports = (reporter, definition) => {
  if (reporter.fsStore) {
    reporter.fsStore.registerPersistence('aws-s3', (options) =>
      (fileSystemS3(Object.assign({}, definition.options, { logger: reporter.logger }))))
  }

  // avoid exposing connection string through /api/extensions
  definition.options = {}
}
