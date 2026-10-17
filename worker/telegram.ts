import { AppError } from './auth';

export interface ChatMember { status: string; is_member?: boolean; can_pin_messages?: boolean }
export interface TelegramMessage { message_id: number }
export async function telegram<T>(env: Env, method: string, data: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new AppError(502, 'Telegram no responde. Vuelve a intentarlo.'); }
  const result = await response.json() as { ok: boolean; result: T; error_code?: number };
  if (!response.ok || !result.ok) throw new AppError(result.error_code === 429 ? 429 : 502, 'No se ha podido completar la operación en Telegram. Comprueba los permisos del bot.');
  return result.result;
}

export const isMember = (member: ChatMember) => ['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true);
export const isAdmin = (member: ChatMember) => ['creator', 'administrator'].includes(member.status);
export const launchLink = (env: Env, start: string) => `https://t.me/${env.BOT_USERNAME}?startapp=${encodeURIComponent(start)}&mode=compact`;
