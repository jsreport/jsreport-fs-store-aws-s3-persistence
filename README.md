# jsreport-fs-store-aws-s3-persistence
[![NPM Version](http://img.shields.io/npm/v/jsreport-fs-store-aws-s3-persistence.svg?style=flat-square)](https://npmjs.com/package/jsreport-fs-store-aws-s3-persistence)
[![Build Status](https://travis-ci.org/jsreport/jsreport-fs-store-aws-s3-persistence.png?branch=master)](https://travis-ci.org/jsreport/jsreport-fs-store-aws-s3-persistence)

**Make jsreport [fs store](https://github.com/jsreport/jsreport-fs-store) persisting entities into AWS S3.**


## Installation

> npm install jsreport-fs-store:next    
> npm install jsreport-fs-store-aws-s3-persistence

Create an IAM user with permissions to S3 and SQS and copy the access key and secret access key.
Create a bucket and copy its name. Then alter the jsreport configuration:
```js
"connectionString": { 
  "name": "fs2",
  "persistence": {
    "name": "aws-s3",
    "accessKeyId": "...",
    "secretAccessKey": "..."
    "bucket": "..."
    // the rest is otional
    "lock": {
      "queueName": "jsreport-lock.fifo",
      "region": "us-east-1",
      "enabled": true,
      "attributes": {}
    }
  }
},	
```

This persistence implementation also guarantees consistency for parallel access from multiple instances. This is assured using locking mechanism enabling only single write at once. The locking is implemented trough AWS SQS. The queue is automatically created during the instance startup with attributes specified in the configuration `lock`. You can disable it by setting `false` to `lock.enabled`.