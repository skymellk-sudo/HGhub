import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWebServer, dispatch, newSession, rewritePlaylist, checkedTarget, publicAddress } from './server.mjs';

test('browser RPC keeps accounts separate, rejects cross-site changes, serves native media ranges',async()=>{
  const server=createWebServer({rpc:async(s,cmd,a)=>{
    if(cmd==='save'){s.user=a.user;return s.user;}
    return s.user;
  },mediaHandler:async()=>({body:Buffer.from('0123456789'),type:'video/mp4'})});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const rpc=(command,args={},cookie='')=>fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({command,args})});
    const first=await rpc('save',{user:{id:7}});assert.deepEqual((await first.json()).result,{id:7});
    const cookie=first.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await(await rpc('read',{},cookie)).json()).result,{id:7});
    assert.equal((await(await rpc('read')).json()).result,null);
    const cross=await fetch(base+'/rpc',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
    const badHost=await new Promise((ok,bad)=>http.get(base+'/',{headers:{Host:'attacker.example'}},r=>{r.resume();ok(r.statusCode);}).on('error',bad));assert.equal(badHost,403);
    const range=await fetch(base+'/media/seg?u=x',{headers:{Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.equal(await range.text(),'2345');
    const suffix=await fetch(base+'/media/seg?u=x',{headers:{Range:'bytes=-3'}});assert.equal(await suffix.text(),'789');
    assert.equal((await fetch(base+'/media/seg?u=x',{headers:{Range:'bytes=20-'}})).status,416);
    assert.equal((await fetch(base+'/media/seg?u=x',{method:'HEAD'})).headers.get('content-length'),'10');
    assert.equal((await fetch(base+'/%2e%2e%5cpackage.json')).status,403);
    assert.equal((await fetch(base+'/assets/missing.js')).status,404);
  }finally{await new Promise(ok=>server.close(ok));}
});
test('new and legacy playback work through the browser adapter; mutation is never retried',async()=>{
  const calls=[];const s=newSession();
  const send=async(_s,method,path,body,auth)=>{calls.push({method,path,body,auth});return {streams:{main:'https://cdn.example/current.m3u8'}};};
  assert.equal((await dispatch(s,'api_play',{id:7,ep:3},send)).video_url,'https://cdn.example/current.m3u8');
  assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
  let n=0;const fallback=async()=>{if(++n===1)throw Error('temporary');return {video_url:'https://cdn.example/old.m3u8'};};
  assert.equal((await dispatch(s,'api_play',{id:7,ep:3},fallback)).video_url,'https://cdn.example/old.m3u8');
  await dispatch(s,'api_comment_send',{id:7,ep:3,text:'hello',replyId:9},send);
  assert.equal(calls.at(-1).auth,true);assert.equal(calls.at(-1).body.reply_id,9);
  await assert.rejects(dispatch(s,'api_category',{cate:'x',page:-1},send));
  await assert.rejects(dispatch(s,'nonexistent',{},send));
});
test('nested HLS playlists, keys, and fragments stay on the same origin',()=>{
  const out=rewritePlaylist('https://cdn.example/folder/master.m3u8','#EXTM3U\n#EXT-X-MEDIA:NAME="audio,main",URI="a/list.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-CONTENT-STEERING:SERVER-URI="https://other.example"\nsegment.ts?auth=1\n');
  assert.equal((out.match(/\/media\/seg\?u=/g)||[]).length,3);
  assert(out.includes('NAME="audio,main"'));assert(!out.includes('CONTENT-STEERING'));
  const next=new URL('http://localhost'+out.split('\n').find(l=>l.startsWith('/media')));
  assert.equal(next.searchParams.get('u'),'https://cdn.example/folder/segment.ts?auth=1');
});
test('SSRF guards reject local, mapped, reserved addresses and credentials',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('1.1.1.1'),true);
  for(const url of ['http://127.0.0.1/a','http://2130706433/a','https://user:pass@example.com','file:///etc/passwd','http://[::1]/'])await assert.rejects(checkedTarget(url));
});
