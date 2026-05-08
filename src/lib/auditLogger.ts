import { supabase } from './supabaseClient';

interface LogOptions {
  escuela_id: string;
  usuario_id: string;
  usuario_nombre: string;
  accion: string;
  modulo: string;
  entidad_id?: string;
  detalle?: any;
}

export const logActivity = (options: LogOptions) => {
  // Fire and forget, we don't want to slow down the app
  supabase
    .from('audit_log')
    .insert([{
      escuela_id: options.escuela_id,
      usuario_id: options.usuario_id,
      usuario_nombre: options.usuario_nombre,
      accion: options.accion,
      modulo: options.modulo,
      entidad_id: options.entidad_id,
      detalle: options.detalle,
      ip_address: 'SaaSport'
    }])
    .then(({ error }) => {
      if (error) {
        console.error('Error logging activity:', error);
      }
    });
};
