// Based on the upstream Anti-Recall downloader (MIT), with local image recovery.
const { RkeyManager } = require('./rkeyManager.js');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function isImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false;
  return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6)) ||
    (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ||
    bytes.toString('ascii', 0, 2) === 'BM' ||
    (bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis|heic|heix|mif1/.test(bytes.toString('ascii', 8, 32)));
}
function validFile(file) {
  if (typeof file !== 'string' || !file) return false;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (fs.fstatSync(fd).size < 12) return false;
    const header = Buffer.alloc(32);
    fs.readSync(fd, header, 0, header.length, 0);
    return isImage(header);
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function thumbEntries(pic) {
  if (pic.thumbPath instanceof Map) return [...pic.thumbPath];
  if (Array.isArray(pic.thumbPath)) return pic.thumbPath.filter(item => Array.isArray(item) && item.length === 2);
  return pic.thumbPath && typeof pic.thumbPath === 'object' ? Object.entries(pic.thumbPath) : [];
}
class ImgDownloader {
  constructor(cacheDir) {
    this.cacheDir = cacheDir || path.join(LiteLoader.path.data, 'anti_recall', 'images');
    this.rkeyManager = new RkeyManager('https://llob.linyuchen.net/rkey');
    this.pending = new Map();
    this.timer = null;
  }
  backupPath(pic, size) {
    const identity = /^[a-f\d]{32}$/i.test(pic.md5HexStr || '') ? pic.md5HexStr.toLowerCase() :
      crypto.createHash('sha256').update(String(pic.sourcePath || pic.fileUuid || '')).digest('hex');
    return path.join(this.cacheDir, identity + '.' + String(size).replace(/[^a-z\d_-]/gi, '_'));
  }
  capturePic(message) {
    let found = false;
    for (const element of message?.elements || []) {
      const pic = element.picElement;
      if (!pic) continue;
      for (const [size, file] of [['original', pic.sourcePath], ...thumbEntries(pic)]) {
        if (!validFile(file)) continue;
        const destination = this.backupPath(pic, size);
        try {
          fs.mkdirSync(this.cacheDir, { recursive: true });
          if (!validFile(destination) || fs.statSync(destination).size !== fs.statSync(file).size) fs.copyFileSync(file, destination);
          found = true;
        } catch (error) { this.output('Could not cache picture:', error.code || error.name); }
      }
    }
    return found;
  }
  watchPic(message) {
    if (!(message?.elements || []).some(element => element.picElement)) return;
    this.capturePic(message);
    this.pending.set(message.msgId, { message, until: Date.now() + 30000 });
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const [id, item] of this.pending) {
        this.capturePic(item.message);
        if (Date.now() >= item.until) this.pending.delete(id);
      }
      if (!this.pending.size) { clearInterval(this.timer); this.timer = null; }
    }, 500);
    this.timer.unref?.();
  }
  async getImageUrl(pic) {
    if (pic.originImageUrl) {
      const parsed = new URL(pic.originImageUrl, 'https://gchat.qpic.cn');
      if (['1406', '1407'].includes(parsed.searchParams.get('appid'))) {
        parsed.hostname = 'multimedia.nt.qq.com.cn';
        parsed.protocol = 'https:';
        if (!parsed.searchParams.get('rkey')) {
          const keys = await this.rkeyManager.getRkey();
          const value = parsed.searchParams.get('appid') === '1406' ? keys.private_rkey : keys.group_rkey;
          if (!value) throw new Error('Image download key is unavailable');
          parsed.searchParams.set('rkey', new URLSearchParams(value.replace(/^[?&]/, '')).get('rkey') || value);
        }
      }
      return parsed.href;
    }
    return pic.md5HexStr ? 'https://gchat.qpic.cn/gchatpic_new/0/0-0-' + pic.md5HexStr.toUpperCase() + '/0' : '';
  }
  async downloadPic(message) {
    for (const element of message?.elements || []) {
      const pic = element.picElement;
      if (!pic || !pic.sourcePath) continue;
      try {
        this.capturePic(message);
        const thumbs = thumbEntries(pic);
        if (!validFile(pic.sourcePath)) {
          const saved = ['original', ...thumbs.map(([size]) => size), 0, 198, 720].map(size => this.backupPath(pic, size)).find(validFile);
          if (saved) {
            fs.mkdirSync(path.dirname(pic.sourcePath), { recursive: true });
            fs.copyFileSync(saved, pic.sourcePath);
          } else {
            const url = await this.getImageUrl(pic);
            if (!url) continue;
            const body = await this.request(url);
            if (!isImage(body)) throw new Error('Server did not return a supported image');
            fs.mkdirSync(path.dirname(pic.sourcePath), { recursive: true });
            fs.writeFileSync(pic.sourcePath, body);
          }
        }
        if (!validFile(pic.sourcePath)) continue;
        const resolved = new Map();
        for (const [size, file] of thumbs) {
          const backup = this.backupPath(pic, size);
          if (!validFile(file) && typeof file === 'string' && validFile(backup)) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.copyFileSync(backup, file);
          }
          resolved.set(Number(size), validFile(file) ? file : pic.sourcePath);
        }
        for (const size of [0, 198, 720]) if (!resolved.has(size)) resolved.set(size, pic.sourcePath);
        pic.thumbPath = resolved;
        this.capturePic(message);
        this.output('Picture restored from available image data.');
      } catch (error) { this.output('Picture unavailable:', error.code || error.message); }
    }
  }
  request(url, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 4) return reject(new Error('Too many image redirects'));
      let parsed;
      try { parsed = new URL(url); } catch (error) { return reject(error); }
      if (!['http:', 'https:'].includes(parsed.protocol)) return reject(new Error('Unsupported image protocol'));
      const req = (parsed.protocol === 'https:' ? https : http).get(parsed, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const target = new URL(res.headers.location, parsed);
          if (parsed.protocol === 'https:' && target.protocol !== 'https:') return reject(new Error('Insecure image redirect'));
          return resolve(this.request(target.href, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('Image HTTP ' + res.statusCode)); }
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) req.destroy(new Error('Image exceeds 64 MiB download limit'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.setTimeout(8000, () => req.destroy(new Error('Image request timed out')));
      req.on('error', reject);
    });
  }
  output(...args) { console.log('Anti-Recall:', ...args); }
}
module.exports.ImgDownloader = ImgDownloader;
