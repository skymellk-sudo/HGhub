import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createDecipheriv } from 'node:crypto';
import { proxyUrl, proxyAgent, publicDns } from './proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const denied = new BlockList();
for (const [ip, mask] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(ip,mask);
export function publicAddress(ip) {
  if (isIP(ip) === 4) return !denied.check(ip);
  // Only global unicast IPv6; reject mapped IPv4 and reserved/documentation ranges.
  return isIP(ip) === 6 && /^[23]/i.test(ip) && !/^2001:(?:db8|0:)/i.test(ip) && !/^2002:/i.test(ip);
}
export async function checkedTarget(raw) {
  const u = new URL(raw);
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || (u.port && !['80','443'].includes(u.port))) throw new Error('Ŀ���ַ��Ч');
  const host = u.hostname.replace(/^\[|\]$/g,'');
  let addresses = isIP(host) ? [{address:host,family:isIP(host)}] : await dns.lookup(host,{all:true});
  if(proxyUrl && !isIP(host) && addresses.some(a=>/^198\.(18|19)\./.test(a.address))) addresses=await publicDns(host);
  if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('��ֹ��������������ַ');
  return {u, address:addresses[0]};
}
export async function request(raw, options={}, hop=0) {
  const {u,address} = await checkedTarget(raw);
  const agent=u.protocol==='https:'?proxyAgent(u.hostname,address.address):undefined;
  const result = await new Promise((ok,bad)=>{
    const req = (u.protocol==='https:'?https:http).request(u, {
      method:options.method||'GET',
      agent,
      headers:{'User-Agent':'Mozilla/5.0 HGhub Personal Web','Accept-Encoding':'identity',...options.headers},
      lookup:(_host,opts,cb)=>opts.all?cb(null,[address]):cb(null,address.address,address.family),
    }, res=>{
      const parts=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>64*1024*1024) res.destroy(new Error('��Ӧ����'));else parts.push(chunk);});
      res.on('end',()=>{agent?.destroy();ok({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)});});
      res.on('error',bad);
    });
    req.setTimeout(20000,()=>req.destroy(new Error('����ʱ'))); req.on('error',bad);
    if(options.body) req.write(options.body); req.end();
  });
  if ([301,302,303,307,308].includes(result.status)) {
    if (hop>=5 || options.method==='POST' || !result.headers.location) throw new Error('ҵ��ӿ��ض����Ѿܾ�');
    const next=new URL(result.headers.location,u);
    if(u.protocol==='https:' && next.protocol!=='https:') throw new Error('��ֹ HTTPS ����');
    return request(next.href,options,hop+1);
  }
  return result;
}
const fixed = config.fixed.map(([name,url])=>({name,url}));
export function newSession() { return {base:config.base,token:null,user:null,logEnabled:false,logs:[],expires:Date.now()+86400000}; }
async function edgeAttempt(s,method,path,body=null,auth=false) {
  if(auth && !s.token) throw new Error('���ȵ�¼');
  if((s.token || /\/account\/(login|register)/.test(path)) && !fixed.some(f=>f.url===s.base)) throw new Error('������·�����ο��������¼���л��̶���·');
  const envelope=JSON.stringify({method,path,body:body===null?'':Buffer.from(JSON.stringify(body)).toString('base64'),content_type:body===null?'':'application/json'});
  const r=await request(`${s.base}/api/edge/request`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Referer:s.base+'/',...(s.token?{Authorization:`Bearer ${s.token}`}:{})},body:envelope});
  if([401,403].includes(r.status)) throw new Error('401');
  if(r.status>=400) throw new Error(`HTTP ${r.status}`);
  const v=JSON.parse(r.body.toString());
  if(v===null) return null;
  if(v.status!==1) throw new Error(String(v.msg||'�ӿڷ���ʧ��').slice(0,140));
  return v.data??null;
}
export async function edge(s,method,path,body=null,auth=false) {
  const retry=method==='GET'||method==='POST'&&/\/(play|playback)(?:\?|$)/.test(path);
  for(let attempt=0;;attempt++){
    try{return await edgeAttempt(s,method,path,body,auth);}
    catch(e){
      const transient=/HTTP (?:408|425|429|5\d\d)|��ʱ|����ʧ��|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/.test(e.message);
      if(!retry||!transient||attempt>=2)throw e;
      await new Promise(ok=>setTimeout(ok,350*(attempt+1)));
    }
  }
}
const integer=(v,fallback=1)=>{const n=v===undefined?fallback:Number(v);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw new Error('������Ч');return n;};
const text=v=>{if(typeof v!=='string'||v.length>10000)throw new Error('������Ч');return v;};
const norm=v=>{if(v?.streams){v.video_url ||= v.streams.main||'';v.video_url_hevc ||= v.streams.hevc||'';}return v;};
function scrub(v) {
  return JSON.parse(JSON.stringify(v, (key,value)=> /url|token|password|cookie|authorization|body|message|src/i.test(key)?undefined:typeof value==='string'?(value.includes('://')?'[redacted]':value.slice(0,160)):value));
}
export async function dispatch(s,cmd,a={},send=edge) {
  const id=()=>integer(a.id),ep=()=>integer(a.ep),page=()=>integer(a.page),size=()=>Math.min(integer(a.size,20),100);
  const get=p=>send(s,'GET',p), post=(p,b=null,auth=false)=>send(s,'POST',p,b,auth);
  const action=p=>send(s,a.on?'POST':'DELETE',p,null,true);
  switch(cmd) {
    case 'app_boot':return {user:s.user,logged_in:!!s.token,base:s.base,strict_security:true,cli_relaxed:false};
    case 'api_feed':return get(`/api/videos?page=${page()}&size=${size()}`);
    case 'api_category':return get(`/api/videos/category/${encodeURIComponent(text(a.cate))}?page=${page()}&size=${size()}`);
    case 'api_rank':return get(`/api/ranks/${['recommend','potential'].includes(a.kind)?a.kind:'hot'}`);
    case 'api_search':return get(`/api/search?q=${encodeURIComponent(text(a.q))}&page=${page()}&size=${size()}`);
    case 'api_posts':return get(`/api/posts?page=${page()}&size=${size()}`);
    case 'api_post':return get(`/api/posts/${id()}`);
    case 'api_video':return get(`/api/videos/${id()}`);
    case 'api_play': {
      let primary,error;
      try{primary=norm(await post(`/api/videos/${id()}/episodes/${ep()}/playback`,{}));if(primary?.video_url)return primary;}catch(e){error=e;}
      try{const old=norm(await get(`/api/videos/${id()}/play?ep=${ep()}&page_texts=0`));return old?.video_url||error?old:primary;}catch(e){if(error)throw error;return primary;}
    }
    case 'api_comments':return get(`/api/videos/${id()}/comments?ep=${ep()}&page=${page()}&size=${size()}`);
    case 'api_post_comments':return get(`/api/posts/${id()}/comments?page=${page()}&size=${size()}`);
    case 'api_comment_send':return post(`/api/videos/${id()}/comments${a.replyId?'':`?ep=${ep()}`}`,{text:text(a.text),...(a.replyId?{reply_id:integer(a.replyId)}:{})},true);
    case 'api_like':return action(`/api/videos/${id()}/like?ep=${ep()}`);
    case 'api_collect':return action(`/api/videos/${id()}/collect`);
    case 'api_follow':return action(`/api/users/${integer(a.uid)}/follow`);
    case 'api_post_like':return action(`/api/posts/${id()}/like`);
    case 'api_post_collect':return action(`/api/posts/${id()}/collect`);
    case 'api_login':case 'api_register': {
      const origin=s.base;
      const b={username:text(a.username),password:text(a.password)};
      if(cmd==='api_register'){b.confirm_password=b.password;if(a.email)b.email=text(a.email);}
      const v=await post(`/api/account/${cmd==='api_login'?'loginByPassword':'registerByPassword'}`,b);
      if(!v?.token)throw new Error('��¼����ȱ�� token');
      if(s.base!==origin)throw new Error('��¼�ڼ���·�ѱ仯�������µ�¼');
      s.token=v.token;s.user=v.user??null;return {user:s.user};
    }
    case 'api_logout':try{await post('/api/account/logout');}finally{s.token=null;s.user=null;}return {ok:true};
    case 'api_me': {const origin=s.base;const me=await get('/api/account/me');if(origin!==s.base)throw new Error('��ȡ�ڼ���·�ѱ仯');s.user=me;return me;}
    case 'line_state':return {base:s.base,default:config.base,fixed};
    case 'line_set': {
      const {u}=await checkedTarget(text(a.url));
      if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash)throw new Error('��·��Ҫ�� HTTPS վ���ַ');
      if(s.base!==u.origin){s.token=null;s.user=null;s.base=u.origin;}return s.base;
    }
    case 'line_mirrors': {
      const html=(await request(config.publish)).body.toString();
      const script=new URL(/src="([^"]+\.js[^\"]*)"/.exec(html)?.[1]||'publish.js',config.publish).href;
      const js=(await request(script)).body.toString();
      const arr=name=>{const content=new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(js)?.[1]||'';return [...content.matchAll(/['"]([^'"\r\n]+)['"]/g)].map(m=>m[1]);};
      const domains=arr('urls'),subs=arr('subdomains');
      const items=[...new Set(domains.flatMap(d=>subs.length?subs.map(sub=>`${sub}.${d}`):[d]))].slice(0,60).map(host=>({host,url:`https://${host}`}));
      if(!items.length)throw new Error('��ַ����ҳ��ʽ�б仯');return {source:config.publish,script,items};
    }
    case 'line_probe': {
      if(!Array.isArray(a.urls)||a.urls.length>60)throw new Error('��·������Ч');
      const out=[];for(let i=0;i<a.urls.length;i+=6)out.push(...await Promise.all(a.urls.slice(i,i+6).map(async url=>{const t=Date.now();try{const r=await request(text(url));return {url,ok:r.status<400,status:r.status,ms:Date.now()-t};}catch{return {url,ok:false,error:'��·���ɴ�',ms:Date.now()-t};}})));return out;
    }
    case 'security_set':if(!a.strict)throw new Error('��ҳ�汣�����簲ȫ���');return true;
    case 'cache_clear':cache.clear();cacheBytes=0;return null;
    case 'check_update':return {current:config.version,latest:config.version,has_update:false,url:'https://github.com/skymellk-sudo/HGhub'};
    case 'net_diag':return {runtime:process.version,web:true,strict_security:true};
    case 'debug_log':return null;
    case 'playback_log_status':return {enabled:s.logEnabled,path:null,error:null};
    case 'playback_log_set':s.logEnabled=!!a.enabled;return {enabled:s.logEnabled,path:null,error:null};
    case 'playback_log_write':if(s.logEnabled){if(!Array.isArray(a.entries)||a.entries.length>128)throw new Error('��־������Ч');s.logs.push(...a.entries.map(e=>JSON.stringify(scrub(e)).slice(0,8192)));s.logs=s.logs.slice(-256);}return null;
    case 'playback_log_read':return s.logs.join('\n');
    default:throw new Error('��֧�ֵĲ���');
  }
}
export function rewritePlaylist(base,body) {
  return body.replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>{
    if(line.startsWith('#EXT-X-CONTENT-STEERING:'))return '';
    if(line.startsWith('#EXT-X-DATERANGE:'))return line.replace(/,(?:[^,=]*URI[^,=]*|X-ASSET-LIST)="[^"]*"/g,'');
    if(line.startsWith('#'))return line.replace(/URI="([^"]+)"/g,(_,uri)=>`URI="/media/seg?u=${encodeURIComponent(new URL(uri,base).href)}"`);
    return line.trim()?`/media/seg?u=${encodeURIComponent(new URL(line.trim(),base).href)}`:'';
  }).join('\n');
}
const cache=new Map();let cacheBytes=0;
const kind=b=>b[0]===255&&b[1]===216?'image/jpeg':b[0]===137&&b[1]===80?'image/png':b.subarray(0,4).toString()==='GIF8'?'image/gif':b.subarray(0,4).toString()==='RIFF'?'image/webp':null;
export async function media(route,target,s) {
  // Validate even cache hits; cached data cannot bypass current target checks.
  await checkedTarget(target);
  const key=`${s.base}|${route}|${target}`;const hit=cache.get(key);if(hit&&hit.expires>Date.now())return hit;
  const r=await request(target,{headers:{Referer:s.base+'/'}});if(r.status>=400)throw new Error(`HTTP ${r.status}`);
  let body=r.body,type=r.headers['content-type']||'application/octet-stream';
  if(route==='img'){
    if(!kind(body)){const d=createDecipheriv('aes-128-cbc',Buffer.from(config.imageKey),Buffer.from(config.imageIv));d.setAutoPadding(false);body=Buffer.concat([d.update(body),d.final()]);const n=body.at(-1);if(n>0&&n<=16&&body.subarray(-n).every(v=>v===n))body=body.subarray(0,-n);}
    type=kind(body);if(!type)throw new Error('�����ʽ��Ч');
  }else if(route==='hls'||/mpegurl/i.test(type)||body.subarray(0,10).toString().replace(/^\uFEFF/,'').startsWith('#EXTM3U')){
    const raw=body.toString();if(!raw.replace(/^\uFEFF/,'').startsWith('#EXTM3U'))throw new Error('�����б���ʽ��Ч');
    body=Buffer.from(rewritePlaylist(target,raw));type='application/vnd.apple.mpegurl';
  }
  const item={body,type,expires:Date.now()+60000};
  if(body.length<4*1024*1024){if(cache.size>=180||cacheBytes+body.length>64*1024*1024){cache.clear();cacheBytes=0;}const old=cache.get(key);if(old)cacheBytes-=old.body.length;cache.set(key,item);cacheBytes+=body.length;}
  return item;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
export function createWebServer({rpc=dispatch,mediaHandler=media,dist=resolve(root,'dist')}={}) {
  const sessions=new Map();
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    try{
      const host=req.headers.host||'';
      if(!/^[a-z0-9.\-\[\]:]+$/i.test(host))throw new Error('Host ��Ч');
      const u=new URL(req.url,`http://${host}`);
      const allowedHosts=['127.0.0.1','localhost','[::1]', ...(process.env.PUBLIC_ORIGIN?[new URL(process.env.PUBLIC_ORIGIN).hostname]:[])];
      if(!allowedHosts.includes(u.hostname)){res.writeHead(403);res.end('host denied');return;}
      if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin && ![`http://${host}`,`https://${host}`,process.env.PUBLIC_ORIGIN].filter(Boolean).includes(req.headers.origin)) {res.writeHead(403);res.end('origin denied');return;}
      let sid=/\bhghub_session=([a-f0-9]{48})\b/.exec(req.headers.cookie||'')?.[1];
      let s=sessions.get(sid);
      if(!s||s.expires<Date.now()){
        for(const [id,item] of sessions)if(item.expires<Date.now())sessions.delete(id);
        if(sessions.size>=1000){res.writeHead(503);res.end('session limit');return;}
        sid=randomBytes(24).toString('hex');s=newSession();sessions.set(sid,s);
        res.setHeader('Set-Cookie',`hghub_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
      }
      if(u.pathname==='/rpc'){
        if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(405);res.end();return;}
        const chunks=[];let count=0;for await(const c of req){count+=c.length;if(count>1024*1024){res.writeHead(413);res.end();return;}chunks.push(c);}
        const {command,args}=JSON.parse(Buffer.concat(chunks).toString());
        const result=await rpc(s,command,args);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));return;
      }
      if(u.pathname.startsWith('/media/')){
        if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
        const route=u.pathname.slice(7);if(!['img','hls','seg'].includes(route)){res.writeHead(404);res.end();return;}
        const {body,type}=await mediaHandler(route,u.searchParams.get('u')||'',s);
        res.setHeader('Content-Type',type);res.setHeader('Accept-Ranges','bytes');
        let data=body,status=200;
        if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);let start=m&&m[1]?Number(m[1]):0,end=m&&m[2]?Number(m[2]):body.length-1;if(m&&!m[1]&&m[2]){start=Math.max(0,body.length-Number(m[2]));end=body.length-1;}end=Math.min(end,body.length-1);if(!m||start>end||start>=body.length){res.writeHead(416,{'Content-Range':`bytes */${body.length}`});res.end();return;}data=body.subarray(start,end+1);status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${body.length}`);}
        res.writeHead(status,{'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      let path=resolve(dist,'.'+decodeURIComponent(u.pathname));
      if(!path.startsWith(dist+sep)&&path!==dist){res.writeHead(403);res.end();return;}
      try{if(!(await stat(path)).isFile())path=resolve(dist,'index.html');}catch{if(extname(path)){res.writeHead(404);res.end();return;}path=resolve(dist,'index.html');}
      const body=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.setHeader('Content-Length',body.length);res.end(req.method==='HEAD'?undefined:body);
    }catch(e){if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e.message||'����ʧ��').slice(0,160)}));}else res.destroy();}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
  createWebServer().listen(port,host,()=>console.log(`HGhub Web: http://${host}:${port}`));
}
