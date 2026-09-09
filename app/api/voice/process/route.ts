import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return NextResponse.json({ error: 'Falta el audio' }, { status: 400 });
    }

    // 1. Transcribir con Groq (Whisper)
    const groqForm = new FormData();
    groqForm.append('file', audioFile, 'audio.webm');
    groqForm.append('model', 'whisper-large-v3-turbo');
    groqForm.append('language', 'es');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: groqForm,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Error de Groq:', errText);
      return NextResponse.json({ error: 'No se pudo transcribir el audio' }, { status: 502 });
    }

    const groqData = await groqRes.json();
    const transcripcion: string = (groqData.text || '').trim();

    if (!transcripcion) {
      return NextResponse.json({ error: 'No se entendió nada en el audio' }, { status: 422 });
    }

    // 2. Interpretar con Claude y devolver un ítem estructurado
    const ahora = new Date();
    const fechaActualStr = ahora.toLocaleString('sv-SE', {
      timeZone: 'America/Argentina/Buenos_Aires',
    }).replace(' ', 'T') + '-03:00';

    const systemPrompt = `Sos un asistente que convierte un texto dictado en un ítem de agenda estructurado.

Fecha y hora actual: ${fechaActualStr} (zona horaria America/Argentina/Buenos_Aires, UTC-3).

Reglas:
- Interpretá fechas y horas relativas ("mañana", "el viernes que viene", "en dos horas") en base a la fecha actual de arriba.
- "tipo" tiene que ser exactamente uno de: "nota", "recordatorio", "compromiso". Si es solo una idea sin acción clara, usá "nota". Si tiene fecha/hora y hay que hacer algo, "recordatorio". Si es una cita o reunión con otra persona o en un lugar, "compromiso".
- "titulo" es un resumen corto (máximo 60 caracteres).
- "contenido" es el detalle completo si hay info extra más allá del título, o null si no hace falta.
- "fecha_hora" tiene que ser un string ISO 8601 con offset -03:00 (ej: "2026-09-12T10:00:00-03:00"), o null si no se mencionó ninguna fecha u hora.

Respondé ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin backticks, con esta forma exacta:
{"tipo": "...", "titulo": "...", "contenido": "..." o null, "fecha_hora": "..." o null}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcripcion }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Error de Claude:', errText);
      return NextResponse.json({ error: 'No se pudo interpretar el audio' }, { status: 502 });
    }

    const claudeData = await claudeRes.json();
    const textBlock = claudeData.content?.find((c: { type: string }) => c.type === 'text');

    let item;
    try {
      const clean = (textBlock?.text || '').replace(/```json|```/g, '').trim();
      item = JSON.parse(clean);
    } catch {
      console.error('No se pudo parsear la respuesta de Claude:', textBlock?.text);
      return NextResponse.json({ error: 'No se pudo interpretar el ítem' }, { status: 502 });
    }

    return NextResponse.json({ transcripcion, item });
  } catch (err) {
    console.error('Error inesperado en /api/voice/process:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}