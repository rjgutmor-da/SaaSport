/**
 * navegacion.ts — Utilidades de navegación SSO entre SaaSport y AsisPort.
 *
 * Ambas apps comparten la misma instancia de Supabase. Como están en dominios
 * distintos, el localStorage no se comparte. La solución es pasar el JWT como
 * parámetro de URL para que AsisPort lo establezca automáticamente.
 *
 * Flujo: SaaSport → obtiene session → genera URL con tokens → redirige a AsisPort
 */
import { supabase } from './supabaseClient';

/** URL base de AsisPort en producción */
export const ASISPORT_URL = 'https://asisport.vercel.app';

/**
 * Abre AsisPort en una nueva pestaña con la sesión activa del usuario actual.
 * Si no hay sesión, redirige al login de AsisPort.
 */
export const navegarAAsisport = async (rutaDestino: string = '/dashboard'): Promise<void> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      // Sin sesión: simplemente abrir AsisPort (el redirigirá al login)
      window.open(ASISPORT_URL, '_blank');
      return;
    }

    // Incluir tokens en la URL para que AsisPort los procese en /auth-redirect
    const params = new URLSearchParams({
      token: session.access_token,
      refresh: session.refresh_token ?? '',
      redirect: rutaDestino,
    });

    const url = `${ASISPORT_URL}/auth-redirect?${params.toString()}`;
    window.open(url, '_blank');
  } catch (err) {
    console.error('Error al navegar a AsisPort:', err);
    window.open(ASISPORT_URL, '_blank');
  }
};
