export class AppError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503, message: string) { super(message); }
}

export interface TelegramUser { id: number; first_name: string; last_name?: string; username?: string }
export interface Identity { user: TelegramUser; startParam: string; authDate: number }

const bytes = (text: string) => new TextEncoder().encode(text);
export async function hmac(key: Uint8Array, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, bytes(value));
}

export async function authenticate(raw: string, token: string, now = Math.floor(Date.now() / 1000)): Promise<Identity> {
  if (!token) throw new AppError(503, 'La aplicación todavía no está configurada.');
  if (!raw || raw.length > 8192) throw new AppError(401, 'Abre la aplicación desde Telegram.');
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new AppError(401, 'Autenticación no válida.');
  const hash = params.get('hash') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new AppError(401, 'Autenticación no válida.');
  params.delete('hash');
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmac(bytes('WebAppData'), token);
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const supplied = Uint8Array.from(hash.match(/../g)!, value => parseInt(value, 16));
  if (!await crypto.subtle.verify('HMAC', key, supplied, bytes(data))) throw new AppError(401, 'Autenticación no válida.');
  const dateText = params.get('auth_date') ?? '';
  const authDate = Number(dateText);
  if (!/^\d+$/.test(dateText) || !Number.isSafeInteger(authDate) || authDate > now + 30 || now - authDate > 3600) {
    throw new AppError(401, 'La sesión ha caducado. Cierra y vuelve a abrir la lista desde Telegram.');
  }
  let user: TelegramUser;
  try { user = JSON.parse(params.get('user') ?? 'null') as TelegramUser; } catch { throw new AppError(401, 'Usuario no válido.'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string' || !user.first_name.trim() ||
    (user.last_name !== undefined && typeof user.last_name !== 'string')) throw new AppError(401, 'Usuario no válido.');
  return { user, startParam: params.get('start_param') ?? '', authDate };
}

export async function equalSecret(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', bytes(a)), crypto.subtle.digest('SHA-256', bytes(b))]);
  // Verify a MAC rather than comparing secret-derived strings in JavaScript.
  const key = await crypto.subtle.importKey('raw', left, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const tag = await crypto.subtle.sign('HMAC', key, bytes('webhook'));
  const other = await crypto.subtle.importKey('raw', right, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', other, tag, bytes('webhook'));
}
