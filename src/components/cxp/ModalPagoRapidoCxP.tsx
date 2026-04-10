import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CuentaContable } from '../../types/finanzas';
import { X, CreditCard, AlertCircle, Check, MessageCircle, FileText } from 'lucide-react';

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface EntidadCxP {
  id: string;
  tipo: 'proveedor' | 'personal';
  nombre: string;
  categoria: string;
  cargo?: string;
  telefono?: string;
  saldo_pendiente: number;
}

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
  const [cuentasPago, setCuentasPago] = useState<CuentaContable[]>([]);

  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [cuentaId, setCuentaId] = useState('');
  const [nroDoc, setNroDoc] = useState('');

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

      let q = supabase.from('plan_cuentas').select('*')
        .eq('es_transaccional', true)
        .or('codigo.like.1.1.1.%,codigo.like.1.1.2.%');
      if (!esAdmin && usr.sucursal_id) {
        q = q.or(`sucursal_id.eq.${usr.sucursal_id},sucursal_id.is.null`);
      }
      const { data: cuentas } = await q.order('codigo');
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
    
    // Si es un anticipo, creamos una nota dinámica de CxP apuntando a la 1.1.6 (Anticipo a Proveedores)
    if (cxpSelId === 'anticipo') {
        const { data: ctaAnticipo } = await supabase.from('plan_cuentas').select('id').eq('codigo', '1.1.6').single();
        if (!ctaAnticipo) { setError('No se encontró la cuenta 1.1.6 (Anticipo a Proveedores).'); setGuardando(false); return; }
        
        const payloadCxp = {
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            tipo_gasto: entidadSel.tipo,
            proveedor_id: entidadSel.tipo === 'proveedor' ? entidadSel.id : null,
            personal_id: entidadSel.tipo === 'personal' ? entidadSel.id : null,
            numero_documento: nroDoc.trim() || 'S/N',
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
        referencia: 'Pago Rápido'
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
    <div className="cxc-modal-overlay" onClick={() => !guardando && onCerrar()}>
      <div className="cxc-modal cxc-modal--cobro-rapido" onClick={e => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="cxc-modal-header">
          <h2><CreditCard size={20} style={{ marginRight: '0.5rem' }} /> Registrar Pago / Anticipo</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>

        <div className="cxc-modal-form">
          {!entidadInicial ? (
            <div className="form-campo">
              <label>Pagar a (Proveedor / Personal)</label>
              <select
                value={entidadSel?.id || ''}
                onChange={e => setEntidadSel(entidades.find(a => a.id === e.target.value) || null)}
              >
                <option value="">— Seleccionar —</option>
                {entidades.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.nombre} ({a.tipo === 'proveedor' ? 'Proveedor' : 'Personal'}) — Bs {fmtMonto(a.saldo_pendiente)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="cxc-cobro-alumno">
              <div className="cxc-alumno-avatar" style={{ width: '44px', height: '44px', fontSize: '1rem', background: 'var(--accent)' }}>
                {entidadSel?.nombre[0]}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{entidadSel?.nombre}</div>
                <div style={{ color: 'var(--warning)', fontSize: '0.9rem' }}>
                  Deuda Total: Bs {fmtMonto(entidadSel?.saldo_pendiente || 0)}
                </div>
              </div>
            </div>
          )}

          {entidadSel && (
            <div className="form-campo">
              <label>Nota a pagar</label>
              <select value={cxpSelId} onChange={e => handleChangeCxp(e.target.value)}>
                {cxpsPendientes.length > 0 && <optgroup label="Notas Pendientes">
                  {cxpsPendientes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.numero_documento} {c.descripcion || ''} — Saldo: Bs {fmtMonto(Number(c.deuda_restante))}
                    </option>
                  ))}
                </optgroup>}
                <optgroup label="Otros">
                  <option value="anticipo">🌟 Registrar como Anticipo</option>
                </optgroup>
              </select>
            </div>
          )}

          {(cxpSel || cxpSelId === 'anticipo') && (
            <form onSubmit={registrar} style={{ display: 'contents' }}>
              <div className="nota-pago-campos">
                <div className="form-campo">
                  <label>Monto a pagar (Bs)</label>
                  <input
                    type="number" step="0.01" min="0.01" max={cxpSelId === 'anticipo' ? undefined : saldoCxp}
                    value={monto}
                    onChange={e => setMonto(e.target.value)}
                    required disabled={guardando}
                    placeholder={cxpSelId === 'anticipo' ? 'Monto del anticipo' : `Máx. Bs ${fmtMonto(saldoCxp)}`}
                  />
                </div>
                <div className="form-campo">
                  <label>Método de pago</label>
                  <select value={metodo} onChange={e => setMetodo(e.target.value)} disabled={guardando}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="qr">QR</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div className="form-campo">
                  <label>Caja / Banco de salida</label>
                  <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} required disabled={guardando}>
                    <option value="">— Seleccionar —</option>
                    {cuentasPago.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-campo" style={{ gridColumn: '1 / -1' }}>
                   <label>Nro. Comprobante (opcional)</label>
                   <input type="text" placeholder="Nro. recibo o referencia" value={nroDoc} onChange={e => setNroDoc(e.target.value)} disabled={guardando} />
                </div>
              </div>

              {error && <div className="form-msg form-msg--error"><AlertCircle size={16} /> {error}</div>}
              {exito && <div className="form-msg form-msg--exito"><Check size={16} /> {exito}</div>}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="nota-wa-btn-omitir" onClick={onCerrar} disabled={guardando}>
                  Cancelar
                </button>
                <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !!exito}>
                  <CreditCard size={16} /> {guardando ? 'Registrando...' : 'Registrar Pago'}
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
