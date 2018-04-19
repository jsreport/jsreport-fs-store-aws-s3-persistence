module.exports = {
  name: 'fs-store-aws-s3-persistence',
  main: 'lib/main.js',
  dependencies: [ 'templates', 'fs-store' ],
  optionsSchema: {
    extensions: {
      'fs-store-aws-s3-persistence': {
        accessKeyId: { type: 'string' },
        secretAccessKey: { type: 'string' },
        bucket: { type: 'string' },
        lock: {
          type: 'object',
          properties: {
            queueName: { type: 'string' },
            region: { type: 'string' },
            enabled: { type: 'boolean' },
            attributes: {
              type: 'object'
            }
          }
        }
      }
    }
  }
}
