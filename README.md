# jsreport-fs-store
[![NPM Version](http://img.shields.io/npm/v/jsreport-fs-store-aws-s3-persistence.svg?style=flat-square)](https://npmjs.com/package/jsreport-fs-store-aws-s3-persistence)
[![Build Status](https://travis-ci.org/jsreport/jsreport-fs-store-aws-s3-persistence.png?branch=master)](https://travis-ci.org/jsreport/jsreport-fs-store-aws-s3-persistence)

**Make jsreport [fs store](https://github.com/jsreport/jsreport-fs-store) persist entities into AWS S3.**


## Installation

> npm install jsreport-fs-store:next
> npm install jsreport-fs-store-aws-s3-persistence

And alter jsreport configuration 
```js
{
	"connectionString": { 
	  "name": "fs2",
	  "persistence": {
	    "accessKeyId": "...",
	    "secretAccessKey": "..."
	  }
	},	
}
```