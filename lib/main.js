const fileSystemS3 = require('./fileSystemS3')

module.exports = (reporter, definition) => {
  if (reporter.fsStore) {
    reporter.fsStore.registerPersistence('aws-s3', (options) =>
      (fileSystemS3(Object.assign({ logger: reporter.logger }, options, definition.options))))
  }
}
