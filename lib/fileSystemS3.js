const Promise = require('bluebird')
const path = require('path')
const S3 = require('aws-sdk/clients/s3')
const SQS = require('aws-sdk/clients/sqs')
const crypto = require('crypto')
const hostname = require('os').hostname()
const instanceId = crypto.createHash('sha1').update(hostname + __dirname).digest('hex') // eslint-disable-line no-path-concat

module.exports = ({ logger, accessKeyId, secretAccessKey, bucket, lock = {}, s3Options = {} }) => {
  if (!bucket) {
    throw new Error('The fs store is configured to use aws s3 persistence but the bucket is not set. Use store.persistence.bucket or extensions.fs-store-aws-s3-persistence.bucket to set the proper value.')
  }

  let s3
  if (accessKeyId != null && secretAccessKey != null) {
    s3 = new S3({ accessKeyId: accessKeyId, secretAccessKey: secretAccessKey, ...s3Options })
  } else {
    s3 = new S3({ ...s3Options })
  }
  Promise.promisifyAll(s3, { suffix: 'P' })

  async function listObjectKeys (p) {
    const opts = {
      Bucket: bucket,
      Prefix: p
    }
    const result = []
    do {
      const data = await s3.listObjectsV2P(opts)
      opts.ContinuationToken = data.NextContinuationToken
      result.push(...data.Contents)
    } while (opts.ContinuationToken)

    return result
      .filter(e =>
        e.Key === p ||
        e.Key.startsWith(p + '/') ||
        p === '')
      .map(e => e.Key)
  }

  let queueUrl
  let sqs

  return {
    init: async () => {
      logger.info(`fs store is verifying aws s3 bucket ${bucket} exists and is accessible`)
      try {
        await s3.headBucketP({ Bucket: bucket })
      } catch (e) {
        throw new Error(`fs store aws s3 bucket "${bucket}" doesn't exist or user doesn't have permissions to it. ` + e)
      }

      if (lock.enabled !== false) {
        lock.queueName = lock.queueName || 'jsreport-lock.fifo'
        lock.attributes = Object.assign({
          FifoQueue: 'true',
          // we don't need lock messages to be stored by aws longer than 1min which is the lowest AWS value
          MessageRetentionPeriod: '60',
          // the time in s for which the message is blocked for others when we pop it up
          VisibilityTimeout: '10'
        }, lock.attributes)
        lock.region = lock.region || 'us-east-1'

        logger.info(`fs store is verifying SQS for locking in ${lock.region} with name ${lock.queueName} `)
        if (accessKeyId != null && secretAccessKey != null) {
          sqs = new SQS({ accessKeyId: accessKeyId, secretAccessKey: secretAccessKey, region: lock.region })
        } else {
          sqs = new SQS({ region: lock.region })
        }

        Promise.promisifyAll(sqs, { suffix: 'P' })

        const queueRes = await sqs.createQueueP({
          QueueName: lock.queueName,
          Attributes: lock.attributes
        })
        queueUrl = queueRes.QueueUrl
      }
    },
    readdir: async (p) => {
      const res = await listObjectKeys(p)

      const topFilesOrDirectories = res.map(e => e.replace(p, '').split('/').filter(f => f)[0]).filter(f => f)

      return [...new Set(topFilesOrDirectories)]
    },
    readFile: async (p) => {
      const res = await s3.getObjectP({
        Bucket: bucket,
        Key: p
      })
      return res.Body
    },
    writeFile: (p, c) => s3.putObjectP({ Bucket: bucket, Key: p, Body: c }),
    appendFile: async (p, c) => {
      let existingBuffer = Buffer.from([])
      try {
        const res = await s3.getObjectP({
          Bucket: bucket,
          Key: p
        })
        existingBuffer = res.Body
      } catch (e) {
        // doesn't exists yet
      }

      return s3.putObjectP({ Bucket: bucket, Key: p, Body: Buffer.concat([existingBuffer, Buffer.from(c)]) })
    },
    rename: async (p, pp) => {
      const objectsToRename = await listObjectKeys(p)

      await Promise.all(objectsToRename.map(async (key) => {
        const newName = key.replace(p, pp)
        await s3.copyObjectP({
          Bucket: bucket,
          CopySource: `/${bucket}/${encodeURIComponent(key)}`,
          Key: newName
        })
      }))

      const chunks = objectsToRename.reduce((all, one, i) => {
        const ch = Math.floor(i / 1000)
        all[ch] = [].concat((all[ch] || []), one)
        return all
      }, [])

      await Promise.all(chunks.map(ch => s3.deleteObjectsP({
        Bucket: bucket,
        Delete: {
          Objects: ch.map(e => ({ Key: e })),
          Quiet: true
        }
      })))
    },
    exists: async (p) => {
      try {
        await s3.headObjectP({ Bucket: bucket, Key: p })
        return true
      } catch (e) {
        return false
      }
    },
    stat: async (p) => {
      // directory always fail for some reason
      try {
        await s3.headObjectP({ Bucket: bucket, Key: p })
        return { isDirectory: () => false }
      } catch (e) {
        return { isDirectory: () => true }
      }
    },
    mkdir: (p) => Promise.resolve(),
    remove: async (p) => {
      const blobsToRemove = await listObjectKeys(p)
      
      const chunks = blobsToRemove.reduce((all, one, i) => {
        const ch = Math.floor(i / 1000)
        all[ch] = [].concat((all[ch] || []), one)
        return all
      }, [])

      await Promise.all(chunks.map(ch => s3.deleteObjectsP({
        Bucket: bucket,
        Delete: {
          Objects: ch.map(e => ({ Key: e })),
          Quiet: true
        }
      })))
    },
    copyFile: (p, pp) => s3.copyObjectP({
      Bucket: bucket,
      CopySource: `/${bucket}/${encodeURIComponent(p)}`,
      Key: pp
    }),
    path: {
      join: (...args) => args.filter(a => a).join('/'),
      sep: '/',
      basename: path.basename
    },
    async lock () {
      if (lock.enabled === false) {
        return null
      }

      logger.debug('Locking s3 store')

      const start = Date.now()
      const lockId = Date.now()

      const waitForMessage = async () => {
        if (start + 5000 < Date.now()) {
          logger.debug('s3 lock timed out, starting again')
          return this.lock()
        }

        const res = await sqs.receiveMessageP({
          QueueUrl: queueUrl,
          WaitTimeSeconds: 1
        })

        if (res.Messages && res.Messages.length) {
          const message = JSON.parse(res.Messages[0].Body)

          if (message.instanceId !== instanceId) {
            if (message.sentOn && (message.sentOn + 5000 < Date.now())) {
              logger.debug('s3 another server orphan lock, removing')
              try {
                await sqs.deleteMessageP({ QueueUrl: queueUrl, ReceiptHandle: res.Messages[0].ReceiptHandle })
              } catch (e) {

              }
            } else {
              logger.debug('s3 lock from another instance, releasing item')
              // we have event that the original locker is waiting for
              // unblock the message for other receivers

              try {
                await sqs.changeMessageVisibilityP({
                  QueueUrl: queueUrl,
                  ReceiptHandle: res.Messages[0].ReceiptHandle,
                  VisibilityTimeout: 0
                })
              } catch (e) {

              }
            }

            return waitForMessage()
          }

          if (message.lockId !== lockId) {
            logger.debug('s3 orphan lock, removing')
            // orphan message, just remove it
            try {
              await sqs.deleteMessageP({ QueueUrl: queueUrl, ReceiptHandle: res.Messages[0].ReceiptHandle })
            } catch (e) {

            }

            return waitForMessage()
          }

          logger.debug('s3 lock acquired')
          return res
        }

        return waitForMessage()
      }

      await sqs.sendMessageP({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ instanceId, lockId, sentOn: Date.now() }),
        MessageGroupId: 'default',
        MessageDeduplicationId: Date.now() + ''
      })

      logger.debug('Waiting for s3 lock')
      return waitForMessage()
    },
    releaseLock: async (l) => {
      if (lock.enabled === false) {
        return null
      }

      logger.debug('releasing s3 lock')
      try {
        await sqs.deleteMessageP({ QueueUrl: queueUrl, ReceiptHandle: l.Messages[0].ReceiptHandle })
        logger.debug('s3 lock released')
      } catch (e) {
        logger.debug('release lock failed')
      }
    }
  }
}
