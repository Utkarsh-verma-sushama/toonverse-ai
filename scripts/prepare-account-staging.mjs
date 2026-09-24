import {mkdir,readFile,writeFile,copyFile,readdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildStaging(destination=resolve(root,'.account-staging')){
 const publicDir=resolve(destination,'public'),migrations=resolve(destination,'migrations');
 await rm(publicDir,{recursive:true,force:true});await rm(migrations,{recursive:true,force:true});
 await mkdir(publicDir,{recursive:true});await mkdir(migrations,{recursive:true});
 const files=['account.html','assets/js/config.js','assets/js/auth.js','assets/js/account-ui.js','assets/js/platform-runtime.js','assets/uvenaro-icon.svg'];
 for(const file of files){
  const target=resolve(publicDir,file);await mkdir(dirname(target),{recursive:true});let source=await readFile(resolve(root,file),'utf8');
  if(file==='account.html')source=source.replaceAll('href="./index.html"','href="https://uvenaro.com/"').replace('<section class="hero">','<p class="notice" role="status">Uvenaro account test — invited testers only. Use a dedicated test account.</p><section class="hero">').replace('<link rel="manifest" href="./manifest.webmanifest">','');
  if(file==='assets/js/config.js'){
   for(const needle of ['apiBaseUrl: ""','authentication: false','environment: "production"'])if(!source.includes(needle))throw new Error('Frontend config contract changed');
   source=source.replace('apiBaseUrl: ""','apiBaseUrl: location.origin + "/api"').replace('authentication: false','authentication: true').replace('environment: "production"','environment: "staging"');
  }
  if(file==='assets/js/account-ui.js')source=source.replace("if('serviceWorker' in navigator)","if(false)");
  await writeFile(target,source);
 }
 await writeFile(resolve(publicDir,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uvenaro account test</title><h1>Uvenaro account test</h1><p>Invited testers only. Use a dedicated test account.</p><a href="/account.html">Open account test</a></html>');
 await copyFile(resolve(root,'backend/schema.sql'),resolve(migrations,'0000_baseline.sql'));
 for(const file of (await readdir(resolve(root,'backend/migrations'))).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort())await copyFile(resolve(root,'backend/migrations',file),resolve(migrations,file));
 return {publicDir,migrations};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await buildStaging();console.log('Built isolated account assets and ordered staging migrations. No remote changes.');}
