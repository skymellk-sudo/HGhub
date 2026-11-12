import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createWebServer } from '../web/server.mjs';
const server=createWebServer();
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const report={desktop:{},mobile:{}};
try{
  for(const mode of ['desktop','mobile']){
    const page=await browser.newPage(mode==='mobile'?{viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',isMobile:true,hasTouch:true}:{viewport:{width:1280,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const boot=page.waitForResponse(r=>r.url().endsWith('/rpc')&&r.request().postDataJSON()?.command==='app_boot');
    await page.goto(base,{waitUntil:'domcontentloaded'});
    assert.equal((await boot).status(),200);
    const searchButton=page.getByRole('button',{name:'����',exact:true}).first();
    await searchButton.click();
    await page.getByPlaceholder('�����̾硢���ߡ���ġ�').waitFor({state:'visible'});
    await page.getByRole('button',{name:'����',exact:true}).click();
    await page.getByText('����',{exact:true}).first().waitFor({state:'visible'});
    await page.getByRole('button',{name:'�ҵ�',exact:true}).click();
    await page.getByRole('button',{name:/δ��¼/}).first().click();
    await page.getByPlaceholder('�˺�',{exact:true}).waitFor({state:'visible'});
    assert.equal(errors.length,0,errors.join('\n'));
    report[mode]={boot:true,search:true,category:true,profile:true,loginForm:true,pageErrors:errors};
    await page.close();
  }
  console.log(JSON.stringify(report));
}finally{await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));}
