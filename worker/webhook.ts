import { AppError, equalSecret } from './auth';
import { telegram, launchLink, type TelegramMessage, type ChatMember } from './telegram';
import type { Group } from './model';

interface Chat { id: number; type: string; title?: string }
interface Update {
  update_id: number;
  my_chat_member?: { date: number; chat: Chat; old_chat_member: { status: string }; new_chat_member: { status: string } };
  message?: { chat: Chat; text?: string; from?: { is_bot?: boolean }; migrate_to_chat_id?: number; migrate_from_chat_id?: number };
}

// Invisible separator keeps the launch message text-free while satisfying Telegram's non-empty text requirement.
const launchMessageText = '\u2063';

const groupKeyboard = {
  keyboard: [[{ text: '📋 Listas' }]],
  resize_keyboard: true,
  is_persistent: true,
  one_time_keyboard: false,
};

export function isListsRequest(text: string, botUsername: string): boolean {
  if (text.trim() === '📋 Listas') return true;
  const command = /^\/listas(?:@([a-zA-Z0-9_]+))?(?:\s|$)/i.exec(text.trim());
  return !!command && (!command[1] || command[1].toLowerCase() === botUsername.toLowerCase());
}

async function sendGroupKeyboard(env: Env, chatId: string) {
  await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: '📋 Listas',
    disable_notification: true,
    reply_markup: groupKeyboard,
  });
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (!await equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', env.WEBHOOK_SECRET)) throw new AppError(401, 'No autorizado.');
  let update: Update;
  try { update = await request.json() as Update; } catch { throw new AppError(400, 'Solicitud no válida.'); }
  if (!Number.isSafeInteger(update.update_id)) throw new AppError(400, 'Solicitud no válida.');
  const event = update.my_chat_member;
  if (event && ['group', 'supergroup'].includes(event.chat.type)) {
    if (!Number.isSafeInteger(event.date)) throw new AppError(400, 'Evento no válido.');
    const chatId = String(event.chat.id);
    const previous = await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind(chatId).first<Group>();
    const admin = event.new_chat_member.status === 'administrator' ? 1 : 0;
    const groupId = previous?.id ?? crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO groups(id,telegram_chat_id,title,bot_is_admin,last_update_id,last_event_date) VALUES(?,?,?,?,?,?)
      ON CONFLICT(telegram_chat_id) DO UPDATE SET title=excluded.title,bot_is_admin=excluded.bot_is_admin,last_update_id=excluded.last_update_id,last_event_date=excluded.last_event_date
      WHERE groups.last_event_date < excluded.last_event_date OR (groups.last_event_date = excluded.last_event_date AND groups.last_update_id < excluded.last_update_id)`)
      .bind(groupId, chatId, event.chat.title ?? 'Grupo', admin,update.update_id,event.date).run();
    const canonical = await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind(chatId).first<Group>();
    if (!canonical || canonical.last_event_date > event.date || (canonical.last_event_date === event.date && canonical.last_update_id > update.update_id) ||
      (canonical.last_announced_event_date === event.date && canonical.last_announced_update_id === update.update_id)) return Response.json({ok:true});
    if (['member','administrator'].includes(event.new_chat_member.status) &&
      (!previous || event.old_chat_member.status !== event.new_chat_member.status)) {
      await telegram<TelegramMessage>(env, 'sendMessage', { chat_id: chatId,
        text: admin ? launchMessageText : 'Para proteger las listas, haz administrador al bot. No necesita borrar mensajes ni gestionar miembros.',
        reply_markup: { inline_keyboard: [[{ text: 'Abrir', url: launchLink(env, `g_${canonical.id}`) }]] },
      });
      if (admin) await sendGroupKeyboard(env,chatId);
    }
    await env.DB.prepare('UPDATE groups SET last_announced_update_id=?,last_announced_event_date=? WHERE id=? AND last_update_id=? AND last_event_date=?')
      .bind(update.update_id,event.date,canonical.id,update.update_id,event.date).run();
  }
  const message = update.message;
  if (message && ['group', 'supergroup'].includes(message.chat.type)) {
    const oldId = message.migrate_to_chat_id ? String(message.chat.id) : message.migrate_from_chat_id ? String(message.migrate_from_chat_id) : null;
    const newId = message.migrate_to_chat_id ? String(message.migrate_to_chat_id) : message.migrate_from_chat_id ? String(message.chat.id) : null;
    if (oldId && newId) {
      const oldGroup = await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind(oldId).first<Group>();
      const newGroup = await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind(newId).first<Group>();
      if (oldGroup) {
        // Preserve the original opaque group ID and all of its list links.
        const statements: D1PreparedStatement[] = [];
        if (newGroup && newGroup.id !== oldGroup.id) {
          statements.push(env.DB.prepare('UPDATE lists SET is_primary=0 WHERE group_id=?').bind(newGroup.id));
          statements.push(env.DB.prepare('UPDATE lists SET group_id=? WHERE group_id=?').bind(oldGroup.id,newGroup.id));
          statements.push(env.DB.prepare('DELETE FROM groups WHERE id=?').bind(newGroup.id));
        }
        statements.push(env.DB.prepare('UPDATE groups SET telegram_chat_id=?,title=?,bot_is_admin=? WHERE id=?')
          .bind(newId,message.chat.title ?? oldGroup.title,newGroup?.bot_is_admin ?? oldGroup.bot_is_admin,oldGroup.id));
        await env.DB.batch(statements);
      }
    }
    if (!message.from?.is_bot && message.text && isListsRequest(message.text,env.BOT_USERNAME)) {
      const chatId=String(message.chat.id);
      let group=await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind(chatId).first<Group>();
      if (!group) {
        // Recover groups that predate webhook registration, using only Telegram's authenticated chat.
        const bot=await telegram<ChatMember>(env,'getChatMember',{chat_id:chatId,user_id:Number(env.BOT_TOKEN.split(':')[0])});
        await env.DB.prepare(`INSERT INTO groups(id,telegram_chat_id,title,bot_is_admin) VALUES(?,?,?,?) ON CONFLICT(telegram_chat_id) DO NOTHING`)
          .bind(crypto.randomUUID(),chatId,message.chat.title ?? 'Grupo',bot.status==='administrator'?1:0).run();
        group=await env.DB.prepare('SELECT * FROM groups WHERE telegram_chat_id=?').bind(chatId).first<Group>();
      }
      if (!group) throw new AppError(503,'No se ha podido recuperar el grupo.');
      if (message.text.trim() !== '📋 Listas') await sendGroupKeyboard(env,chatId);
      await telegram(env,'sendMessage',{
        chat_id:chatId,
        text:launchMessageText,
        reply_markup:{inline_keyboard:[[{text:'Abrir',url:launchLink(env,`g_${group.id}`)}]]},
      });
    }
  }
  if (message?.chat.type === 'private' && message.text?.startsWith('/start')) {
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: 'Añade el bot a tu grupo y hazlo administrador. Después pulsa «Abrir» en el mensaje del grupo.',
      reply_markup: { inline_keyboard: [[{ text: 'Añadir a un grupo', url: `https://t.me/${env.BOT_USERNAME}?startgroup=true` }],
        [{ text: 'Abrir', web_app: { url: env.APP_URL } }]] },
    });
  }
  return Response.json({ ok: true });
}
