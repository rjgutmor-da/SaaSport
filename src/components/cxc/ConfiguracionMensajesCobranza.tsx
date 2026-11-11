import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
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
    <button className="pe-acceso-card" onClick={() => { setBorrador(undefined); setError(null); setAbierto(true); }}>
      <MessageCircle size={24} aria-hidden="true" />
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
