const Promise = require('bluebird')
const path = require('path')
const S3 = require('aws-sdk/clients/s3')
const SQS = require('aws-sdk/clients/sqs')
const crypto = require('crypto')
const hostname = require('os').hostname()
const instanceId = crypto.createHash('sha1').update(hostname + __dirname).digest('hex') // eslint-disable-line no-path-concat

module.exports = ({ logger, accessKeyId, secretAccessKey, bucket, lock = { } }) => {
  if (!accessKeyId) {
    throw new Error('The fs store is configured to use aws s3 persistence but the accessKeyId is not set. Use connectionString.persistence.accessKeyId or fs-store-aws-s3-persistence.accessKeyId to set the proper value.')
  }
  if (!secretAccessKey) {
    throw new Error('The fs store is configured to use aws s3 persistence but the accousecretAccessKeyntKey is not set. Use connectionString.persistence.secretAccessKey or fs-store-aws-s3-persistence.secretAccessKey to set the proper value.')
  }
  if (!bucket) {
    throw new Error('The fs store is configured to use aws s3 persistence but the bucket is not set. Use connectionString.persistence.bucket or fs-store-aws-s3-persistence.bucket to set the proper value.')
  }

  const s3 = new S3({ accessKeyId: accessKeyId, secretAccessKey: secretAccessKey })
  Promise.promisifyAll(s3)

  let queueUrl
  let sqs

  return {
    init: async () => {
      logger.info(`fs store is verifying aws s3 bucket ${bucket} exists and is accessible`)
      try {
        await s3.headBucketAsync({ Bucket: bucket })
      } catch (e) {
        throw new Error(`fs store aws s3 bucket "${bucket}" doesn't exist or user doesn't have permissions to it. ` + e)
      }

      if (lock.enabled !== false) {
        lock.queueName = lock.queueName || 'jsreport-lock.fifo'
        lock.attributes = Object.assign({ FifoQueue: 'true' }, lock.attributes)
        lock.region = 'us-east-1'

        sqs = new SQS({ accessKeyId: accessKeyId, secretAccessKey: secretAccessKey, region: lock.region })
        Promise.promisifyAll(sqs)

        const queueRes = await sqs.createQueueAsync({
          QueueName: lock.queueName,
          Attributes: lock.attributes
        })
        queueUrl = queueRes.QueueUrl
      }
    },
    readdir: async (p) => {
      const res = await s3.listObjectsV2Async({
        Bucket: bucket,
        Prefix: p
      })

      const topFilesOrDirectories = res.Contents.map(e => e.Key.replace(p, '').split('/').filter(f => f)[0]).filter(f => f)
      return [...new Set(topFilesOrDirectories)]
    },
    readFile: async (p) => {
      const res = await s3.getObjectAsync({
        Bucket: bucket,
        Key: p
      })
      return res.Body
    },
    writeFile: (p, c) => s3.putObjectAsync({ Bucket: bucket, Key: p, Body: c }),
    appendFile: async (p, c) => {
      let existingBuffer = Buffer.from([])
      try {
        const res = await s3.getObjectAsync({
          Bucket: bucket,
          Key: p
        })
        existingBuffer = res.Body
      } catch (e) {
        // doesn't exists yet
      }

      return s3.putObjectAsync({ Bucket: bucket, Key: p, Body: Buffer.concat([existingBuffer, Buffer.from(c)]) })
    },
    rename: async (p, pp) => {
      const objectsToRename = await s3.listObjectsV2Async({
        Bucket: bucket,
        Prefix: p
      })
      return Promise.all(objectsToRename.Contents.map(async (e) => {
        const newName = e.Key.replace(p, pp)
        await s3.copyObjectAsync({
          Bucket: bucket,
          CopySource: `/${bucket}/${e.Key}`,
          Key: newName
        })
        await s3.deleteObjectAsync({ Bucket: bucket, Key: e.Key })
      }))
    },
    exists: async (p) => {
      try {
        await s3.headObjectAsync({ Bucket: bucket, Key: p })
        return true
      } catch (e) {
        return false
      }
    },
    stat: async (p) => {
      // directory always fail for some reason
      try {
        await s3.headObjectAsync({ Bucket: bucket, Key: p })
        return { isDirectory: () => false }
      } catch (e) {
        return { isDirectory: () => true }
      }
    },
    mkdir: (p) => Promise.resolve(),
    remove: async (p) => {
      const blobsToRemove = await s3.listObjectsV2Async({
        Bucket: bucket,
        Prefix: p
      })

      return Promise.all(blobsToRemove.Contents.map(e => s3.deleteObjectAsync({ Bucket: bucket, Key: e.Key })))
    },
    path: {
      join: (a, b) => a ? `${a}/${b}` : b,
      sep: '/',
      basename: path.basename
    },
    lock: async () => {
      if (lock.enabled === false) {
        return null
      }

      const lockId = Date.now()
      const waitForMessage = async () => {
        const res = await sqs.receiveMessageAsync({
          QueueUrl: queueUrl
        })

        if (res.Messages && res.Messages.length) {
          const message = JSON.parse(res.Messages[0].Body)
          if (message.instanceId !== instanceId) {
            await sqs.changeMessageVisibilityAsync({
              QueueUrl: queueUrl,
              ReceiptHandle: res.Messages[0].ReceiptHandle,
              VisibilityTimeout: 0
            })
            return waitForMessage()
          }

          if (message.lockId !== lockId) {
            // orphan message, just remove it
            await sqs.deleteMessageAsync({ QueueUrl: queueUrl, ReceiptHandle: res.Messages[0].ReceiptHandle })
            return waitForMessage()
          }

          return res
        }

        return waitForMessage()
      }

      await sqs.sendMessageAsync({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ instanceId, lockId }),
        MessageGroupId: 'default',
        MessageDeduplicationId: Date.now() + ''
      })

      return waitForMessage()
    },
    releaseLock: (l) => lock.enabled !== false ? sqs.deleteMessageAsync({ QueueUrl: queueUrl, ReceiptHandle: l.Messages[0].ReceiptHandle }) : null
  }
}
