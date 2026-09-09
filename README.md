# Agenda de Viajes

Agenda personal hablada, pensada para usar en viajes. Next.js + Supabase + PWA.

## Setup local

1. `npm install`
2. Copiar `.env.local.example` a `.env.local` y completar con las claves de Supabase (proyecto Sistema-BC).
3. `npm run dev`

## Deploy

Conectado a Vercel. Las variables de entorno `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
se configuran en Vercel → Settings → Environment Variables (no van commiteadas).

## Importante

Si cambia la URL de producción, actualizar el Site URL y las Redirect URLs en
Supabase → Authentication → URL Configuration.
