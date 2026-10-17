import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import app from '../worker/index';
import { authenticate } from '../worker/auth';
import { isListsRequest } from '../worker/webhook';

const TOKEN='123456:test-token-only';
const groupA='a0000000-0000-4000-8000-000000000001';
const groupB='b0000000-0000-4000-8000-000000000001';
const listId='c0000000-0000-4000-8000-000000000001';
const secondId='c0000000-0000-4000-8000-000000000002';
let mf: Miniflare;
let env: Env;
let statuses: Map<string,string>;
let calls: { method:string; data:Record<string,unknown> }[];
const ctx={waitUntil:vi.fn(),passThroughOnException:vi.fn(),props:{}};

function signed(user=10,start=`g_${groupA}`,authDate=Math.floor(Date.now()/1000),extra:Record<string,string>={}) {
  const params=new URLSearchParams({ auth_date:String(authDate),user:JSON.stringify({id:user,first_name:`Usuario ${user}`}),start_param:start,...extra });
  const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();
  const data=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
  params.set('hash',createHmac('sha256',secret).update(data).digest('hex'));
  return params.toString();
}
async function request(path:string,method='GET',body?:unknown,user=10,start=`g_${groupA}`) {
  return app.request(`https://app.test${path}`,{method,headers:{Authorization:`tma ${signed(user,start)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env,ctx);
}
async function create(id=listId,user=10) {
  return request('/api/lists','POST',{group_id:groupA,title:'Cena de hoy',request_id:id},user);
}
async function webhook(update:unknown,secret='webhook-test') {
  return app.request('https://app.test/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(update)},env,ctx);
}

beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-17',d1Databases:['DB']}));
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort()) {
    const migration=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');
    for(const sql of migration.split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  const config: {vars:Pick<Env,'BOT_USERNAME'|'APP_URL'|'PIN_MESSAGES'>}=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  env={...config.vars,DB:db,BOT_TOKEN:TOKEN,WEBHOOK_SECRET:'webhook-test',ASSETS:{fetch:async()=>new Response('asset'),connect:()=>{throw new Error('Unused test binding');}}};
},30000);
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
  await env.DB.batch([env.DB.prepare('DELETE FROM orders'),env.DB.prepare('DELETE FROM lists'),env.DB.prepare('DELETE FROM groups')]);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO groups(id,telegram_chat_id,title,bot_is_admin) VALUES(?,?,?,1)').bind(groupA,'-100123','Grupo A'),
    env.DB.prepare('INSERT INTO groups(id,telegram_chat_id,title,bot_is_admin) VALUES(?,?,?,1)').bind(groupB,'-100456','Grupo B'),
  ]);
  statuses=new Map([['-100123:10','administrator'],['-100123:20','member'],['-100123:30','left'],['-100456:10','administrator']]);
  calls=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
    const method=url.slice(url.lastIndexOf('/')+1);
    const data=JSON.parse(String(options.body)) as Record<string,unknown>;
    calls.push({method,data});
    if(method==='getChatMember')return Response.json({ok:true,result:{status:statuses.get(`${data.chat_id}:${data.user_id}`)??'left'}});
    return Response.json({ok:true,result:{message_id:99}});
  }));
});
afterEach(()=>{vi.unstubAllGlobals();});

describe('Telegram authentication',()=>{
  it('validates signature, including new signature field, and extracts server identity',async()=>{
    expect((await authenticate(signed(10,`g_${groupA}`,undefined,{signature:'example-ed25519'}),TOKEN)).user.id).toBe(10);
  });
  it('rejects tampering, expired and future data, duplicate keys and malformed users',async()=>{
    await expect(authenticate(signed().replace('Usuario','Intruso'),TOKEN)).rejects.toThrow();
    await expect(authenticate(signed(10,'',Math.floor(Date.now()/1000)-3601),TOKEN)).rejects.toThrow('caducado');
    await expect(authenticate(signed(10,'',Math.floor(Date.now()/1000)+120),TOKEN)).rejects.toThrow();
    await expect(authenticate(signed()+'&auth_date=1',TOKEN)).rejects.toThrow();
    await expect(authenticate(signed(10,'',undefined,{user:'null'}),TOKEN)).rejects.toThrow();
  });
  it('rejects missing auth and invalid JSON without leaking implementation errors',async()=>{
    expect((await app.request('https://app.test/api/session',{},env,ctx)).status).toBe(401);
    const response=await app.request('https://app.test/api/lists',{method:'POST',headers:{Authorization:`tma ${signed()}`,'Content-Type':'application/json'},body:'{'},env,ctx);
    expect(response.status).toBe(400);
  });
});

describe('Lists, membership and SQL',()=>{
  it('creates and publishes to the webhook-registered chat, never a client chat ID',async()=>{
    const response=await create();expect(response.status).toBe(201);
    const data=await response.json() as {list:{group_id:string};published:boolean};
    expect(data.list.group_id).toBe(groupA);expect(data.published).toBe(true);
    expect(calls.find(x=>x.method==='sendMessage')?.data.chat_id).toBe('-100123');
    expect((await request('/api/lists','POST',{group_id:groupA,title:'x',request_id:secondId,chat_id:'-100456'})).status).toBe(400);
  });
  it('rejects creating lists as an ordinary member',async()=>{expect((await create(listId,20)).status).toBe(403);});
  it('makes retries idempotent and enforces a single primary',async()=>{
    await create();await create(secondId);await create();
    expect(calls.filter(x=>x.method==='sendMessage')).toHaveLength(2);
    const primary=await env.DB.prepare('SELECT id FROM lists WHERE group_id=? AND is_primary=1').bind(groupA).first<{id:string}>();
    expect(primary?.id).toBe(secondId);
  });
  it('allows adding, updating and deleting only your own order',async()=>{
    await create();
    expect((await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Pizza'},20)).status).toBe(200);
    await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Ensalada'},20);
    await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Hamburguesa'},10);
    const rows=await env.DB.prepare('SELECT * FROM orders WHERE list_id=?').bind(listId).all();expect(rows.results).toHaveLength(2);
    expect(rows.results.find(x=>x.telegram_user_id==='20')?.content).toBe('Ensalada');
    expect((await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Hack',telegram_user_id:20},10)).status).toBe(400);
    expect((await request(`/api/lists/${listId}/orders/20`,'PUT',{content:'Hack'},10)).status).toBe(404);
    await request(`/api/lists/${listId}/my-order`,'DELETE',undefined,10);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE telegram_user_id=?').bind('20').first('n')).toBe(1);
  });
  it('rejects nonmembers and cross-group access even when the caller administers both groups',async()=>{
    await create();
    expect((await request(`/api/lists/${listId}`,'GET',undefined,30)).status).toBe(403);
    expect((await request(`/api/lists/${listId}`,'GET',undefined,10,`g_${groupB}`)).status).toBe(403);
    expect((await request(`/api/groups/${groupB}/lists`)).status).toBe(403);
    expect((await request(`/api/lists/${listId}`,'GET',undefined,20,`l_${listId}`)).status).toBe(200);
    statuses.set('-100123:20','left');
    expect((await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Pizza'},20)).status).toBe(403);
  });
  it('requires bot administration for reliable membership checking',async()=>{
    await env.DB.prepare('UPDATE groups SET bot_is_admin=0 WHERE id=?').bind(groupA).run();
    expect((await create()).status).toBe(403);
  });
  it('only creator/admin closes; closed lists are read-only and remain in history',async()=>{
    await create();await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Pizza'},20);
    expect((await request(`/api/lists/${listId}/close`,'POST',undefined,20)).status).toBe(403);
    statuses.set('-100123:10','member'); // The original creator may still close after demotion.
    expect((await request(`/api/lists/${listId}/close`,'POST')).status).toBe(200);
    expect((await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Otra cosa'},20)).status).toBe(409);
    expect((await request(`/api/lists/${listId}/my-order`,'DELETE',undefined,20)).status).toBe(409);
    expect((await request(`/api/lists/${listId}/orders`,'GET',undefined,20)).status).toBe(200);
    const history=await (await request(`/api/groups/${groupA}/lists`)).json() as {lists:{status:string}[]};expect(history.lists[0].status).toBe('closed');
  });
  it('enforces deadlines inside the mutation SQL, not just the preflight check',async()=>{
    await create();await env.DB.prepare('UPDATE lists SET deadline=? WHERE id=?').bind('2000-01-01T00:00:00.000Z',listId).run();
    expect((await request(`/api/lists/${listId}/my-order`,'PUT',{content:'Tarde'},20)).status).toBe(409);
    expect(await env.DB.prepare('SELECT status FROM lists WHERE id=?').bind(listId).first('status')).toBe('closed');
  });
  it('keeps SQL injection strings as data and enforces database uniqueness/foreign keys',async()=>{
    await create();await request(`/api/lists/${listId}/my-order`,'PUT',{content:"'); DROP TABLE lists; --"},20);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM lists').first('n')).toBe(1);
    await expect(env.DB.prepare('INSERT INTO orders(id,list_id,telegram_user_id,display_name,content) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),listId,'20','Nombre','Otro').run()).rejects.toThrow();
    await expect(env.DB.prepare('INSERT INTO orders(id,list_id,telegram_user_id,display_name,content) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),secondId,'20','Nombre','Otro').run()).rejects.toThrow();
    const plan=await env.DB.prepare('EXPLAIN QUERY PLAN SELECT * FROM orders WHERE list_id=? ORDER BY created_at,id LIMIT 500').bind(listId).all();
    expect(JSON.stringify(plan.results)).toContain('orders_list_created');
  });
  it('records publication failure and permits an explicit retry',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/sendMessage')?Response.json({ok:false,error_code:403},{status:403}):Response.json({ok:true,result:{status:'administrator'}})));
    const response=await create();expect(response.status).toBe(201);expect((await response.json() as {published:boolean}).published).toBe(false);
    expect(await env.DB.prepare('SELECT publish_state FROM lists WHERE id=?').bind(listId).first('publish_state')).toBe('failed');
  });
});

describe('Webhook group association',()=>{
  it('rejects unsigned webhook calls and registers an opaque group from a Telegram update',async()=>{
    const update={update_id:100,my_chat_member:{date:1000,chat:{id:-789,type:'group',title:'Cena'},old_chat_member:{status:'left'},new_chat_member:{status:'administrator'}}};
    expect((await webhook(update,'wrong')).status).toBe(401);
    expect((await webhook(update)).status).toBe(200);
    const group=await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind('-789').first<{id:string;bot_is_admin:number}>();
    expect(group?.id).toMatch(/^[0-9a-f-]{36}$/);expect(group?.bot_is_admin).toBe(1);
    await webhook(update);expect(calls.filter(x=>x.method==='sendMessage')).toHaveLength(2);
  });
  it('accepts reset update IDs after inactivity and rejects older membership events',async()=>{
    const event={date:1000,chat:{id:-789,type:'group',title:'Cena'},old_chat_member:{status:'member'},new_chat_member:{status:'administrator'}};
    await webhook({update_id:9000,my_chat_member:event});
    await webhook({update_id:10,my_chat_member:{...event,date:1000+8*86400,new_chat_member:{status:'member'}}});
    await webhook({update_id:9001,my_chat_member:{...event,date:1001}});
    expect(await env.DB.prepare('SELECT bot_is_admin FROM groups WHERE telegram_chat_id=?').bind('-789').first('bot_is_admin')).toBe(0);
  });
  it('preserves list associations when a group migrates to a supergroup',async()=>{
    await create();
    const migration={update_id:101,message:{chat:{id:-100123,type:'group',title:'Nuevo'},migrate_to_chat_id:-100999}};
    expect((await webhook(migration)).status).toBe(200);
    expect(await env.DB.prepare('SELECT telegram_chat_id FROM groups WHERE id=?').bind(groupA).first('telegram_chat_id')).toBe('-100999');
    expect(await env.DB.prepare('SELECT group_id FROM lists WHERE id=?').bind(listId).first('group_id')).toBe(groupA);
    await webhook(migration); // Duplicate migrations are harmless.
  });
  it('provides the persistent group keyboard and a group-scoped launch link from the command menu',async()=>{
    expect((await webhook({update_id:200,message:{chat:{id:-100123,type:'supergroup'},text:'/listas'}})).status).toBe(200);
    const sent=calls.filter(x=>x.method==='sendMessage');
    expect(sent).toHaveLength(2);
    expect(sent[0].data.reply_markup).toMatchObject({keyboard:[[{text:'📋 Listas'}]],is_persistent:true,one_time_keyboard:false});
    expect(sent[1].data.text).toBe('\u2063');
    expect(JSON.stringify(sent[1].data.reply_markup)).toContain(`startapp=g_${groupA}`);
    calls=[];
    await webhook({update_id:201,message:{chat:{id:-100123,type:'supergroup'},text:'📋 Listas'}});
    expect(calls.filter(x=>x.method==='sendMessage')).toHaveLength(1);
    expect(calls.find(x=>x.method==='sendMessage')?.data.text).toBe('\u2063');
  });
  it('ignores commands addressed to other bots, bot messages and unrelated group text',async()=>{
    expect(isListsRequest('/listas@another_bot',env.BOT_USERNAME)).toBe(false);
    expect(isListsRequest(`/listas@${env.BOT_USERNAME}`,env.BOT_USERNAME)).toBe(true);
    for(const message of [{text:'/listas@another_bot'},{text:'hola'},{text:'📋 Listas',from:{is_bot:true}}]) {
      await webhook({update_id:202,message:{chat:{id:-100123,type:'supergroup'},...message}});
    }
    expect(calls.filter(x=>x.method==='sendMessage')).toHaveLength(0);
  });
});
