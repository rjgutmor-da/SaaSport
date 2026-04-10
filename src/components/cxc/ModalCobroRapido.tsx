/**
 * ModalCobroRapido.tsx
 * Modal de cobro rápido accesible desde la lista principal de alumnos.
 * Muestra las CxC pendientes del alumno y permite registrar un pago.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda, CuentaCobrar } from '../../types/cxc';
import type { CuentaContable } from '../../types/finanzas';
import { X, CreditCard, AlertCircle, Check, MessageCircle } from 'lucide-react';

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  alumnoInicial: AlumnoDeuda | null;
  visible: boolean;
  onCerrar: () => void;
  onCobrado: () => void;
}

const ModalCobroRapido: React.FC<Props> = ({ alumnoInicial, visible, onCerrar, onCobrado }) => {
  const [alumnos, setAlumnos] = useState<AlumnoDeuda[]>([]);
  const [alumnoSel, setAlumnoSel] = useState<AlumnoDeuda | null>(alumnoInicial);
  const [cxcsPendientes, setCxcsPendientes] = useState<CuentaCobrar[]>([]);
  const [cxcSelId, setCxcSelId] = useState('');
  const [cuentasCobro, setCuentasCobro] = useState<CuentaContable[]>([]);

  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [cuentaId, setCuentaId] = useState('');
  const [bancoOrigen, setBancoOrigen] = useState('');
  const [hora, setHora] = useState('');
  const [nroDoc, setNroDoc] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [mensajeWA, setMensajeWA] = useState<{ texto: string; telefono: string } | null>(null);

  // Cargar datos al abrir
  useEffect(() => {
    if (!visible) return;
    setError(null); setExito(null); setMensajeWA(null);

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: usr } = await supabase.from('usuarios')
        .select('escuela_id, sucursal_id, rol')
        .eq('id', user.id).single();
      if (!usr) return;

      const esAdmin = usr.rol === 'SuperAdministrador' || usr.rol === 'Dueño';

      // Cargar lista de todos los alumnos
      const { data: listaAlumnos } = await supabase
        .from('v_alumnos_deuda')
        .select('*')
        .eq('escuela_id', usr.escuela_id);
      setAlumnos((listaAlumnos as unknown as AlumnoDeuda[]) ?? []);

      // Cargar cuentas contables disponibles
      let q = supabase.from('plan_cuentas').select('*')
        .eq('es_transaccional', true)
        .or('codigo.like.1.1.1.%,codigo.like.1.1.2.%');
      if (!esAdmin && usr.sucursal_id) {
        q = q.or(`sucursal_id.eq.${usr.sucursal_id},sucursal_id.is.null`);
      }
      const { data: cuentas } = await q.order('codigo');
      setCuentasCobro(cuentas ?? []);
      if (cuentas && cuentas.length > 0) setCuentaId(cuentas[0].id);
    };
    cargar();
  }, [visible]);

  // Al cambiar alumno seleccionado, cargar sus CxC pendientes
  useEffect(() => {
    if (!alumnoSel) { setCxcsPendientes([]); setCxcSelId(''); return; }
    const cargarCxc = async () => {
      const { data } = await supabase
        .from('v_cuentas_cobrar')
        .select('*')
        .eq('alumno_id', alumnoSel.alumno_id)
        .neq('estado', 'pagada')
        .eq('anulada', false)
        .order('created_at', { ascending: true });
      const lista = (data as unknown as CuentaCobrar[]) ?? [];
      setCxcsPendientes(lista);
      setCxcsPendientes(lista);
      if (lista.length > 0) {
        setCxcSelId(lista[0].id);
        setMonto(String(Number(lista[0].saldo_pendiente)));
      } else {
        setCxcSelId('anticipo');
        setMonto('');
      }
    };
    cargarCxc();
  }, [alumnoSel]);

  const handleChangeCxc = (id: string) => {
    setCxcSelId(id);
    if (id === 'anticipo') {
        setMonto('');
        return;
    }
    const cxc = cxcsPendientes.find(c => c.id === id);
    if (cxc) setMonto(String(Number(cxc.saldo_pendiente)));
  };

    const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alumnoSel || !cxcSelId) { setError('Selecciona un alumno y una nota pendiente o anticipo.'); return; }
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { setError('Monto inválido.'); return; }
    if (!cuentaId) { setError('Selecciona la caja/banco destino.'); return; }

    setGuardando(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Error de autenticación.'); setGuardando(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id, nombres, apellidos')
      .eq('id', user.id).single();
    if (!ctx) { setError('Error de contexto.'); setGuardando(false); return; }

    let objetivoCxcId = cxcSelId;
    
    // Si es un anticipo, creamos una nota de cuentas_cobrar dinámica en la 2.1.5 y la pagamos
    if (cxcSelId === 'anticipo') {
        const { data: ctaAnticipo } = await supabase.from('plan_cuentas').select('id').eq('codigo', '2.1.5').single();
        if (!ctaAnticipo) { setError('No se encontró la cuenta 2.1.5 (Cobros Anticipados).'); setGuardando(false); return; }
        
        const { data: nuevaNota, error: errCxc } = await supabase.from('cuentas_cobrar').insert({
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            alumno_id: alumnoSel.alumno_id,
            cuenta_contable_id: ctaAnticipo.id,
            monto_total: montoNum,
            descripcion: 'Cobro Anticipado',
            estado: 'pendiente'
        }).select('id').single();

        if (errCxc || !nuevaNota) { setError('Error al crear nota de anticipo.'); setGuardando(false); return; }
        objetivoCxcId = nuevaNota.id;

        // Crear detalle para consistencia
        await supabase.from('cxc_detalle').insert({
            escuela_id: ctx.escuela_id,
            cuenta_cobrar_id: nuevaNota.id,
            descripcion: 'Anticipo del cliente',
            cantidad: 1,
            precio_unitario: montoNum
        });
    }

    const partesRef: string[] = [];
    if (bancoOrigen.trim()) partesRef.push(`Banco: ${bancoOrigen.trim()}`);
    if (hora.trim()) partesRef.push(`He: ${hora.trim()}`);
    if (nroDoc.trim()) partesRef.push(`Nro: ${nroDoc.trim()}`);

    const { data: rpcData, error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
      p_payload: {
        cuenta_cobrar_id: objetivoCxcId,
        monto: montoNum,
        metodo_pago: metodo,
        cuenta_cobro_id: cuentaId,
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        usuario_id: ctx.id,
        nro_comprobante: partesRef.join(' | ') || null,
      }
    });

    if (rpcErr) { setError(`Error: ${rpcErr.message}`); setGuardando(false); return; }

    // Auditoría
    await supabase.from('audit_log').insert({
      escuela_id: ctx.escuela_id, usuario_id: ctx.id,
      usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
      accion: 'cobro', modulo: 'cxc', entidad_id: objetivoCxcId,
      detalle: { monto: montoNum, metodo_pago: metodo, nuevo_estado: rpcData?.nuevo_estado },
    });

    // Mensaje WhatsApp de recibo
    const esPadre = alumnoSel.whatsapp_preferido === 'padre';
    const telefono = esPadre
      ? (alumnoSel.telefono_padre || alumnoSel.telefono_madre)
      : (alumnoSel.telefono_madre || alumnoSel.telefono_padre);
    const tipoPago = rpcData?.nuevo_estado === 'pagada' ? 'pago total' : 'pago parcial';
    const cxcActual = cxcsPendientes.find(c => c.id === cxcSelId);

    if (telefono) {
      const telF = telefono.replace(/\D/g, '');
      const telFinal = telF.startsWith('591') ? telF : `591${telF}`;
      const texto = `Gracias por el ${tipoPago} de Bs ${fmtMonto(montoNum)} correspondiente a: ${cxcActual?.descripcion || 'servicios'}.`;
      setMensajeWA({ texto, telefono: telFinal });
    }

    const estadoMsg = rpcData?.nuevo_estado === 'pagada' ? '¡CxC completamente pagada!' : `Saldo restante: Bs ${fmtMonto(rpcData?.saldo_pendiente || 0)}`;
    setExito(`✅ Cobro registrado. ${estadoMsg}`);
    setGuardando(false);

    setTimeout(() => {
      onCobrado();
      if (!mensajeWA) onCerrar();
    }, 2000);
  };

  const enviarWA = () => {
    if (mensajeWA) {
      window.open(`https://wa.me/${mensajeWA.telefono}?text=${encodeURIComponent(mensajeWA.texto)}`, '_blank');
      setMensajeWA(null);
      onCerrar();
    }
  };

  if (!visible) return null;

  const cxcSel = cxcsPendientes.find(c => c.id === cxcSelId);
  const saldoCxc = cxcSel ? Number(cxcSel.saldo_pendiente) : 0;

  return (
    <div className="cxc-modal-overlay" onClick={() => !guardando && onCerrar()}>
      <div className="cxc-modal cxc-modal--cobro-rapido" onClick={e => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="cxc-modal-header">
          <h2><CreditCard size={20} style={{ marginRight: '0.5rem' }} /> Registrar Pago</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>

        <div className="cxc-modal-form">
          {/* Mensaje WhatsApp post-cobro */}
          {mensajeWA && (
            <div className="nota-wa-recibo" style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                {mensajeWA.texto}
              </p>
              <button className="nota-wa-btn-enviar" onClick={enviarWA}>
                <MessageCircle size={16} /> Enviar recibo por WhatsApp
              </button>
              <button className="nota-wa-btn-omitir" onClick={onCerrar}>Cerrar</button>
            </div>
          )}

          {/* Alumno */}
          {!mensajeWA && (
            <>
              {!alumnoInicial ? (
                <div className="form-campo">
                  <label>Alumno</label>
                  <select
                    value={alumnoSel?.alumno_id || ''}
                    onChange={e => setAlumnoSel(alumnos.find(a => a.alumno_id === e.target.value) || null)}
                  >
                    <option value="">— Seleccionar alumno —</option>
                    {alumnos.sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))
                      .map(a => (
                        <option key={a.alumno_id} value={a.alumno_id}>
                          {a.nombres} {a.apellidos} — Bs {fmtMonto(Number(a.saldo_pendiente))}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <div className="cxc-cobro-alumno">
                  <div className="cxc-alumno-avatar" style={{ width: '44px', height: '44px', fontSize: '1rem' }}>
                    {alumnoSel?.nombres[0]}{alumnoSel?.apellidos[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{alumnoSel?.nombres} {alumnoSel?.apellidos}</div>
                    <div style={{ color: 'var(--warning)', fontSize: '0.9rem' }}>
                      Saldo total: Bs {fmtMonto(Number(alumnoSel?.saldo_pendiente))}
                    </div>
                  </div>
                </div>
              )}

              {/* CxC a cubrir o Anticipo */}
              {alumnoSel && (
                <div className="form-campo">
                  <label>Nota de Servicio a cobrar</label>
                  <select value={cxcSelId} onChange={e => handleChangeCxc(e.target.value)}>
                    {cxcsPendientes.length > 0 && <optgroup label="Notas Pendientes">
                      {cxcsPendientes.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.descripcion || 'Sin descripción'} — Saldo: Bs {fmtMonto(Number(c.saldo_pendiente))}
                        </option>
                      ))}
                    </optgroup>}
                    <optgroup label="Otros">
                      <option value="anticipo">🌟 Registrar como Anticipo / Adelanto</option>
                    </optgroup>
                  </select>
                </div>
              )}

              {(cxcSel || cxcSelId === 'anticipo') && (
                <form onSubmit={registrar} style={{ display: 'contents' }}>
                  {/* Monto */}
                  <div className="nota-pago-campos">
                    <div className="form-campo">
                      <label>Monto a cobrar (Bs)</label>
                      <input
                        type="number" step="0.01" min="0.01" max={cxcSelId === 'anticipo' ? undefined : saldoCxc}
                        value={monto}
                        onChange={e => setMonto(e.target.value)}
                        required disabled={guardando}
                        placeholder={cxcSelId === 'anticipo' ? 'Monto del anticipo' : `Máx. Bs ${fmtMonto(saldoCxc)}`}
                      />
                    </div>
                    <div className="form-campo">
                      <label>Método de pago</label>
                      <select value={metodo} onChange={e => setMetodo(e.target.value)} disabled={guardando}>
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="qr">QR</option>
                      </select>
                    </div>
                    <div className="form-campo">
                      <label>Caja / Banco destino</label>
                      <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} required disabled={guardando}>
                        <option value="">— Seleccionar —</option>
                        {cuentasCobro.map(c => (
                          <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                      </select>
                    </div>
                    {(metodo === 'transferencia' || metodo === 'qr') && (
                      <>
                        <div className="form-campo">
                          <label>Banco origen</label>
                          <input type="text" placeholder="Ej: BNB, Tigo Money..." value={bancoOrigen} onChange={e => setBancoOrigen(e.target.value)} disabled={guardando} />
                        </div>
                        <div className="form-campo">
                          <label>Hora de transferencia</label>
                          <input type="time" value={hora} onChange={e => setHora(e.target.value)} disabled={guardando} />
                        </div>
                      </>
                    )}
                    <div className="form-campo">
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
                      <CreditCard size={16} /> {guardando ? 'Registrando...' : 'Registrar Cobro'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModalCobroRapido;
