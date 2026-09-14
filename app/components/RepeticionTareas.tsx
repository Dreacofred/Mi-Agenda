'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

type Frecuencia = 'diaria' | 'semanal' | 'mensual' | 'anual';

interface Tarea {
  id: string;
  nombre: string;
  frecuencia: Frecuencia;
  activo: boolean;
}

interface EstadoRow {
  tarea_id: string;
  periodo: string;
}

const LABEL_FRECUENCIA: Record<Frecuencia, string> = {
  diaria: 'Diaria',
  semanal: 'Semanal',
  mensual: 'Mensual',
  anual: 'Anual',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// ISO week number (semana empieza lunes)
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(weekNo)}`;
}

function periodoActual(frecuencia: Frecuencia): string {
  const ahora = new Date();
  switch (frecuencia) {
    case 'diaria':
      return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
    case 'semanal':
      return isoWeek(ahora);
    case 'mensual':
      return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}`;
    case 'anual':
      return String(ahora.getFullYear());
  }
}

export default function RepeticionTareas({ session }: { session: Session }) {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [estados, setEstados] = useState<EstadoRow[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);

  const [nombreNuevo, setNombreNuevo] = useState('');
  const [frecuenciaNueva, setFrecuenciaNueva] = useState<Frecuencia>('mensual');

  async function cargar() {
    setCargando(true);
    const { data: tareasData } = await supabase
      .from('repeticion_tareas')
      .select('id, nombre, frecuencia, activo')
      .eq('activo', true)
      .order('created_at', { ascending: true });

    const tareasActivas = (tareasData as Tarea[]) || [];
    setTareas(tareasActivas);

    if (tareasActivas.length > 0) {
      const { data: estadosData } = await supabase
        .from('repeticion_tareas_estado')
        .select('tarea_id, periodo')
        .in(
          'tarea_id',
          tareasActivas.map((t) => t.id)
        );
      setEstados((estadosData as EstadoRow[]) || []);
    } else {
      setEstados([]);
    }
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  const pendientesPorPeriodo = useMemo(() => {
    return tareas.filter((t) => {
      const periodo = periodoActual(t.frecuencia);
      return !estados.some((e) => e.tarea_id === t.id && e.periodo === periodo);
    });
  }, [tareas, estados]);

  const todoAlDia = tareas.length > 0 && pendientesPorPeriodo.length === 0;

  async function toggleTarea(tarea: Tarea) {
    const periodo = periodoActual(tarea.frecuencia);
    const yaHecha = estados.some((e) => e.tarea_id === tarea.id && e.periodo === periodo);

    if (yaHecha) {
      await supabase
        .from('repeticion_tareas_estado')
        .delete()
        .eq('tarea_id', tarea.id)
        .eq('periodo', periodo);
      setEstados((prev) => prev.filter((e) => !(e.tarea_id === tarea.id && e.periodo === periodo)));
    } else {
      await supabase.from('repeticion_tareas_estado').insert({ tarea_id: tarea.id, periodo });
      setEstados((prev) => [...prev, { tarea_id: tarea.id, periodo }]);
    }
  }

  async function agregarTarea(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreNuevo.trim()) return;
    const { data, error } = await supabase
      .from('repeticion_tareas')
      .insert({
        user_id: session.user.id,
        nombre: nombreNuevo.trim(),
        frecuencia: frecuenciaNueva,
      })
      .select('id, nombre, frecuencia, activo')
      .single();
    if (!error && data) {
      setTareas((prev) => [...prev, data as Tarea]);
    }
    setNombreNuevo('');
  }

  async function desactivarTarea(tarea: Tarea) {
    await supabase.from('repeticion_tareas').update({ activo: false }).eq('id', tarea.id);
    setTareas((prev) => prev.filter((t) => t.id !== tarea.id));
  }

  if (cargando || tareas.length === 0) {
    // Si todavía no hay ninguna tarea de repetición cargada, igual mostramos
    // la barra para poder crear la primera.
    if (cargando) return null;
  }

  return (
    <div className="mb-6">
      <button
        onClick={() => setAbierto(true)}
        className={`w-full rounded-xl px-4 py-3 text-left font-medium ${
          tareas.length === 0
            ? 'bg-slate-800 text-slate-400'
            : todoAlDia
            ? 'bg-emerald-700/40 text-emerald-300 border border-emerald-600'
            : 'bg-orange-700/40 text-orange-300 border border-orange-600'
        }`}
      >
        {tareas.length === 0
          ? '📋 Tareas periódicas · configurar'
          : todoAlDia
          ? '✅ Tareas periódicas al día'
          : `🟠 Tareas periódicas: ${pendientesPorPeriodo.length} pendiente${
              pendientesPorPeriodo.length > 1 ? 's' : ''
            }`}
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl w-full max-w-sm p-4 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Tareas periódicas</h3>
              <button onClick={() => setAbierto(false)} className="text-slate-400 text-sm">
                Cerrar
              </button>
            </div>

            <ul className="space-y-2">
              {tareas.map((t) => {
                const periodo = periodoActual(t.frecuencia);
                const hecha = estados.some((e) => e.tarea_id === t.id && e.periodo === periodo);
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2"
                  >
                    <label className="flex items-center gap-3 flex-1">
                      <input
                        type="checkbox"
                        checked={hecha}
                        onChange={() => toggleTarea(t)}
                        className="w-5 h-5"
                      />
                      <div>
                        <p className={hecha ? 'line-through text-slate-500' : ''}>{t.nombre}</p>
                        <p className="text-xs text-slate-500">{LABEL_FRECUENCIA[t.frecuencia]}</p>
                      </div>
                    </label>
                    <button
                      onClick={() => desactivarTarea(t)}
                      className="text-slate-500 hover:text-red-400 text-xs ml-2"
                    >
                      Quitar
                    </button>
                  </li>
                );
              })}
              {tareas.length === 0 && (
                <p className="text-sm text-slate-500">Todavía no cargaste ninguna. Agregá la primera abajo.</p>
              )}
            </ul>

            <form onSubmit={agregarTarea} className="space-y-2 pt-2 border-t border-slate-800">
              <input
                type="text"
                placeholder="Nombre (ej: Pagar cable)"
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <select
                  value={frecuenciaNueva}
                  onChange={(e) => setFrecuenciaNueva(e.target.value as Frecuencia)}
                  className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
                >
                  <option value="diaria">Diaria</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-medium"
                >
                  Agregar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
