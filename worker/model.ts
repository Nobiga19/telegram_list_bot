import { AppError, type Identity } from './auth';
import { telegram, isMember, isAdmin, type ChatMember } from './telegram';

export interface Group { id: string; telegram_chat_id: string; title: string; bot_is_admin: number; last_update_id: number; last_announced_update_id: number; last_event_date: number; last_announced_event_date: number }
export interface List {
  id: string; group_id: string; deleted_at: string | null; title: string; description: string; status: 'open' | 'closed'; is_primary: number;
  created_by: string; created_at: string; closed_at: string | null; deadline: string | null;
  message_id: number | null; publish_state: 'pending' | 'sending' | 'sent' | 'failed'; publish_started_at: number | null;
}
export interface Order { id: string; list_id: string; telegram_user_id: string; display_name: string; content: string; created_at: string; updated_at: string }

export const opaque = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const writable = (list: List, now = Date.now()) => !list.deleted_at && list.status === 'open' && (!list.deadline || Date.parse(list.deadline) > now);

export async function launchGroup(env: Env, identity: Identity): Promise<Group | null> {
  const prefix = identity.startParam.slice(0, 2), id = identity.startParam.slice(2);
  if (!opaque(id) || !['g_', 'l_'].includes(prefix)) return null;
  return prefix === 'g_'
    ? env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<Group>()
    : env.DB.prepare('SELECT g.* FROM groups g JOIN lists l ON l.group_id = g.id WHERE l.id = ?').bind(id).first<Group>();
}

export async function access(env: Env, identity: Identity, groupId: string): Promise<{ group: Group; admin: boolean }> {
  const group = await launchGroup(env, identity);
  if (!group || group.id !== groupId) throw new AppError(403, 'Abre el enlace de esta lista desde su grupo.');
  if (!group.bot_is_admin) throw new AppError(403, 'Un administrador del grupo debe hacer administrador al bot para verificar los miembros.');
  const member = await telegram<ChatMember>(env, 'getChatMember', { chat_id: group.telegram_chat_id, user_id: identity.user.id });
  if (!isMember(member)) throw new AppError(403, 'No perteneces a este grupo.');
  return { group, admin: isAdmin(member) };
}

export async function getList(env: Env, id: string): Promise<List> {
  if (!opaque(id)) throw new AppError(404, 'Lista no encontrada.');
  const list = await env.DB.prepare('SELECT * FROM lists WHERE id = ? AND deleted_at IS NULL').bind(id).first<List>();
  if (!list) throw new AppError(404, 'Lista no encontrada.');
  if (list.status === 'open' && list.deadline && Date.parse(list.deadline) <= Date.now()) {
    await env.DB.prepare("UPDATE lists SET status='closed', is_primary=0, closed_at=COALESCE(closed_at, deadline) WHERE id=? AND status='open' AND deadline <= ?")
      .bind(id, new Date().toISOString()).run();
    list.status = 'closed'; list.is_primary = 0; list.closed_at ??= list.deadline;
  }
  return list;
}

export function textInput(value: unknown, name: string, max: number, required = true): string {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return '';
    throw new AppError(400, `${name}: texto no válido.`);
  }
  const text = value.trim();
  if ((required && !text) || text.length > max) throw new AppError(400, `${name}: entre ${required ? 1 : 0} y ${max} caracteres.`);
  return text;
}
