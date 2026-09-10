'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Notificaciones({ session }: { session: Session }) {
  const [soportado, setSoportado] = useState(false);
  const [suscripto, setSuscripto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horaResumen, setHoraResumen] = useState('08:00');
  const [guardandoHora, setGuardandoHora] = useState(false);

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window;
    setSoportado(ok);
    if (ok) verificarSuscripcion();
    cargarConfiguracion();
  }, []);

  async function verificarSuscripcion() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setSuscripto(!!sub);
  }

  async function cargarConfiguracion() {
    const { data } = await supabase
      .from('agenda_configuracion')
      .select('hora_resumen_diario')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (data?.hora_resumen_diario) {
      setHoraResumen(data.hora_resumen_diario.slice(0, 5));
    }
  }

  async function activarNotificaciones() {
    setError(null);
    setCargando(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        setError('No diste permiso de notificaciones. Podés activarlo después desde la config del navegador.');
        setCargando(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string) as unknown as BufferSource,
      });

      const json = sub.toJSON();
      await supabase.from('agenda_push_subscriptions').upsert(
        {
          user_id: session.user.id,
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh || '',
          auth_key: json.keys?.auth || '',
        },
        { onConflict: 'endpoint' }
      );

      setSuscripto(true);
    } catch (err) {
      console.error(err);
      setError('No se pudo activar las notificaciones.');
    } finally {
      setCargando(false);
    }
  }

  async function guardarHora(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoHora(true);
    await supabase.from('agenda_configuracion').upsert(
      {
        user_id: session.user.id,
        hora_resumen_diario: horaResumen + ':00',
      },
      { onConflict: 'user_id' }
    );
    setGuardandoHora(false);
  }

  if (!soportado) return null;

  return (
    <div className="mb-6 bg-slate-900 rounded-xl p-4 space-y-3">
      {!suscripto ? (
        <div>
          <button
            onClick={activarNotificaciones}
            disabled={cargando}
            className="w-full rounded-lg bg-slate-700 hover:bg-slate-600 py-2 text-sm font-medium"
          >
            {cargando ? 'Activando...' : '🔔 Activar notificaciones'}
          </button>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        </div>
      ) : (
        <form onSubmit={guardarHora} className="flex items-center gap-2">
          <label className="text-xs text-slate-400 whitespace-nowrap">Resumen diario a las</label>
          <input
            type="time"
            value={horaResumen}
            onChange={(e) => setHoraResumen(e.target.value)}
            className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={guardandoHora}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-sm font-medium whitespace-nowrap"
          >
            {guardandoHora ? '...' : 'Guardar'}
          </button>
        </form>
      )}
    </div>
  );
}