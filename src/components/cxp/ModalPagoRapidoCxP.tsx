import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CajaBanco } from '../../types/finanzas';
import type { EntidadCxP } from '../../types/cxp';
import { X, CreditCard, AlertCircle, Check, MessageCircle, FileText, Users, RefreshCw, DollarSign, Building2, Hash, Calendar } from 'lucide-react';

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


interface Props {
  entidadInicial: EntidadCxP | null;
  entidades: EntidadCxP[];
  visible: boolean;
  onCerrar: () => void;
  onPagado: () => void;
}

const ModalPagoRapidoCxP: React.FC<Props> = ({ entidadInicial, entidades, visible, onCerrar, onPagado }) => {
  const [entidadSel, setEntidadSel] = useState<EntidadCxP | null>(entidadInicial);
  const [cxpsPendientes, setCxpsPendientes] = useState<any[]>([]);
  const [cxpSelId, setCxpSelId] = useState('');
  const [cuentasPago, setCuentasPago] = useState<CajaBanco[]>([]);

  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [cuentaId, setCuentaId] = useState('');
  const [nroDoc, setNroDoc] = useState('');
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  
  useEffect(() => {
     setEntidadSel(entidadInicial);
  }, [entidadInicial]);

  // Cargar datos al abrir (Cuentas activas 1.1.1 y 1.1.2)
  useEffect(() => {
    if (!visible) return;
    setError(null); setExito(null);

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: usr } = await supabase.from('usuarios')
        .select('escuela_id, sucursal_id, rol')
        .eq('id', user.id).single();
      if (!usr) return;

      const esAdmin = usr.rol === 'SuperAdministrador' || usr.rol === 'Dueño';

      let q = supabase.from('cajas_bancos').select('*').eq('activo', true);
      if (!esAdmin && usr.sucursal_id) {
        q = q.or(`sucursal_id.eq.${usr.sucursal_id},sucursal_id.is.null`);
      }
      const { data: cuentas } = await q.order('nombre');
      setCuentasPago(cuentas ?? []);
      if (cuentas && cuentas.length > 0) setCuentaId(cuentas[0].id);
    };
    cargar();
  }, [visible]);

  // Al cambiar entidad seleccionada, cargar sus CxP pendientes
  useEffect(() => {
    if (!entidadSel) { setCxpsPendientes([]); setCxpSelId(''); return; }
    const cargarCxp = async () => {
      const q = supabase
        .from('v_estado_cuentas_pagar')
        .select('*')
        .neq('estado', 'pagada')
        .order('fecha_emision', { ascending: true });

      if (entidadSel.tipo === 'proveedor') q.eq('proveedor_id', entidadSel.id);
      if (entidadSel.tipo === 'personal') q.eq('personal_id', entidadSel.id);

      const { data } = await q;
      const lista = data ?? [];
      setCxpsPendientes(lista);
      if (lista.length > 0) {
        setCxpSelId(lista[0].id);
        setMonto(String(Number(lista[0].deuda_restante)));
      } else {
        setCxpSelId('anticipo');
        setMonto('');
      }
    };
    cargarCxp();
  }, [entidadSel]);

  const handleChangeCxp = (id: string) => {
    setCxpSelId(id);
    if (id === 'anticipo') {
        setMonto('');
        return;
    }
    const cxp = cxpsPendientes.find(c => c.id === id);
    if (cxp) setMonto(String(Number(cxp.deuda_restante)));
  };

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entidadSel || !cxpSelId) { setError('Selecciona un destino y una nota pendiente o anticipo.'); return; }
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { setError('Monto inválido.'); return; }
    if (!cuentaId) { setError('Selecciona la cuenta de salida (caja/banco).'); return; }

    setGuardando(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Error de autenticación.'); setGuardando(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id, nombres, apellidos')
      .eq('id', user.id).single();
    if (!ctx) { setError('Error de contexto.'); setGuardando(false); return; }

    let objetivoCxpId = cxpSelId;
    
    // Si es un anticipo, creamos una nota dinámica de CxP apuntando a la 1.1.6 (Anticipo a Proveedores) o 1.1.7 (Anticipo a Personal)
    if (cxpSelId === 'anticipo') {
        const codigoCuentaAnticipo = entidadSel.tipo === 'personal' ? '1.1.7' : '1.1.6';
        const { data: ctaAnticipo } = await supabase.from('plan_cuentas').select('id').eq('codigo', codigoCuentaAnticipo).single();
        if (!ctaAnticipo) { setError(`No se encontró la cuenta ${codigoCuentaAnticipo} (Anticipo a ${entidadSel.tipo === 'personal' ? 'Personal' : 'Proveedores'}).`); setGuardando(false); return; }
        
        const payloadCxp = {
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            tipo_gasto: entidadSel.tipo,
            proveedor_id: entidadSel.tipo === 'proveedor' ? entidadSel.id : null,
            personal_id: entidadSel.tipo === 'personal' ? entidadSel.id : null,
            // Quitamos numero_documento porque no existe en la tabla y los anticipos son directos,
            // o lo guardamos en 'observaciones' si es necesario, pero según el schema la descripción ya está.
            descripcion: 'Anticipo',
            monto_total: montoNum,
            estado: 'pendiente'
        };

        const { data: nuevaNota, error: errCxp } = await supabase.from('cuentas_pagar').insert(payloadCxp).select('id').single();

        if (errCxp || !nuevaNota) { setError('Error al crear nota de anticipo en CxP.'); setGuardando(false); return; }
        objetivoCxpId = nuevaNota.id;

        // Crear detalle para consistencia (obligatorio para la contabilidad si rpc depende de esto)
        await supabase.from('cxp_detalle').insert({
            escuela_id: ctx.escuela_id,
            cuenta_pagar_id: nuevaNota.id,
            descripcion: 'Anticipo',
            cantidad: 1,
            precio_unitario: montoNum,
            cuenta_gasto_id: ctaAnticipo.id // Aca entra el activo "Anticipo a Proveedores"
        });
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc('rpc_registrar_pago_cxp', {
      p_payload: {
        cuenta_pagar_id: objetivoCxpId,
        monto: montoNum,
        metodo_pago: metodo,
        cuenta_origen_id: cuentaId,
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        usuario_id: ctx.id,
        nro_comprobante: nroDoc.trim() || null,
        referencia: 'Pago Rápido',
        fecha: fechaPago
      }
    });

    if (rpcErr) { setError(`Error: ${rpcErr.message}`); setGuardando(false); return; }

    // Auditoría
    await supabase.from('audit_log').insert({
      escuela_id: ctx.escuela_id, usuario_id: ctx.id,
      usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
      accion: 'pago', modulo: 'cxp', entidad_id: objetivoCxpId,
      detalle: { monto: montoNum, metodo_pago: metodo, nuevo_estado: rpcData?.nuevo_estado },
    });

    const estadoMsg = rpcData?.nuevo_estado === 'pagada' ? '¡CxP liquidada!' : `Saldo restante: Bs ${fmtMonto(rpcData?.deuda_restante || 0)}`;
    setExito(`✅ Pago registrado exitosamente. ${estadoMsg}`);
    setGuardando(false);

    setTimeout(() => {
      onPagado();
      onCerrar();
    }, 2000);
  };

  if (!visible) return null;

  const cxpSel = cxpsPendientes.find(c => c.id === cxpSelId);
  const saldoCxp = cxpSel ? Number(cxpSel.deuda_restante) : 0;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: 'rgba(255, 107, 53, 0.15)',
              color: '#FF6B35'
            }}>
              <CreditCard size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Registrar Pago / Anticipo</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Liquida una deuda pendiente o registra un adelanto
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <div className="cxc-modal-form">
          {!entidadInicial ? (
            <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
              <label><Users size={14} /> Pagar a (Proveedor / Personal) *</label>
              <select
                value={entidadSel?.id || ''}
                onChange={e => setEntidadSel(entidades.find(a => a.id === e.target.value) || null)}
                style={{ fontSize: '1rem', padding: '0.8rem' }}
              >
                <option value="">— Seleccionar —</option>
                {entidades.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.nombre} ({a.tipo === 'proveedor' ? 'Prov' : 'Pers'}) — Saldo: Bs {fmtMonto(a.saldo_pendiente)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="cxc-cobro-alumno" style={{ marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="cxc-alumno-avatar" style={{ 
                  width: '50px', 
                  height: '50px', 
                  fontSize: '1.2rem', 
                  borderRadius: '12px',
                  background: entidadSel?.tipo === 'proveedor' ? 'var(--secondary)' : 'var(--success)'
              }}>
                {entidadSel?.nombre[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{entidadSel?.nombre}</div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.2rem' }}>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{entidadSel?.tipo === 'proveedor' ? 'Proveedor' : 'Trabajador'}</span>
                    <span style={{ color: 'var(--warning)', fontWeight: 700, fontSize: '0.85rem' }}>Deuda Total: Bs {fmtMonto(entidadSel?.saldo_pendiente || 0)}</span>
                </div>
              </div>
            </div>
          )}

          {entidadSel && (
            <div className="form-campo full-width" style={{ marginBottom: '1.5rem' }}>
              <label><FileText size={14} /> Nota / Documento a Liquidar *</label>
              <select 
                value={cxpSelId} 
                onChange={e => handleChangeCxp(e.target.value)}
                style={{ background: 'var(--bg-glass)', fontWeight: 600 }}
              >
                {cxpsPendientes.length > 0 && <optgroup label="Deudas Pendientes">
                  {cxpsPendientes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.numero_documento} {c.descripcion || ''} — Saldo: Bs {fmtMonto(Number(c.deuda_restante))}
                    </option>
                  ))}
                </optgroup>}
                <optgroup label="Otras Acciones">
                  <option value="anticipo">🌟 Registrar como Anticipo (Adelante)</option>
                </optgroup>
              </select>
            </div>
          )}

          {(cxpSel || cxpSelId === 'anticipo') && (
            <form onSubmit={registrar} style={{ display: 'contents' }}>
              <div className="modal-form-grid">
                <div className="form-campo">
                  <label><DollarSign size={14} /> Monto a pagar *</label>
                  <input
                    type="number" step="0.01" min="0.01" max={cxpSelId === 'anticipo' ? undefined : saldoCxp}
                    value={monto}
                    onChange={e => setMonto(e.target.value)}
                    required disabled={guardando}
                    placeholder="0.00"
                    style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FF6B35' }}
                  />
                </div>

                <div className="form-campo">
                  <label><Calendar size={14} /> Fecha de Pago *</label>
                  <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} required disabled={guardando} />
                </div>

                <div className="form-campo">
                  <label><Hash size={14} /> Nro. Transacción</label>
                  <input type="text" value={metodo} onChange={e => setMetodo(e.target.value)} disabled={guardando} placeholder="Ej: 00123, REC-001..." />
                </div>

                <div className="form-campo full-width">
                  <label><Building2 size={14} /> Caja / Banco de Salida *</label>
                  <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} required disabled={guardando}>
                    <option value="">— Seleccionar origen —</option>
                    {cuentasPago.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="form-campo full-width">
                   <label><Hash size={14} /> Nro. Comprobante / Referencia (Opcional)</label>
                   <input type="text" placeholder="Ej: Recibo 123, Transferencia #88..." value={nroDoc} onChange={e => setNroDoc(e.target.value)} disabled={guardando} />
                </div>
              </div>

              {error && (
                <div className="form-msg form-msg--error" style={{ marginTop: '1.5rem' }}>
                  <AlertCircle size={18} /> {error}
                </div>
              )}
              {exito && (
                <div className="form-msg form-msg--exito" style={{ marginTop: '1.5rem' }}>
                  <Check size={18} /> {exito}
                </div>
              )}

              <div className="cxc-modal-footer" style={{ 
                marginTop: '1.5rem', 
                paddingTop: '1.25rem',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '1rem'
              }}>
                <button type="button" className="btn-refrescar" onClick={onCerrar} disabled={guardando} style={{ borderRadius: '8px', padding: '0 1.5rem', width: 'auto' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !!exito} style={{ padding: '0.6rem 2rem' }}>
                  {guardando ? (
                    <> <RefreshCw size={16} className="spin" /> Registrando... </>
                  ) : (
                    <> <Check size={18} /> Confirmar Pago </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModalPagoRapidoCxP;
