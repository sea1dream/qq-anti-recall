const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {ImgDownloader} = require('../imgDownloader.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-picture-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const downloader=new ImgDownloader(path.join(dir,'backup'));
 downloader.output=()=>{};
 downloader.getImageUrl=async()=>{throw Error('Network unavailable in offline recovery test')};
 const source=path.join(dir,'QQ','Ori','picture.png');
 const thumb=path.join(dir,'QQ','Thumb','picture_198.png');
 const message={msgId:'synthetic-image',elements:[{picElement:{md5HexStr:'11111111111111111111111111111111',sourcePath:source,thumbPath:new Map([[198,thumb]])}}]};
 return {dir,downloader,message,source,thumb,pic:message.elements[0].picElement};
}
function write(file,bytes=png){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}

test('a received image remains recoverable after QQ deletes its cache and the plugin restarts',async t=>{
 const f=fixture(t);write(f.source);write(f.thumb);
 f.downloader.capturePic(f.message);
 fs.unlinkSync(f.source);fs.unlinkSync(f.thumb);
 const restarted=new ImgDownloader(path.join(f.dir,'backup'));restarted.output=()=>{};
 restarted.getImageUrl=async()=>{throw Error('Must recover offline')};
 const persisted=JSON.parse(JSON.stringify(f.message,(_,value)=>value instanceof Map?Object.fromEntries(value):value));
 await restarted.downloadPic(persisted);
 assert.deepEqual(fs.readFileSync(f.source),png);
 assert.deepEqual(fs.readFileSync(f.thumb),png);
 assert.equal(persisted.elements[0].picElement.thumbPath.get(198),f.thumb);
});

test('an already cached image renders without a working remote key server',async t=>{
 const f=fixture(t);write(f.source);await f.downloader.downloadPic(f.message);
 assert.deepEqual(fs.readFileSync(f.source),png);
 assert.equal(f.pic.thumbPath.get(198),f.source);
});

test('a saved thumbnail can still display when the original was never downloaded',async t=>{
 const f=fixture(t);write(f.thumb);f.downloader.capturePic(f.message);fs.unlinkSync(f.thumb);
 await f.downloader.downloadPic(f.message);
 assert.deepEqual(fs.readFileSync(f.source),png);
});

test('a broken placeholder is replaced by a valid download',async t=>{
 const f=fixture(t);write(f.source,Buffer.from('broken'));
 f.downloader.getImageUrl=async()=> 'https://gchat.qpic.cn/synthetic';
 f.downloader.request=async()=>png;
 await f.downloader.downloadPic(f.message);
 assert.deepEqual(fs.readFileSync(f.source),png);
});

test('HTTP failures cannot be written as image files',async t=>{
 const f=fixture(t);f.downloader.getImageUrl=async()=> 'https://gchat.qpic.cn/synthetic';
 f.downloader.request=async()=>Buffer.from('<html>download failed</html>');
 await f.downloader.downloadPic(f.message);
 assert.equal(fs.existsSync(f.source),false);
});

test('download failure does not abort restoration of the remaining message',async t=>{
 const f=fixture(t);await assert.doesNotReject(()=>f.downloader.downloadPic(f.message));
});

test('HTTP error responses are rejected',async t=>{
 const server=http.createServer((_,res)=>{res.writeHead(404);res.end('missing')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const f=fixture(t);
 await assert.rejects(()=>f.downloader.request('http://127.0.0.1:'+server.address().port+'/missing'),/404/);
});
