import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export type MomentoEmision = 'manual' | 'adelantado' | 'atrasado';
export type CalculoMonto = 'manual' | 'fijo' | 'asistencia';

export interface ConfiguracionFacturacion {
  id: string | null;
  escuela_id: string;
  plan_momento_emision: MomentoEmision;
  plan_calculo_monto: CalculoMonto;
  asistencias_minimo_completo: number | null;
  asistencias_minimo_parcial: number | null;
  porcentaje_monto_parcial: number;
  activo: boolean;
}

export const configuracionFacturacionKey = (escuelaId: string | null) =>
  ['configuracion-facturacion', escuelaId] as const;

export const configuracionFacturacionManual = (escuelaId: string): ConfiguracionFacturacion => ({
  id: null,
  escuela_id: escuelaId,
  plan_momento_emision: 'manual',
  plan_calculo_monto: 'manual',
  asistencias_minimo_completo: null,
  asistencias_minimo_parcial: null,
  porcentaje_monto_parcial: 50,
  activo: true,
});

const fetchConfiguracionFacturacion = async (escuelaId: string): Promise<ConfiguracionFacturacion> => {
  const { data, error } = await supabase
    .from('configuracion_facturacion')
    .select(`
      id,
      escuela_id,
      plan_momento_emision,
      plan_calculo_monto,
      asistencias_minimo_completo,
      asistencias_minimo_parcial,
      porcentaje_monto_parcial,
      activo
    `)
    .eq('escuela_id', escuelaId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return configuracionFacturacionManual(escuelaId);

  return {
    ...data,
    plan_momento_emision: data.plan_momento_emision as MomentoEmision,
    plan_calculo_monto: data.plan_calculo_monto as CalculoMonto,
    porcentaje_monto_parcial: Number(data.porcentaje_monto_parcial),
  };
};

export const useConfiguracionFacturacion = (
  escuelaId: string | null,
  enabled = true,
) => useQuery({
  queryKey: configuracionFacturacionKey(escuelaId),
  queryFn: () => fetchConfiguracionFacturacion(escuelaId!),
  enabled: enabled && !!escuelaId,
  staleTime: 1000 * 60 * 15,
});
