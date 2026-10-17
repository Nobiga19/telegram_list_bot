import { readFile } from 'node:fs/promises';

// Credentials come only from environment or an ignored .dev.vars file, never CLI arguments.
const local=await readFile(new URL('../.dev.vars',import.meta.url),'utf8').catch(()=> '');
const values=Object.fromEntries(local.split(/\r?\n/).filter(x=>x && !x.startsWith('#')).map(line=>{const p=line.indexOf('=');return [line.slice(0,p),line.slice(p+1).replace(/^"|"$/g,'')];}));
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const token=process.env.BOT_TOKEN ?? values.BOT_TOKEN;
const secret=process.env.WEBHOOK_SECRET ?? values.WEBHOOK_SECRET;
const appUrl=process.env.APP_URL ?? config.vars.APP_URL;
if(!token || !secret || !appUrl.startsWith('https://'))throw new Error('Configura BOT_TOKEN, WEBHOOK_SECRET y APP_URL.');
async function call(method,body={}) {
  let response;
  try {response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
  catch {throw new Error(`Telegram no responde (${method}).`);}
  const data=await response.json();
  if(!data.ok)throw new Error(`Telegram ha rechazado ${method} (código ${data.error_code}).`);
  return data.result;
}
const bot=await call('getMe');
const existing=await call('getWebhookInfo');
if(existing.url && existing.url!==`${appUrl}/telegram/webhook`)throw new Error('El bot ya usa otro webhook. Revisa la configuración antes de sustituirlo.');
await call('setWebhook',{url:`${appUrl}/telegram/webhook`,secret_token:secret,allowed_updates:['my_chat_member','message'],max_connections:1});
await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Abrir',web_app:{url:appUrl}}});
for (const language_code of ['', 'es']) {
  await call('setMyName',{name:'Listas',language_code});
  await call('setMyCommands',{scope:{type:'all_group_chats'},language_code,commands:[{command:'listas',description:'Mostrar el acceso a las listas del grupo'}]});
}
await call('setMyDescription',{description:'Crea listas compartidas para tu grupo. Cada persona añade y modifica su pedido; todos pueden consultar la lista.',language_code:'es'});
await call('setMyShortDescription',{short_description:'Listas y pedidos compartidos para tu grupo.',language_code:'es'});
const info=await call('getWebhookInfo');
console.log(JSON.stringify({bot_username:bot.username,webhook_url:info.url,pending_updates:info.pending_update_count,webhook_error:info.last_error_message ?? null},null,2));
