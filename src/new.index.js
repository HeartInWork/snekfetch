const http = require('http');
const https = require('https');
const URL = require('url');
const zlib = require('zlib');
const Stream = require('stream');
const Package = require('../package.json');

class Snekfetch extends Stream.Readable {
  constructor(method, url) {
    super();
    const { hostname, path, protocol } = URL.parse(url);
    this.protocol = protocol;
    this.url = url;
    this.options = {
      method: method.toUpperCase(),
      hostname,
      path,
      headers: {},
    };
    this.data = null;
    this.ended = false;
  }

  set(name, value) {
    if (name !== null && typeof name === 'object') {
      for (const key of Object.keys(name)) this.set(key, name[key]);
    } else {
      this.options.headers[name.toLowerCase()] = value;
    }
    return this;
  }

  attach(name, data, filename) {
    const form = this._getFormData();
    this.set('Content-Type', `multipart/form-data; boundary=${form.boundary}`);
    form.append(name, data, filename);
    this.data = form;
    return this;
  }

  send(data) {
    if (typeof data === 'object') {
      this.set('Content-Type', 'application/json');
      this.data = JSON.stringify(data);
    } else {
      this.data = data;
    }
    return this;
  }

  go() {
    return new Promise((resolve, reject) => {
      this.ended = true;
      if (!this.options.headers['user-agent']) {
        this.set('user-agent', `snekfetch/${Snekfetch.version} (${Package.repository.url.replace(/\.?git/, '')})`);
      }
      const request = (this.protocol === 'https' ? https : http)
      .request(this.options, (response) => {
        response.request = request;
        const stream = new Stream.PassThrough();
        if (this._shouldUnzip(response)) {
          response.pipe(zlib.createUnzip({
            flush: zlib.Z_SYNC_FLUSH,
            finishFlush: zlib.Z_SYNC_FLUSH,
          })).pipe(stream);
        } else {
          response.pipe(stream);
        }

        let body = [];
        stream.on('data', (chunk) => {
          if (!this.push(chunk)) this.pause();
          body.push(Buffer.from(chunk));
        });
        stream.on('end', () => {
          this.push(null);
          const concated = Buffer.concat(body);
          console.log(response.statusCode, this.options);
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            resolve(Snekfetch[this.options.method.toLowerCase()](URL.resolve(this.url, response.headers.location)));
            return;
          }
          const res = {
            request: this.options,
            body: concated,
            text: concated.toString(),
            ok: response.statusCode >= 200 && response.statusCode < 300,
            headers: response.headers,
            status: response.statusCode,
            statusText: response.statusText || http.STATUS_CODES[response.statusCode],
            url: this.url,
          };

          const type = response.headers['content-type'];
          if (type.includes('application/json')) {
            try {
              res.body = JSON.parse(res.text);
            } catch (err) {} // eslint-disable-line no-empty
          } else if (type.includes('application/x-www-form-urlencoded')) {
            res.body = {};
            for (const [k, v] of res.text.split('&').map(q => q.split('='))) res.body[k] = v;
          }

          if (res.ok) {
            resolve(res);
          } else {
            const error = new Error(`${res.status} ${res.statusText}`.trim());
            error.response = res;
            reject(error);
          }
        });
      });
      const data = this.data ? this.data.end ? this.data.end() : this.data : null;
      request.end(data);
    });
  }

  then(s, f) {
    return this.go()
    .then((res) => s ? s(res) : res)
    .catch((err) => f ? f(err) : err);
  }

  end(cb) {
    this.then((res) => {
      cb(null, res);
    }).catch((err) => {
      cb(err, err.response ? err.response : null);
    });
  }

  catch(f) {
    return this.then(null, f);
  }

  _read() {
    this.resume();
    if (this.ended) return;
    this.end(() => {}); // eslint-disable-line no-empty-function
  }

  _shouldUnzip(res) {
    if (res.statusCode === 204 || res.statusCode === 304) return false;
    if (res.headers['content-length'] === '0') return false;
    return /^\s*(?:deflate|gzip)\s*$/.test(res.headers['content-encoding']);
  }

  _getFormData() {
    if (!this._formData) this._formData = new FormData();
    return this._formData;
  }
}

Snekfetch.version = Package.version;

Snekfetch.METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH', 'BREW'];
for (const method of Snekfetch.METHODS) Snekfetch[method.toLowerCase()] = (url) => new Snekfetch(method, url);

module.exports = Snekfetch;