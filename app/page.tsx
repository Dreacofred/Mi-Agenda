'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import Notificaciones from './components/Notificaciones';

type Tipo = 'nota' | 'recordatorio' | 'compromiso';
type Estado = 'pendiente' | 'hecho' | 'cancelado';
type Prioridad = 'alta' | 'media' | 'baja' | null;

interface AgendaItem {
  id: string;
  tipo: Tipo;
  titulo: string;
  contenido: string | null;
  fecha_hora: string | null;
  estado: Estado;
  created_at: string;
  prioridad: Prioridad;
  etiquetas: string[];
}

interface ItemPropuesto {
  tipo: Tipo;
  titulo: string;
  contenido: string | null;
  fecha_hora: string | null;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loadingSession) {
    return <div className="p-6 text-center text-slate-400">Cargando...</div>;
  }

  return session ? <Agenda session={session} /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modo, setModo] = useState<'login' | 'signup'>('login');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    if (modo === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else if (!data.session) {
        setInfo('Cuenta creada. Si no entra solo, revisa tu mail para confirmarla.');
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-center mb-6">Mi Agenda</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3"
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3"
          required
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {info && <p className="text-emerald-400 text-sm">{info}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 py-3 font-medium"
        >
          {loading ? 'Un momento...' : modo === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
        <button
          type="button"
          onClick={() => setModo(modo === 'login' ? 'signup' : 'login')}
          className="w-full text-sm text-slate-400 underline"
        >
          {modo === 'login' ? 'Primera vez, crear cuenta' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  );
}

function Agenda({ session }: { session: Session }) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<Tipo>('nota');
  const [fecha, setFecha] = useState('');
  const [prioridad, setPrioridad] = useState<Prioridad>(null);
  const [etiquetasTexto, setEtiquetasTexto] = useState('');
  const [cargando, setCargando] = useState(true);

  // --- Estado para grabación de voz ---
  const [grabando, setGrabando] = useState(false);
  const [procesandoAudio, setProcesandoAudio] = useState(false);
  const [errorAudio, setErrorAudio] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<{ item: ItemPropuesto; transcripcion: string } | null>(null);
  const [fechaEditable, setFechaEditable] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function cargarItems() {
    setCargando(true);
    const { data } = await supabase
      .from('agenda_items')
      .select('*')
      .neq('estado', 'cancelado')
      .order('fecha_hora', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    setItems((data as AgendaItem[]) || []);
    setCargando(false);
  }

  useEffect(() => {
    cargarItems();
  }, []);

  async function agregarItem(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    const etiquetas = etiquetasTexto
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    await supabase.from('agenda_items').insert({
      user_id: session.user.id,
      tipo,
      titulo: titulo.trim(),
      fecha_hora: fecha ? new Date(fecha).toISOString() : null,
      origen: 'texto',
      prioridad,
      etiquetas,
    });
    setTitulo('');
    setFecha('');
    setPrioridad(null);
    setEtiquetasTexto('');
    cargarItems();
  }

  async function marcarHecho(item: AgendaItem) {
    await supabase
      .from('agenda_items')
      .update({ estado: item.estado === 'hecho' ? 'pendiente' : 'hecho' })
      .eq('id', item.id);
    cargarItems();
  }

  async function eliminar(item: AgendaItem) {
    await supabase.from('agenda_items').delete().eq('id', item.id);
    cargarItems();
  }

  // --- Funciones de voz ---
  async function iniciarGrabacion() {
    setErrorAudio(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        procesarAudio(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setGrabando(true);
    } catch (err) {
      console.error(err);
      setErrorAudio('No se pudo acceder al micrófono. Revisá los permisos del navegador.');
    }
  }

  function detenerGrabacion() {
    mediaRecorderRef.current?.stop();
    setGrabando(false);
  }

  function toDatetimeLocalValue(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  }

  async function procesarAudio(blob: Blob) {
    setProcesandoAudio(true);
    setErrorAudio(null);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');

      const res = await fetch('/api/voice/process', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorAudio(data.error || 'No se pudo procesar el audio.');
        return;
      }

      setPropuesta({ item: data.item, transcripcion: data.transcripcion });
      setFechaEditable(toDatetimeLocalValue(data.item.fecha_hora));
    } catch (err) {
      console.error(err);
      setErrorAudio('Error de conexión al procesar el audio.');
    } finally {
      setProcesandoAudio(false);
    }
  }

  async function confirmarPropuesta() {
    if (!propuesta) return;
    const { item, transcripcion } = propuesta;
    await supabase.from('agenda_items').insert({
      user_id: session.user.id,
      tipo: item.tipo,
      titulo: item.titulo,
      contenido: item.contenido,
      fecha_hora: fechaEditable ? new Date(fechaEditable).toISOString() : null,
      origen: 'audio',
      audio_transcripcion: transcripcion,
    });
    setPropuesta(null);
    setFechaEditable('');
    cargarItems();
  }

  function cancelarPropuesta() {
    setPropuesta(null);
    setFechaEditable('');
  }

  const { hoy, semana, resto } = useMemo(() => agruparPorFecha(items), [items]);

  return (
    <div className="max-w-xl mx-auto p-4 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Mi Agenda</h1>
        <button onClick={() => supabase.auth.signOut()} className="text-sm text-slate-400 underline">
          Salir
        </button>
      </div>

      <Notificaciones session={session} />

      {/* --- Bloque de grabación de voz --- */}
      <div className="mb-6 bg-slate-900 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={grabando ? detenerGrabacion : iniciarGrabacion}
            disabled={procesandoAudio}
            className={`flex-1 rounded-lg py-3 font-medium ${
              grabando
                ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {procesandoAudio ? 'Procesando...' : grabando ? '⏹ Detener' : '🎤 Grabar por voz'}
          </button>
        </div>
        {errorAudio && <p className="text-red-400 text-sm">{errorAudio}</p>}
      </div>

      {/* --- Vista previa del ítem interpretado --- */}
      {propuesta && (
        <div className="mb-6 bg-slate-800 border border-emerald-600 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-500 italic">&quot;{propuesta.transcripcion}&quot;</p>
          <div>
            <p className="text-xs uppercase text-slate-500">{propuesta.item.tipo}</p>
            <p className="font-medium">{propuesta.item.titulo}</p>
            {propuesta.item.contenido && (
              <p className="text-sm text-slate-400">{propuesta.item.contenido}</p>
            )}
          </div>
          <div className="pt-1">
            <label className="text-xs text-slate-500 block mb-1">Fecha y hora (opcional)</label>
            <input
              type="datetime-local"
              value={fechaEditable}
              onChange={(e) => setFechaEditable(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmarPropuesta}
              className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 py-2 font-medium"
            >
              Confirmar
            </button>
            <button
              onClick={cancelarPropuesta}
              className="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 py-2 font-medium"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <form onSubmit={agregarItem} className="space-y-2 mb-8 bg-slate-900 rounded-xl p-4">
        <input
          type="text"
          placeholder="¿Qué querés anotar?"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-3"
        />
        <div className="flex gap-2">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Tipo)}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
          >
            <option value="nota">Nota</option>
            <option value="recordatorio">Recordatorio</option>
            <option value="compromiso">Compromiso</option>
          </select>
          <input
            type="datetime-local"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(['alta', 'media', 'baja'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrioridad(prioridad === p ? null : p)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium border ${
                prioridad === p
                  ? p === 'alta'
                    ? 'bg-red-600 border-red-600'
                    : p === 'media'
                    ? 'bg-yellow-600 border-yellow-600'
                    : 'bg-emerald-600 border-emerald-600'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {p === 'alta' ? '🔴 Alta' : p === 'media' ? '🟡 Media' : '🟢 Baja'}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Etiquetas (separadas por coma)"
          value={etiquetasTexto}
          onChange={(e) => setEtiquetasTexto(e.target.value)}
          className="w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-sm"
        />
        <button type="submit" className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 py-3 font-medium">
          Agregar
        </button>
      </form>

      {cargando ? (
        <p className="text-slate-400 text-center">Cargando...</p>
      ) : (
        <>
          <Grupo titulo="Hoy" items={hoy} onToggle={marcarHecho} onDelete={eliminar} />
          <Grupo titulo="Esta semana" items={semana} onToggle={marcarHecho} onDelete={eliminar} />
          <Grupo titulo="Sin fecha / más adelante" items={resto} onToggle={marcarHecho} onDelete={eliminar} />
        </>
      )}
    </div>
  );
}

function Grupo({
  titulo,
  items,
  onToggle,
  onDelete,
}: {
  titulo: string;
  items: AgendaItem[];
  onToggle: (i: AgendaItem) => void;
  onDelete: (i: AgendaItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="text-sm uppercase tracking-wide text-slate-500 mb-2">{titulo}</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between bg-slate-900 rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={item.estado === 'hecho'}
                onChange={() => onToggle(item)}
                className="w-5 h-5"
              />
              <div>
                <div className="flex items-center gap-2">
                  {item.prioridad && (
                    <span>{item.prioridad === 'alta' ? '🔴' : item.prioridad === 'media' ? '🟡' : '🟢'}</span>
                  )}
                  <p className={item.estado === 'hecho' ? 'line-through text-slate-500' : ''}>{item.titulo}</p>
                </div>
                <p className="text-xs text-slate-500">
                  {item.tipo}
                  {item.fecha_hora ? ' · ' + new Date(item.fecha_hora).toLocaleString('es-AR') : ''}
                </p>
                {item.etiquetas && item.etiquetas.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.etiquetas.map((et) => (
                      <span key={et} className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                        {et}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button onClick={() => onDelete(item)} className="text-slate-500 hover:text-red-400 text-sm">
              Borrar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function agruparPorFecha(items: AgendaItem[]) {
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const finHoy = new Date(inicioHoy);
  finHoy.setDate(finHoy.getDate() + 1);
  const finSemana = new Date(inicioHoy);
  finSemana.setDate(finSemana.getDate() + 7);

  const hoy: AgendaItem[] = [];
  const semana: AgendaItem[] = [];
  const resto: AgendaItem[] = [];

  for (const item of items) {
    if (!item.fecha_hora) {
      resto.push(item);
      continue;
    }
    const f = new Date(item.fecha_hora);
    if (f >= inicioHoy && f < finHoy) hoy.push(item);
    else if (f >= finHoy && f < finSemana) semana.push(item);
    else resto.push(item);
  }
  return { hoy, semana, resto };
}
