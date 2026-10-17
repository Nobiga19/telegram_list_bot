import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AppError, authenticate, type Identity } from './auth';
import { access, getList, launchGroup, opaque, textInput, writable, type List, type Order } from './model';
import { launchLink, telegram, type TelegramMessage } from './telegram';
import { handleWebhook } from './webhook';

type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
type Ctx = Context<AppEnv>;
const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});
app.use('*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Solicitud demasiado grande.' }, 413) }));

app.get('/api/health', c => c.json({ ok: true, service: 'telegram-group-lists' }));
app.post('/telegram/webhook', c => handleWebhook(c.req.raw, c.env));
app.use('/api/*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? '';
  if (!auth.startsWith('tma ')) throw new AppError(401, 'Abre la aplicación desde Telegram.');
  c.set('identity', await authenticate(auth.slice(4), c.env.BOT_TOKEN));
  await next();
});

async function json(c: Ctx, allowed: string[]): Promise<Record<string, unknown>> {
  if (!c.req.header('Content-Type')?.includes('application/json')) throw new AppError(400, 'Se requiere JSON.');
  let data: unknown;
  try { data = await c.req.json(); } catch { throw new AppError(400, 'Solicitud no válida.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'Campos no válidos.');
  }
  return data as Record<string, unknown>;
}

async function listAccess(c: Ctx) {
  const list = await getList(c.env, c.req.param('id')!);
  const identity = c.get('identity');
  return { list, identity, ...await access(c.env, identity, list.group_id) };
}

async function view(c: Ctx, list: List, admin: boolean) {
  // The list has a hard 500-order cap: every response and query remains bounded.
  const orders = await c.env.DB.prepare('SELECT * FROM orders WHERE list_id=? ORDER BY created_at,id LIMIT 500').bind(list.id).all<Order>();
  return {
    list: { ...list, can_delete: admin, can_close: writable(list) && (admin || list.created_by === String(c.get('identity').user.id)), writable: writable(list) },
    orders: orders.results,
  };
}

app.get('/api/session', async c => {
  const identity = c.get('identity');
  const group = await launchGroup(c.env, identity);
  if (!group) {
    if (identity.startParam) throw new AppError(404, 'Este enlace ya no está disponible. Abre el mensaje del grupo.');
    return c.json({ user: identity.user, group: null, bot_username: c.env.BOT_USERNAME });
  }
  const { admin } = await access(c.env, identity, group.id);
  const listId = identity.startParam.startsWith('l_')
    ? await c.env.DB.prepare('SELECT id FROM lists WHERE id=? AND deleted_at IS NULL').bind(identity.startParam.slice(2)).first<string>('id') : null;
  return c.json({ user: identity.user, group: { id: group.id, title: group.title }, admin,
    list_id: listId, list_deleted: identity.startParam.startsWith('l_') && !listId,
    bot_username: c.env.BOT_USERNAME });
});

app.get('/api/lists/:id', async c => {
  const { list, admin } = await listAccess(c);
  return c.json(await view(c, list, admin));
});
app.get('/api/lists/:id/orders', async c => {
  const { list, admin } = await listAccess(c);
  return c.json(await view(c, list, admin));
});

app.get('/api/groups/:id/lists', async c => {
  const groupId = c.req.param('id');
  const { group, admin } = await access(c.env, c.get('identity'), groupId);
  const beforeId = c.req.query('before');
  let before: List | null = null;
  if (beforeId) {
    if (!opaque(beforeId)) throw new AppError(400, 'Página no válida.');
    before = await c.env.DB.prepare('SELECT * FROM lists WHERE id=? AND group_id=?').bind(beforeId, groupId).first<List>();
    if (!before) throw new AppError(400, 'Página no válida.');
  }
  const now = new Date().toISOString();
  const query = `SELECT id,title,description,CASE WHEN status='open' AND deadline IS NOT NULL AND deadline<=? THEN 'closed' ELSE status END AS status,
    CASE WHEN deadline IS NOT NULL AND deadline<=? THEN 0 ELSE is_primary END AS is_primary,created_at,deadline
    FROM lists WHERE group_id=? AND deleted_at IS NULL ${before ? 'AND (created_at,id) < (?,?)' : ''} ORDER BY created_at DESC,id DESC LIMIT 51`;
  const args = before ? [now,now,groupId,before.created_at,before.id] : [now,now,groupId];
  const result = await c.env.DB.prepare(query).bind(...args).all<List>();
  return c.json({ group: { id: group.id, title: group.title }, admin, lists: result.results.slice(0,50),
    next_cursor: result.results.length > 50 ? result.results[49].id : null });
});

async function publish(c: Ctx, list: List, chatId: string): Promise<boolean> {
  if (list.publish_state === 'sent') return true;
  if (!writable(list)) return false;
  const claimed = await c.env.DB.prepare(`UPDATE lists SET publish_state='sending',publish_started_at=? WHERE id=? AND deleted_at IS NULL AND
    (publish_state IN ('pending','failed') OR (publish_state='sending' AND publish_started_at < ?))`)
    .bind(Date.now(),list.id,Date.now()-60000).run();
  if (!claimed.meta.changes) return false;
  let message: TelegramMessage;
  try {
    message = await telegram<TelegramMessage>(c.env,'sendMessage',{
      chat_id: chatId, text: `${list.title}\nLista abierta${list.description ? `\n${list.description}` : ''}`,
      reply_markup: { inline_keyboard: [[{ text: 'Abrir lista', url: launchLink(c.env,`l_${list.id}`) }]] },
    });
  } catch {
    await c.env.DB.prepare("UPDATE lists SET publish_state='failed' WHERE id=?").bind(list.id).run();
    return false;
  }
  await c.env.DB.prepare("UPDATE lists SET message_id=?,publish_state='sent' WHERE id=?").bind(message.message_id,list.id).run();
  if (String(c.env.PIN_MESSAGES) === 'true') c.executionCtx.waitUntil(telegram(c.env,'pinChatMessage',{
    chat_id:chatId,message_id:message.message_id,disable_notification:true,
  }).catch(() => undefined));
  return true;
}

app.post('/api/lists', async c => {
  const data = await json(c,['group_id','title','description','deadline','request_id']);
  if (!opaque(data.group_id) || !opaque(data.request_id)) throw new AppError(400, 'Grupo o solicitud no válidos.');
  const identity = c.get('identity');
  const { group, admin } = await access(c.env,identity,data.group_id);
  if (!admin) throw new AppError(403,'Solo los administradores del grupo pueden crear listas.');
  const title = textInput(data.title,'Título',100);
  const description = textInput(data.description,'Descripción',500,false);
  let deadline: string | null = null;
  if (data.deadline !== undefined && data.deadline !== null && data.deadline !== '') {
    if (typeof data.deadline !== 'string' || !Number.isFinite(Date.parse(data.deadline)) || Date.parse(data.deadline)<=Date.now()) throw new AppError(400,'La fecha límite debe estar en el futuro.');
    deadline = new Date(data.deadline).toISOString();
  }
  let list = await c.env.DB.prepare('SELECT * FROM lists WHERE id=?').bind(data.request_id).first<List>();
  if (list?.deleted_at) throw new AppError(409,'Esta lista ha sido eliminada. Abre de nuevo el formulario.');
  if (list && (list.group_id !== group.id || list.created_by !== String(identity.user.id) || list.title !== title || list.description !== description || list.deadline !== deadline)) throw new AppError(409,'Solicitud ya utilizada. Abre de nuevo el formulario.');
  if (!list) {
    // D1 batch is a transaction; retries never demote the current primary list.
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE lists SET is_primary=0 WHERE group_id=? AND is_primary=1 AND NOT EXISTS(SELECT 1 FROM lists WHERE id=?)').bind(group.id,data.request_id),
      c.env.DB.prepare('INSERT INTO lists(id,group_id,title,description,created_by,deadline) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
        .bind(data.request_id,group.id,title,description,String(identity.user.id),deadline),
    ]);
    list = await getList(c.env,data.request_id);
    if (list.group_id !== group.id || list.created_by !== String(identity.user.id) || list.title !== title || list.description !== description || list.deadline !== deadline) throw new AppError(409,'Solicitud ya utilizada. Abre de nuevo el formulario.');
  }
  const published = await publish(c,list,group.telegram_chat_id);
  return c.json({ ...await view(c,await getList(c.env,list.id),admin), published,
    warning: published ? null : 'Lista guardada. No se ha confirmado la publicación en el grupo; puedes reintentar con «Publicar en el grupo».' },201);
});

app.post('/api/lists/:id/publish', async c => {
  const { list, admin, group } = await listAccess(c);
  if (!admin) throw new AppError(403,'Solo los administradores pueden publicar listas.');
  const published = await publish(c,list,group.telegram_chat_id);
  return c.json({ ...await view(c,await getList(c.env,list.id),admin), published });
});

app.put('/api/lists/:id/my-order', async c => {
  const data = await json(c,['content']);
  const { list, identity, admin } = await listAccess(c);
  if (!writable(list)) throw new AppError(409,'La lista está cerrada.');
  const content = textInput(data.content,'Mi aportación',1000);
  const name = [identity.user.first_name,identity.user.last_name].filter(Boolean).join(' ').slice(0,120);
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(`INSERT INTO orders(id,list_id,telegram_user_id,display_name,content)
    SELECT ?,id,?,?,? FROM lists WHERE id=? AND deleted_at IS NULL AND status='open' AND (deadline IS NULL OR deadline>?)
    AND ((SELECT COUNT(*) FROM orders WHERE list_id=?) < 500 OR EXISTS(SELECT 1 FROM orders WHERE list_id=? AND telegram_user_id=?))
    ON CONFLICT(list_id,telegram_user_id) DO UPDATE SET display_name=excluded.display_name,content=excluded.content,updated_at=?`)
    .bind(crypto.randomUUID(),String(identity.user.id),name,content,list.id,now,list.id,list.id,String(identity.user.id),now).run();
  if (!result.meta.changes) throw new AppError(409,'Lista cerrada o límite de 500 aportaciones alcanzado.');
  return c.json(await view(c,await getList(c.env,list.id),admin));
});

app.delete('/api/lists/:id/my-order', async c => {
  const { list, identity, admin } = await listAccess(c);
  if (!writable(list)) throw new AppError(409,'La lista está cerrada.');
  const result = await c.env.DB.prepare(`DELETE FROM orders WHERE list_id=? AND telegram_user_id=? AND EXISTS(
    SELECT 1 FROM lists WHERE id=? AND deleted_at IS NULL AND status='open' AND (deadline IS NULL OR deadline>?))`)
    .bind(list.id,String(identity.user.id),list.id,new Date().toISOString()).run();
  const fresh = await getList(c.env,list.id);
  if (!result.meta.changes && !writable(fresh)) throw new AppError(409,'La lista está cerrada.');
  return c.json(await view(c,fresh,admin));
});

app.delete('/api/lists/:id', async c => {
  const { list, admin } = await listAccess(c);
  if (!admin) throw new AppError(403,'Solo los administradores del grupo pueden eliminar listas.');
  // Keep a minimal tombstone so signed launch links still resolve to the group.
  // Mark closed before removing contributions to reject concurrent writes.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE lists SET deleted_at=?,status='closed',is_primary=0,
      title='Lista eliminada',description='',created_by='',closed_at=NULL,deadline=NULL,message_id=NULL,publish_state='sent',publish_started_at=NULL
      WHERE id=? AND deleted_at IS NULL`).bind(new Date().toISOString(),list.id),
    c.env.DB.prepare('DELETE FROM orders WHERE list_id=?').bind(list.id),
  ]);
  return c.json({ deleted: true });
});

app.post('/api/lists/:id/close', async c => {
  const { list, identity, admin, group } = await listAccess(c);
  if (!admin && list.created_by !== String(identity.user.id)) throw new AppError(403,'Solo el creador o un administrador puede cerrar la lista.');
  await c.env.DB.prepare("UPDATE lists SET status='closed',is_primary=0,closed_at=COALESCE(closed_at,?) WHERE id=? AND deleted_at IS NULL AND status='open'")
    .bind(new Date().toISOString(),list.id).run();
  if (list.message_id && list.status === 'open') c.executionCtx.waitUntil(telegram(c.env,'editMessageText',{
    chat_id: group.telegram_chat_id,message_id:list.message_id,text:`${list.title}\nLista cerrada`,
    reply_markup:{ inline_keyboard: [[{ text:'Ver lista',url:launchLink(c.env,`l_${list.id}`) }]] },
  }).catch(() => undefined));
  return c.json(await view(c,await getList(c.env,list.id),admin));
});

app.notFound(c => c.json({ error:'Recurso no encontrado.' },404));
app.onError((error,c) => {
  if (error instanceof AppError) return c.json({ error:error.message },error.status);
  // Never log request headers, initData, Bot API URLs, SQL parameters or tokens.
  console.error(JSON.stringify({ event:'request_failed',path:c.req.routePath }));
  return c.json({ error:'Servicio temporalmente no disponible. Vuelve a intentarlo más tarde.' },503);
});

export default app;
