import _ from 'lodash';
import assert from 'assert';
import baseConfig from './base.config.js';
import fs from 'fs-extra';
import glob from 'glob';
import { sync as gzipSize } from 'gzip-size';
import MemoryFS from 'memory-fs';
import path from 'path';
import Plugin from '../src/index';
import { promisify } from 'bluebird';
import webpack from 'webpack';

const memFS = new MemoryFS;

class Config {
  constructor(entryPath, options={}) {
    merge(this, {
      'entry': entryPath,
      'plugins': [new Plugin(options)]
    }, baseConfig);
  }
}

Object.setPrototypeOf(Config.prototype, null);

class Compiler {
  constructor(config={}) {
    this.compiler = webpack(config);
    this.compiler.outputFileSystem = memFS;
    this.compiler.run = promisify(this.compiler.run, { 'context': this.compiler });
  }

  run() {
    return this.compiler.run();
  }
}

const merge = _.partialRight(_.mergeWith, (value, other) => {
  if (_.isArray(value) && _.isArray(other)) {
    return value.concat(other);
  }
});

/*----------------------------------------------------------------------------*/

describe('reduced modular builds', function() {
  this.timeout(0);

  _.each(glob.sync(path.join(__dirname, 'fixtures/*/')), testPath => {
    const testName = _.lowerCase(path.basename(testPath));
    const actualPath = path.join(testPath, 'actual.js');
    const offPath = path.join(testPath, 'off.json');
    const onPath = path.join(testPath, 'on.json');

    const offConfig = new Config(actualPath, fs.existsSync(offPath) ? require(offPath) : {});
    const onConfig = new Config(actualPath, fs.existsSync(onPath) ? require(onPath) : {});

    const outputPath = path.join(onConfig.output.path, onConfig.output.filename);

    const data = {
      'before': { 'config': onConfig },
      'after': { 'config': offConfig }
    };

    const compile = key => new Compiler(data[key].config).run();

    const complete = key => {
      return stats => {
        const bytes = gzipSize(memFS.readFileSync(outputPath));
        const { length: count } = stats.toJson().modules;
        _.assign(data[key], { bytes, count });
      };
    };

    it(`should work with ${ testName }`, done => {
      compile('before')
        .then(complete('before'))
        .then(() => compile('after'))
        .then(complete('after'))
        .then(() => {
          const { before, after } = data;
          assert.ok(before.bytes > after.bytes, `gzip bytes: ${ after.bytes }`);
          assert.ok(before.count >= after.count, `module count: ${ after.count }`);
          done();
        });
    });
  });
});
