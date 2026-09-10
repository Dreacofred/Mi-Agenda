import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

webpush.setVapidDetails(
  'https://mi-agenda-bc.vercel.app',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
  process.env.VAPID_PRIVATE_KEY as string
);

// Tiene que coincidir con cada cuánto corre el cron externo (cron-job.org)
const VENTANA_MIN = 15;

function ahoraArgentina(): Date {
  // Argentina es UTC-3 fijo, sin horario de verano
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function minutosDelDia(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function minutosATiempo(hms: string): number {
  const [h, m] = hms.split(':').map(Number);
  return h * 60 + m;
}

function formatearHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

async function enviarPushAUsuario(
  userId: string,
  payload: { title: string; body: string; url?: string }
) {
  const { data: subs } = await supabaseAdmin
    .from('agenda_push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) return;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify(payload)
      );
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // La suscripción ya no existe del lado del navegador, la borramos
        await supabaseAdmin.from('agenda_push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('Error enviando push:', err);
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const ahoraArg = ahoraArgentina();
  const minutosAhora = minutosDelDia(ahoraArg);
  const fechaHoyArg = ahoraArg.toISOString().slice(0, 10);

  let resumenesEnviados = 0;
  let avisosEnviados = 0;

  // --- 1. Resumen diario ---
  const { data: configs } = await supabaseAdmin
    .from('agenda_configuracion')
    .select('user_id, hora_resumen_diario');

  for (const config of configs || []) {
    const minutosObjetivo = minutosATiempo(config.hora_resumen_diario);
    if (Math.abs(minutosAhora - minutosObjetivo) > VENTANA_MIN / 2) continue;

    const { data: yaEnviado } = await supabaseAdmin
      .from('agenda_resumen_enviado')
      .select('user_id')
      .eq('user_id', config.user_id)
      .eq('fecha', fechaHoyArg)
      .maybeSingle();
    if (yaEnviado) continue;

    const inicioDiaUTC = `${fechaHoyArg}T03:00:00.000Z`;
    const finDiaUTC = new Date(new Date(inicioDiaUTC).getTime() + 24 * 60 * 60 * 1000).toISOString();

    const { data: items } = await supabaseAdmin
      .from('agenda_items')
      .select('titulo, fecha_hora')
      .eq('user_id', config.user_id)
      .eq('estado', 'pendiente')
      .gte('fecha_hora', inicioDiaUTC)
      .lt('fecha_hora', finDiaUTC)
      .order('fecha_hora', { ascending: true });

    if (!items || items.length === 0) continue;

    const cuerpo = items.map((i) => `${formatearHora(i.fecha_hora as string)} · ${i.titulo}`).join('\n');

    await enviarPushAUsuario(config.user_id, {
      title: `Tenés ${items.length} ${items.length === 1 ? 'cosa' : 'cosas'} hoy`,
      body: cuerpo,
      url: '/',
    });

    await supabaseAdmin.from('agenda_resumen_enviado').insert({ user_id: config.user_id, fecha: fechaHoyArg });
    resumenesEnviados++;
  }

  // --- 2. Aviso 1 hora antes de cada ítem ---
  const ahoraUTC = new Date();
  const desde = new Date(ahoraUTC.getTime() + 50 * 60 * 1000).toISOString();
  const hasta = new Date(ahoraUTC.getTime() + 70 * 60 * 1000).toISOString();

  const { data: itemsProximos } = await supabaseAdmin
    .from('agenda_items')
    .select('id, user_id, titulo, tipo, fecha_hora')
    .eq('estado', 'pendiente')
    .eq('aviso_1h_enviado', false)
    .gte('fecha_hora', desde)
    .lt('fecha_hora', hasta);

  for (const item of itemsProximos || []) {
    await enviarPushAUsuario(item.user_id, {
      title: `En 1 hora: ${item.titulo}`,
      body: `${item.tipo} · ${formatearHora(item.fecha_hora as string)}`,
      url: '/',
    });

    await supabaseAdmin.from('agenda_items').update({ aviso_1h_enviado: true }).eq('id', item.id);
    avisosEnviados++;
  }

    return NextResponse.json({ ok: true, resumenesEnviados, avisosEnviados });
}