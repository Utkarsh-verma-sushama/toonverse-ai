import {chromium} from 'playwright';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,stat,chmod} from 'node:fs/promises';
import {createBrotliDecompress} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function browser(){
 // Use the versioned npm binary so tests do not depend on a second CDN download.
 // Avoid archive ownership changes in managed/container execution environments.
 const dir=join(tmpdir(),'uvenaro-browser-153'),path=join(dir,'chromium');await mkdir(dir,{recursive:true});
 if((await stat(path).catch(()=>null))?.size<100000000||!await stat(path).catch(()=>null)){
  await pipeline(createReadStream(new URL('../node_modules/@sparticuz/chromium/bin/chromium.br',import.meta.url)),createBrotliDecompress(),createWriteStream(path,{mode:0o700}));await chmod(path,0o700);
 }
 return chromium.launch({executablePath:path,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer'],headless:true});
}
