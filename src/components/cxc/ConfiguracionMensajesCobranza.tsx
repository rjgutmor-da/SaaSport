import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { configuracionCobranzaKey, useConfiguracionCobranza } from '../../hooks/useConfiguracionCobranza';
import { contarCaracteresCobranza, normalizarParrafoCobranza, resolverParrafoCobranza } from '../../lib/cobranzaWhatsApp';

export default function ConfiguracionMensajesCobranza({ escuelaId }: { escuelaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useConfiguracionCobranza(escuelaId, abierto);
  const queryClient = useQueryClient();
  const texto = borrador ?? query.data ?? '';
  const longitud = contarCaracteresCobranza(texto);
  const cerrar = () => { if (!guardando) setAbierto(false); };

  return <>
    <button className="pe-acceso-card pe-acceso-green" onClick={() => { setBorrador(undefined); setError(null); setAbierto(true); }}>
      <div className="pe-acceso-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M20.52 3.48A11.87 11.87 0 0 0 12.05 0C5.46 0 .1 5.36.1 11.95c0 2.1.55 4.15 1.6 5.96L0 24l6.24-1.64a11.93 11.93 0 0 0 5.8 1.48h.01c6.59 0 11.95-5.36 11.95-11.95a11.87 11.87 0 0 0-3.48-8.41ZM12.05 21.82a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.7.97.99-3.61-.24-.37a9.87 9.87 0 0 1-1.51-5.27c0-5.47 4.45-9.92 9.93-9.92a9.85 9.85 0 0 1 7.02 2.91 9.85 9.85 0 0 1 2.9 7.02c0 5.48-4.45 9.93-9.98 9.93Z" />
          <path d="M17.5 14.37c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z" />
        </svg>
      </div>
      <h3 className="pe-acceso-titulo">Mensajes de cobranza</h3>
      <p className="pe-acceso-desc">Personalizar el cierre de WhatsApp</p>
    </button>
    {abierto && <div className="cxc-modal-overlay">
      <div className="cxc-modal" role="dialog" aria-modal="true" aria-labelledby="cobranza-titulo" onKeyDown={e => { if (e.key === 'Escape') cerrar(); }} style={{ maxWidth: 560 }}>
        <div className="cxc-modal-header"><h2 id="cobranza-titulo">Mensajes de cobranza</h2><button onClick={cerrar} disabled={guardando} aria-label="Cerrar">✕</button></div>
        <form className="cxc-modal-form" onSubmit={async e => {
          e.preventDefault();
          if (!query.isSuccess || guardando) return;
          setError(null);
          try {
            const parrafo = normalizarParrafoCobranza(texto);
            setGuardando(true);
            const { data, error: dbError } = await supabase.from('configuracion_cobranza')
              .upsert({ escuela_id: escuelaId, parrafo_final: parrafo }, { onConflict: 'escuela_id' })
              .select('parrafo_final').single();
            if (dbError) throw dbError;
            queryClient.setQueryData(configuracionCobranzaKey(escuelaId), data.parrafo_final);
            setAbierto(false);
          } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración. Intenta nuevamente.'); }
          finally { setGuardando(false); }
        }}>
          {query.isPending && <p role="status">Cargando configuración…</p>}
          {query.isError && <p role="alert">No se pudo cargar la configuración. <button type="button" onClick={() => void query.refetch()}>Reintentar</button></p>}
          {query.isSuccess && <>
            <div className="form-campo">
              <label htmlFor="cobranza-parrafo">Párrafo final de cobranza por WhatsApp</label>
              <textarea id="cobranza-parrafo" rows={6} value={texto} disabled={guardando} aria-describedby="cobranza-ayuda cobranza-contador"
                onChange={e => { if (contarCaracteresCobranza(e.target.value) <= 600) setBorrador(e.target.value); }} />
              <small id="cobranza-contador">{longitud}/600 caracteres</small>
              <small id="cobranza-ayuda">Si lo dejas vacío, se utilizará el mensaje predeterminado.</small>
            </div>
            <button type="button" disabled={guardando} onClick={() => setBorrador('')}>Restaurar predeterminado</button>
            <p>Vista previa del cierre</p>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>{resolverParrafoCobranza(texto)}</div>
          </>}
          {error && <p role="alert">{error}</p>}
          <div className="cxc-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" onClick={cerrar} disabled={guardando}>Cancelar</button>
            <button type="submit" disabled={guardando || !query.isSuccess || longitud > 600}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}
