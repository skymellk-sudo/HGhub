import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';

function detectProxy() {
  if(process.env.HGHUB_PROXY) return process.env.HGHUB_PROXY;
  if(process.platform!=='win32') return null;
  try {
    const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled=execFileSync('reg.exe',['query',key,'/v','ProxyEnable'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']});
    if(!/REG_DWORD\s+0x1\b/.test(enabled)) return null;
    const value=execFileSync('reg.exe',['query',key,'/v','ProxyServer'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).match(/REG_SZ\s+(.+)/)?.[1]?.trim();
    const server=value?.includes('=')?(value.match(/(?:^|;)https=([^;]+)/)?.[1]||value.match(/(?:^|;)http=([^;]+)/)?.[1]):value;
    return server?'http://'+server:null;
  }catch{return null;}
}
export const proxyUrl=detectProxy();
export function proxyAgent(host,address) {
  if(!proxyUrl) return undefined;
  const proxy=new URL(proxyUrl);
  if(proxy.protocol!=='http:')throw new Error('HGHUB_PROXY ��Ҫ HTTP CONNECT ����');
  const agent=new https.Agent({keepAlive:false});
  agent.createConnection=(_options,callback)=>{
    const req=http.request({host:proxy.hostname,port:proxy.port||80,method:'CONNECT',path:`${address.includes(':')?'['+address+']':address}:443`,headers:{Host:`${host}:443`,...(proxy.username?{'Proxy-Authorization':'Basic '+Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}:{})}});
    req.setTimeout(10000,()=>req.destroy(new Error('�������ӳ�ʱ')));
    req.on('error',()=>callback(new Error('��������ʧ��')));
    req.on('connect',(res,socket,head)=>{
      if(res.statusCode!==200){socket.destroy();callback(new Error('�����ܾ�����'));return;}
      if(head.length)socket.unshift(head);
      const secured=tls.connect({socket,servername:host,rejectUnauthorized:true});
      secured.once('secureConnect',()=>callback(null,secured));secured.once('error',()=>callback(new Error('TLS ����ʧ��')));
    });req.end();
  };
  return agent;
}
export async function publicDns(host) {
  // Query a fixed public resolver through the user's proxy, then pin the checked IP
  // in CONNECT. This handles fake-IP DNS without allowing private destinations.
  return new Promise((ok,bad)=>{
    const agent=proxyAgent('cloudflare-dns.com','1.1.1.1');
    const req=https.get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,{agent,headers:{Accept:'application/dns-json'}},res=>{
      let text='';res.on('data',b=>{text+=b;if(text.length>65536)res.destroy();});
      res.on('error',bad);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('DNS ��ѯʧ��');const v=JSON.parse(text);ok((v.Answer||[]).filter(x=>x.type===1).map(x=>({address:x.data,family:4})));}catch{bad(new Error('���� DNS ��ѯʧ��'));}agent?.destroy();});
    });req.setTimeout(12000,()=>req.destroy(new Error('DNS ��ѯ��ʱ')));req.on('error',bad);
  });
}
