import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { useScreenNavigation } from './navigation';

interface Order { id: string; telegram_user_id: string; display_name: string; content: string }
interface List { id: string; group_id: string; title: string; description: string; status: 'open' | 'closed'; writable: boolean; can_close: boolean; can_delete: boolean; deadline: string | null; is_primary: number; publish_state: string; created_at: string }
interface Snapshot { list: List; orders: Order[]; published?: boolean; warning?: string }
interface Session { user: { id: number }; group: { id: string; title: string } | null; admin: boolean; list_id: string | null; list_deleted?: boolean; bot_username: string }
interface History { lists: List[]; next_cursor: string | null }
const webapp = window.Telegram?.WebApp;

async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, signal, headers: { Authorization: `tma ${webapp?.initData ?? ''}`, ...(body !== undefined ? { 'Content-Type':'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'No se ha podido completar la operación.');
  return data;
}
const date = (value: string) => new Intl.DateTimeFormat('es-ES',{ dateStyle:'short',timeStyle:'short' }).format(new Date(value));
const readableError = (error: unknown) => error instanceof Error ? error.message : 'No se ha podido conectar. Vuelve a intentarlo.';

function OrderRows({orders,userId}: {orders: Order[]; userId?: number}) {
  return <>{!orders.length && <p className="py-3 text-sm muted">Todavía no hay aportaciones.</p>}
    {orders.map(order=><article key={order.id} className="order py-2">
      <h2 className="text-sm font-semibold break-words">{order.display_name}{order.telegram_user_id===String(userId) && <span className="font-normal muted"> · Tú</span>}</h2>
      <p className="whitespace-pre-wrap break-words text-sm">{order.content}</p>
    </article>)}
  </>;
}

function App() {
  const [session,setSession] = useState<Session | null>(null);
  const [snapshot,setSnapshot] = useState<Snapshot | null>(null);
  const [history,setHistory] = useState<History>({ lists:[],next_cursor:null });
  const { screen, navigate, pageRef, transitioning } = useScreenNavigation();
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(true);
  const [content,setContent] = useState('');
  const [dirty,setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [title,setTitle] = useState('');
  const [description,setDescription] = useState('');
  const [deadline,setDeadline] = useState('');
  const [confirmClose,setConfirmClose] = useState(false);
  const [confirmDelete,setConfirmDelete] = useState(false);
  const [summary,setSummary] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const mutating = useRef(false);
  const userId = useRef<number | null>(null);
  const selectedId = useRef<string | null>(null);
  const mounted = useRef(true);
  const polling = useRef<AbortController | null>(null);

  const apply = useCallback((next: Snapshot, reset = false) => {
    if (!mounted.current || selectedId.current !== next.list.id) return;
    setSnapshot(next);
    if (reset || !dirtyRef.current) {
      setContent(next.orders.find(order => order.telegram_user_id === String(userId.current))?.content ?? '');
      dirtyRef.current=false; setDirty(false);
    }
  },[]);

  const openList = useCallback(async (id: string, initial = false) => {
    polling.current?.abort();
    const previousId=selectedId.current;
    selectedId.current=id;
    setError(''); setNotice(''); setSummary(''); setConfirmClose(false); setConfirmDelete(false); setBusy(true);
    try { apply(await api<Snapshot>(`/api/lists/${id}`),previousId!==id); await navigate('list', { key: `list:${id}`, instant: initial, resetScroll: previousId!==id }); }
    catch(e) { selectedId.current=previousId;setError(readableError(e)); }
    finally { setBusy(false); }
  },[apply,navigate]);

  const loadHistory = useCallback(async (current: Session, more = false) => {
    if (!current.group) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await api<History>(`/api/groups/${current.group.id}/lists${more && history.next_cursor ? `?before=${history.next_cursor}` : ''}`);
      setHistory(previous => ({...next, lists:more ? [...previous.lists,...next.lists] : next.lists}));
      await navigate('history', { direction: 'back' });
    } catch(e) { setError(readableError(e)); }
    finally { setBusy(false); }
  },[history.next_cursor,navigate]);

  useEffect(() => {
    mounted.current=true; webapp?.ready();
    const controller = new AbortController();
    void (async()=>{
      try {
        if (!webapp?.initData) throw new Error('Abre esta aplicación con el botón «Crear lista» o «Abrir lista» del grupo de Telegram.');
        const current = await api<Session>('/api/session','GET',undefined,controller.signal);
        if (!mounted.current) return;
        userId.current=current.user.id; setSession(current);
        if (current.list_id) { await openList(current.list_id,true); }
        else if (current.group) {
          const next = await api<History>(`/api/groups/${current.group.id}/lists`,'GET',undefined,controller.signal);
          if (!mounted.current) return;
          setHistory(next);
          const primary=next.lists.find(list=>list.is_primary && list.status==='open');
          if (current.list_deleted) await navigate('history', { instant:true });
          else if (primary) await openList(primary.id,true);
          else await navigate(current.admin ? 'create' : 'history', { instant: true });
        }
      } catch(e) { if (!controller.signal.aborted) setError(readableError(e)); }
      finally { if(mounted.current) setBusy(false); }
    })();
    return ()=>{ mounted.current=false; controller.abort(); polling.current?.abort(); };
  },[openList,navigate]);

  // Recursive timeout starts only after the previous request finishes. No interval overlap.
  useEffect(() => {
    if ((screen!=='list' && screen!=='orders') || !snapshot?.list.writable) return;
    const id=snapshot.list.id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed=false;
    const visible=()=>document.visibilityState==='visible' && webapp?.isActive!==false;
    const schedule=()=>{ if (!disposed && visible()) timer=setTimeout(()=>{void tick();},15000); };
    const tick=async()=>{
      if (disposed || !visible()) return;
      if (inFlight.current || mutating.current) {schedule();return;}
      inFlight.current=true;
      const controller=new AbortController(); polling.current=controller;
      try {
        const next=await api<Snapshot>(`/api/lists/${id}/orders`,'GET',undefined,controller.signal);
        if (!disposed) { apply(next); setError(''); }
      } catch(e) { if (!controller.signal.aborted && !disposed) setError(readableError(e)); }
      finally { inFlight.current=false; if(polling.current===controller) polling.current=null; schedule(); }
    };
    const visibility=()=>{
      clearTimeout(timer); polling.current?.abort();
      if(visible()) schedule();
    };
    document.addEventListener('visibilitychange',visibility);
    webapp?.onEvent('activated',visibility); webapp?.onEvent('deactivated',visibility);
    schedule();
    return ()=>{disposed=true;clearTimeout(timer);polling.current?.abort();document.removeEventListener('visibilitychange',visibility);webapp?.offEvent('activated',visibility);webapp?.offEvent('deactivated',visibility);};
  },[screen,snapshot?.list.id,snapshot?.list.writable,apply]);

  async function mutate(path: string, method: string, body: unknown, success: string) {
    if (busy) return;
    polling.current?.abort();
    mutating.current=true;setBusy(true);setError('');setNotice('');
    try { const next=await api<Snapshot>(path,method,body); apply(next,true);setNotice(next.warning ?? (next.published===false ? 'No se ha confirmado la publicación. Comprueba los permisos del bot y vuelve a intentarlo.':success));setConfirmClose(false); }
    catch(e) {setError(readableError(e));}
    finally {mutating.current=false;setBusy(false);}
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();if(!session?.group || busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      const next=await api<Snapshot>('/api/lists','POST',{group_id:session.group.id,title,description,deadline:deadline ? new Date(deadline).toISOString() : null,request_id:requestId.current});
      selectedId.current=next.list.id; apply(next,true);await navigate('list', { key: `list:${next.list.id}`, resetScroll: true });setNotice(next.warning ?? 'Lista creada');
      requestId.current=crypto.randomUUID();setTitle('');setDescription('');setDeadline('');
    } catch(e) {setError(readableError(e));}
    finally {setBusy(false);}
  }

  async function deleteList() {
    if (!snapshot || !session?.group || busy) return;
    const id=snapshot.list.id;
    polling.current?.abort();mutating.current=true;setBusy(true);setError('');setNotice('');
    try {
      await api(`/api/lists/${id}`,'DELETE');
      selectedId.current=null;setSnapshot(null);setContent('');dirtyRef.current=false;setDirty(false);
      setConfirmDelete(false);setConfirmClose(false);setSummary('');
      setHistory(previous=>({...previous,lists:previous.lists.filter(list=>list.id!==id)}));
      await navigate('history', { direction:'back', resetScroll:true });
      await loadHistory(session);
      setNotice('Lista eliminada');
    } catch(e) {setError(readableError(e));}
    finally {mutating.current=false;setBusy(false);}
  }

  async function copySummary() {
    if(!snapshot)return;
    const text=`${snapshot.list.title}\n${snapshot.list.writable ? 'Lista abierta':'Lista cerrada'}\n\n${snapshot.orders.map(order=>`${order.display_name}\n${order.content}`).join('\n\n') || 'Todavía no hay aportaciones.'}`;
    try {await navigator.clipboard.writeText(text);setNotice('Resumen copiado');setSummary('');}
    catch {setSummary(text);setNotice('Selecciona el resumen y cópialo.');}
  }

  const hasMoreOrders = (snapshot?.orders.length ?? 0) > 3;
  const panelScreen = screen==='history' || screen==='orders';

  return <main className={`mx-auto max-w-lg px-4 py-3 ${panelScreen ? 'panel-layout':''}`}>
    <header className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5"><img src="/bot-icon.jpg" alt="Listas" width={40} height={40} className="bot-avatar"/><p className="truncate text-sm muted">{session?.group?.title ?? 'Listas compartidas'}</p></div>
      {session?.group && (screen==='list' || screen==='create') && <button className="button secondary shrink-0" disabled={busy || transitioning} onClick={()=>{polling.current?.abort();void loadHistory(session);}}>Historial de listas</button>}
    </header>
    {error && <div role="alert" className="message error">{error}</div>}
    {notice && <div role="status" className="message">{notice}</div>}
    {busy && !snapshot && <p role="status" className="py-4 muted">Cargando…</p>}
    {!busy && !session?.group && <section className="space-y-3">
      <h1 className="text-xl font-semibold">Listas para tu grupo</h1>
      <p>Añade el bot a tu grupo, hazlo administrador y pulsa «Crear lista» en su mensaje.</p>
      {session?.bot_username && <a className="button primary block text-center" href={`https://t.me/${session.bot_username}?startgroup=true`}>Añadir a un grupo</a>}
    </section>}
    <div ref={pageRef} className={`screen-content ${panelScreen ? 'screen-panel':''}`} inert={transitioning} aria-busy={transitioning || undefined}>
    {session?.group && screen==='create' && <form onSubmit={event=>{void create(event);}} className="space-y-3">
      <h1 tabIndex={-1} className="text-xl font-semibold">Crear lista</h1>
      <label>Título de la lista<input autoComplete="off" value={title} onChange={event=>{setTitle(event.target.value);requestId.current=crypto.randomUUID();}} placeholder="Nombre de la lista" required maxLength={100}/></label>
      <label>Descripción <span className="muted">(opcional)</span><textarea value={description} onChange={event=>{setDescription(event.target.value);requestId.current=crypto.randomUUID();}} rows={2} maxLength={500}/></label>
      <label>Fecha límite <span className="muted">(opcional)</span><input type="datetime-local" value={deadline} onChange={event=>{setDeadline(event.target.value);requestId.current=crypto.randomUUID();}}/></label>
      <button className="button primary w-full" type="submit" disabled={busy || transitioning || !title.trim()}>{busy ? 'Creando…':'Crear lista'}</button>
      <p className="text-xs muted">Se publicará un botón en el grupo. La fecha límite utiliza la hora de tu dispositivo.</p>
    </form>}
    {session?.group && screen==='history' && <section className="browse-panel">
      <h1 tabIndex={-1} className="mb-2 text-lg font-semibold">Historial de listas</h1>
      <div className="browse-scroll" tabIndex={0} role="region" aria-label="Listas por fecha de creación, más recientes primero">
        {!history.lists.length && <p className="py-4 muted">Todavía no hay listas en este grupo.</p>}
        {history.lists.map(list=><button disabled={busy || transitioning} onClick={()=>{void openList(list.id);}} key={list.id} className="history-row w-full text-left">
          <span className="font-medium">{list.title}</span><span className="block text-xs muted">{list.status==='closed' ? 'Lista cerrada':list.is_primary ? 'Lista abierta · Principal':'Lista abierta'} · {date(list.created_at)}</span>
        </button>)}
        {history.next_cursor && <button className="button secondary mt-3 w-full" disabled={busy || transitioning} onClick={()=>{void loadHistory(session,true);}}>Mostrar más</button>}
      </div>
      {session.admin && <footer className="panel-footer"><button className="button primary w-full" disabled={busy || transitioning} onClick={()=>{void navigate('create');setError('');setNotice('');}}>Crear lista</button></footer>}
    </section>}
    {screen==='orders' && snapshot && <section className="browse-panel">
      <h1 tabIndex={-1} className="text-lg font-semibold">Aportaciones ({snapshot.orders.length})</h1>
      <p className="mb-2 text-sm muted break-words">{snapshot.list.title}</p>
      <div className="browse-scroll" tabIndex={0} role="region" aria-label="Todas las aportaciones">
        <div className="orders"><OrderRows orders={snapshot.orders} userId={session?.user.id}/></div>
      </div>
      <footer className="panel-footer"><button className="button secondary w-full" disabled={busy || transitioning} onClick={()=>{void navigate('list', { direction: 'back', key: `list:${snapshot.list.id}` });}}>Volver a la lista</button></footer>
    </section>}
    {screen==='list' && snapshot && <>
      <section className="mb-2">
        <h1 tabIndex={-1} className="text-xl font-semibold break-words">{snapshot.list.title}</h1>
        {snapshot.list.description && <p className="mt-2 whitespace-pre-wrap text-sm">{snapshot.list.description}</p>}
        <div className="list-meta mt-1 text-xs">
          {snapshot.list.deadline && <p className="muted">Fecha límite: {date(snapshot.list.deadline)}</p>}
          <p className={`status ${snapshot.list.writable ? 'open':''}`}>{snapshot.list.writable ? 'Lista abierta':'Lista cerrada'}</p>
        </div>
      </section>
      <section aria-label={hasMoreOrders ? 'Vista previa de aportaciones':'Aportaciones'} className={`orders mb-3 ${hasMoreOrders ? 'orders-preview':''}`}>
        <OrderRows orders={snapshot.orders.slice(0,3)} userId={session?.user.id}/>
      </section>
      {snapshot.list.writable && <form onSubmit={event=>{event.preventDefault();void mutate(`/api/lists/${snapshot.list.id}/my-order`,'PUT',{content},'Aportación guardada');}}>
        <label><span className="order-label">Mi aportación:</span><textarea value={content} rows={2} maxLength={1000} required placeholder="Escribe tu aportación a la lista" onChange={event=>{setContent(event.target.value);dirtyRef.current=true;setDirty(true);}}/></label>
        <div className="action-row mt-2">
          <button className="button primary" disabled={busy || transitioning || !content.trim() || !dirty} type="submit">{busy ? 'Guardando…':'Guardar cambios'}</button>
          {snapshot.orders.some(order=>order.telegram_user_id===String(session?.user.id)) && <button className="button destructive" type="button" disabled={busy || transitioning} onClick={()=>{void mutate(`/api/lists/${snapshot.list.id}/my-order`,'DELETE',undefined,'Aportación eliminada');}}>Eliminar mi aportación</button>}
        </div>
      </form>}
      {(hasMoreOrders || snapshot.list.can_close) && <div className="action-row mt-3">
        {hasMoreOrders && <button className="button secondary" aria-label={`Ver aportaciones (${snapshot.orders.length})`} disabled={busy || transitioning} onClick={()=>{setConfirmClose(false);setConfirmDelete(false);void navigate('orders', { key: `orders:${snapshot.list.id}` });}}>Ver aportaciones</button>}
        {snapshot.list.can_close && <button className="button destructive" disabled={busy || transitioning} onClick={()=>{setConfirmDelete(false);setConfirmClose(true);}}>Cerrar lista</button>}
      </div>}
      {confirmClose && snapshot.list.can_close && <div className="message close-confirmation mt-2" role="group" aria-label="Confirmar cierre"><p className="text-sm">Las aportaciones quedarán en modo de solo lectura.</p><div className="action-row mt-2"><button className="button destructive" disabled={busy || transitioning} onClick={()=>{void mutate(`/api/lists/${snapshot.list.id}/close`,'POST',undefined,'Lista cerrada');}}>Confirmar cierre</button><button className="button secondary" disabled={busy || transitioning} onClick={()=>setConfirmClose(false)}>Cancelar</button></div></div>}
      {snapshot.list.can_delete && <div className="mt-3">
        <button className="button destructive w-full" disabled={busy || transitioning} onClick={()=>{setConfirmClose(false);setConfirmDelete(true);}}>Eliminar lista</button>
        {confirmDelete && <div className="message close-confirmation mt-2" role="group" aria-label="Confirmar eliminación">
          <p className="text-sm">¿Eliminar «{snapshot.list.title}» y todas sus aportaciones? Esta acción no se puede deshacer.</p>
          <div className="action-row mt-2"><button className="button destructive" disabled={busy || transitioning} onClick={()=>{void deleteList();}}>Confirmar eliminación</button><button className="button secondary" disabled={busy || transitioning} onClick={()=>setConfirmDelete(false)}>Cancelar</button></div>
        </div>}
      </div>}
      <div className="action-row secondary-actions mt-3">
        <button className="button secondary" onClick={()=>{void copySummary();}}>Copiar resumen</button>
        {session?.admin && <button className="button secondary" disabled={busy || transitioning} onClick={()=>{void navigate('create');setError('');setNotice('');}}>Crear lista</button>}
      </div>
      {summary && <textarea className="mt-2" aria-label="Resumen para copiar" readOnly rows={5} value={summary} onFocus={event=>event.target.select()}/>}
      {session?.admin && snapshot.list.publish_state!=='sent' && snapshot.list.writable && <button className="text-button mt-2 block" disabled={busy || transitioning} onClick={()=>{void mutate(`/api/lists/${snapshot.list.id}/publish`,'POST',undefined,'Publicación revisada');}}>Publicar en el grupo</button>}
    </>}
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
