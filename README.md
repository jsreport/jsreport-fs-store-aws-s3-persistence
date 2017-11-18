# jsreport-fs-store
[![NPM Version](http://img.shields.io/npm/v/jsreport-fs-store.svg?style=flat-square)](https://npmjs.com/package/jsreport-fs-store)
[![Build Status](https://travis-ci.org/jsreport/jsreport-fs-store.png?branch=master)](https://travis-ci.org/jsreport/jsreport-fs-store)

**[jsreport](https://github.com/jsreport/jsreport) template store extension. Supports editing templates in the external editors and browsers live reload and preview!**


## Installation

> npm install jsreport-fs-store

Then alter jsreport configuration 
```js
{
	'connectionString': { 'name': 'fs' }
}
```

You should delete the old `data` when using this for the first time.

## Features
This extension stores templates in the structured form easy to integrate with source controls.

> data \ templates
> - - sample template
> - - - - content.html
> - - - - helpers.js
> - - - - config.js 

The file extension of the template content files are also adapted based on the use extension. So for example the `content.html` will be changed to `content.handlebars` when the template is using handlebars engine.

This storage also lets you to easily edit the template files in your favorite external text editor. Every change to the template file triggers the templates database reload on the fly. If you have also the jsreport studio open on the particular template it gets notified through sockets and refreshes and previews the template in the browser. **This behavior is enabled only in the development environment by default, although you can override this default using `syncModifications` option.**

## jsreport-core
You can apply this extension also manually to [jsreport-core](https://github.com/jsreport/jsreport-core)

```js
var jsreport = require('jsreport-core')()
jsreport.use(require('jsreport-fs-store')({ dataDirectory: '...', syncModifications: true }))
```

## Development
(This section is intended to jsreport extension developers audience.)

### Entity definitions
Use `splitIntoDirectories` attribute in `registerEntitySet` to use the directory structure for storing. Otherwise the storage will put every entity row into the one single file.
```js
this.documentStore.registerEntitySet("templates", {entityType: "jsreport.TemplateType", splitIntoDirectories: true});
```

Not every jsreport entity should be spitted into the tree structure. It is especially not desired for the entities where you expect thousands of entries.  In this case just remove the `splitIntoDirectories` attribute.

The second required step is to extend the entity type with `publicKey` which is marking the attribute used for the row directory name. And also adding the `document` for the attributes you want to extract into dedicated files.
```js
var templateAttributes = {
	...
    shortid: {type: "Edm.String"},
    name: {type: "Edm.String", publicKey: true},
    content: {type: "Edm.String", 
	    document: { extension: "html", engine: true }
	}
    ...      
};
```

### Engines

Engines like handlebars or jade are able to override the default file extension for the template content files. This can be done using file extension resolver....
```js
reporter.documentStore.addFileExtensionResolver(function(doc, entitySetName, entityType, propertyType) {
        if (doc.engine === "handlebars" && propertyType.document.engine) {
            return "handlebars";
        };
    });
```    



