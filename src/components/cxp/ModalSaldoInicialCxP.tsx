/**
 * ModalSaldoInicialCxP.tsx
 * Modal para registrar saldos iniciales de deuda a proveedores.
 * Genera un registro en cuentas_pagar y un asiento contable:
 *   DEBE: 3.2.1 (Capital Social Ajustes)
 *   HABER: 2.1.x (Pasivo Corriente seleccionado)
 */
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, DollarSign, Users, AlignLeft, AlertCircle, Check, RefreshCw, BookOpen, Tag } from 'lucide-react';
import { getHoyISO } from '../../lib/dateUtils';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  visible: boolean;
  onCerrar: () => void;
  onCreado: () => void;
  edicionItem?: any;
}

const ModalSaldoInicialCxP: React.FC<Props> = ({ visible, onCerrar, onCreado, edicionItem }) => {
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [personal, setPersonal] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [cuentasPasivo, setCuentasPasivo] = useState<{ id: string; codigo: string; nombre: string }[]>([]);

  const [tipoBeneficiario, setTipoBeneficiario] = useState<'proveedor' | 'personal'>('proveedor');
  const [naturalezaSaldo, setNaturalezaSaldo] = useState<'deuda' | 'anticipo'>('deuda');
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [cuentaPasivoId, setCuentaPasivoId] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(getHoyISO());
  const [descripcion, setDescripcion] = useState('Saldo inicial de deuda');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    if (edicionItem) {
      setTipoBeneficiario(edicionItem.tipo_gasto || 'proveedor');
      setNaturalezaSaldo((edicionItem.observaciones || '').startsWith('SIA-') ? 'anticipo' : 'deuda');
      setProveedorId(edicionItem.proveedor_id || '');
      setPersonalId(edicionItem.personal_id || '');
      setCuentaPasivoId(edicionItem.cuenta_contable_id || '');
      setMonto(String(edicionItem.monto_total || ''));
      setFecha(edicionItem.fecha_emision || getHoyISO());
      setDescripcion(edicionItem.descripcion || '');
      setError(null); setExito(null);
    } else {
      setProveedorId(''); setPersonalId(''); setCuentaPasivoId('');
      setMonto(''); setFecha(getHoyISO()); setDescripcion('Saldo inicial de deuda');
      setError(null); setExito(null);
    }

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const [resProv, resPers, resCtas] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombre'),
        supabase.from('personal').select('id, nombres, apellidos').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombres'),
        supabase.from('plan_cuentas').select('id, codigo, nombre')
          .eq('es_transaccional', true).eq('tipo', 'pasivo')
          .or(`escuela_id.eq.${usr.escuela_id},escuela_id.is.null`)
          .order('codigo'),
      ]);

      setProveedores(resProv.data ?? []);
      setPersonal(resPers.data ?? []);
      setCuentasPasivo(resCtas.data ?? []);
      if (resCtas.data && resCtas.data.length > 0) setCuentaPasivoId(resCtas.data[0].id);
    };
    cargar();
  }, [visible, edicionItem]);

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const beneficiarioId = tipoBeneficiario === 'proveedor' ? proveedorId : personalId;
    if (!beneficiarioId) { setError('Seleccione un beneficiario.'); return; }
    
    const esAnticipo = naturalezaSaldo === 'anticipo';
    if (!esAnticipo && !cuentaPasivoId) { setError('Seleccione una cuenta de pasivo.'); return; }
    
    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) { setError('Ingrese un monto válido mayor a 0.'); return; }

    setGuardando(true);

    try {
      if (edicionItem) {
        const { error: editErr } = await supabase.rpc('rpc_editar_saldo_inicial_cxp', {
          p_payload: {
            cxp_id: edicionItem.id,
            monto: valorMonto,
            fecha,
            descripcion: descripcion.trim()
          }
        });
        if (editErr) throw editErr;
        setExito(`✅ Saldo inicial actualizado correctamente.`);
        setTimeout(() => { onCreado(); }, 1500);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');
      const { data: ctx } = await supabase.from('usuarios')
        .select('id, escuela_id, sucursal_id, nombres, apellidos')
        .eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      // Buscar cuenta Capital Social Ajustes
      const { data: ctaCapital } = await supabase.from('plan_cuentas').select('id').eq('codigo', '3.2.1').single();
      if (!ctaCapital) throw new Error('No se encontró la cuenta 3.2.1 (Capital Social Ajustes).');

      let ctaContableCxp = cuentaPasivoId;
      if (esAnticipo) {
        const codigoAnticipo = tipoBeneficiario === 'proveedor' ? '1.1.6' : '1.1.7';
        const { data: ctaAnticipo } = await supabase.from('plan_cuentas').select('id').eq('codigo', codigoAnticipo).single();
        if (!ctaAnticipo) throw new Error(`No se encontró la cuenta de anticipo ${codigoAnticipo}.`);
        ctaContableCxp = ctaAnticipo.id;
      }

      // 1. Crear registro en cuentas_pagar
      const { data: nuevaCxp, error: errCxp } = await supabase.from('cuentas_pagar').insert({
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        tipo_gasto: tipoBeneficiario,
        proveedor_id: tipoBeneficiario === 'proveedor' ? beneficiarioId : null,
        personal_id: tipoBeneficiario === 'personal' ? beneficiarioId : null,
        cuenta_contable_id: ctaContableCxp,
        descripcion: descripcion.trim() || (esAnticipo ? 'Saldo inicial de anticipo' : 'Saldo inicial de deuda'),
        observaciones: (esAnticipo ? 'SIA-' : 'SI-') + Date.now().toString().slice(-6),
        monto_total: valorMonto,
        fecha_emision: fecha,
        estado: 'pendiente', 
      }).select('id').single();

      if (errCxp || !nuevaCxp) throw new Error(`Error al crear CxP: ${errCxp?.message || 'desconocido'}`);

      // Crear detalle
      await supabase.from('cxp_detalle').insert({
        escuela_id: ctx.escuela_id,
        cuenta_pagar_id: nuevaCxp.id,
        descripcion: descripcion.trim() || 'Saldo inicial',
        cantidad: 1,
        precio_unitario: valorMonto,
        cuenta_gasto_id: ctaContableCxp,
      });

      // 2. Crear asiento contable
      const movimientos = esAnticipo ? [
        { cuenta_contable_id: ctaContableCxp, debe: valorMonto, haber: 0 },
        { cuenta_contable_id: ctaCapital.id, debe: 0, haber: valorMonto }
      ] : [
        { cuenta_contable_id: ctaCapital.id, debe: valorMonto, haber: 0 },
        { cuenta_contable_id: ctaContableCxp, debe: 0, haber: valorMonto }
      ];

      const pagos = esAnticipo ? [
        { cuenta_pagar_id: nuevaCxp.id, monto_aplicado: valorMonto }
      ] : undefined;

      const { data: vAsientoId, error: rpcErr } = await supabase.rpc('rpc_procesar_transaccion_financiera', {
        p_payload: {
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          usuario_id: ctx.id,
          descripcion: `Saldo Inicial CxP${esAnticipo ? ' (Anticipo)' : ''}: ${descripcion.trim()}`,
          metodo_pago: 'efectivo',
          nro_transaccion: null,
          fecha,
          movimientos,
          pagos,
          origen_tipo: 'cxp',
          origen_id: nuevaCxp.id,
        }
      });

      if (rpcErr) throw new Error(`Error en asiento contable: ${rpcErr.message}`);

      // Actualizar la nota con el ID del asiento para futura anulación
      if (vAsientoId) {
        await supabase.from('cuentas_pagar').update({ asiento_id: vAsientoId }).eq('id', nuevaCxp.id);
      }

      // 3. Auditoría
      await supabase.from('audit_log').insert({
        escuela_id: ctx.escuela_id, usuario_id: ctx.id,
        usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
        accion: 'saldo_inicial', modulo: 'cxp', entidad_id: nuevaCxp.id,
        detalle: { monto: valorMonto, descripcion: descripcion.trim() },
      });

      setExito(`✅ Saldo inicial de Bs ${fmtMonto(valorMonto)} registrado correctamente.`);
      setTimeout(() => { onCreado(); }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal cxc-modal--entidad" onClick={e => e.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{
              background: 'rgba(168, 85, 255, 0.15)',
              color: '#A855F7'
            }}>
              <BookOpen size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Saldo Inicial — CxP</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Registra una deuda inicial a un proveedor o personal
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ padding: '0.5rem 0' }}>
            {/* Naturaleza del Saldo */}
            <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
              <label>Naturaleza del Saldo *</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={() => setNaturalezaSaldo('deuda')}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid',
                    borderColor: naturalezaSaldo === 'deuda' ? 'var(--danger)' : 'var(--border)',
                    background: naturalezaSaldo === 'deuda' ? 'var(--danger)' : 'transparent',
                    color: naturalezaSaldo === 'deuda' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 600, cursor: 'pointer'
                  }}
                >Deuda (Nos toca pagar)</button>
                <button type="button" onClick={() => setNaturalezaSaldo('anticipo')}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid',
                    borderColor: naturalezaSaldo === 'anticipo' ? 'var(--success)' : 'var(--border)',
                    background: naturalezaSaldo === 'anticipo' ? 'var(--success)' : 'transparent',
                    color: naturalezaSaldo === 'anticipo' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 600, cursor: 'pointer'
                  }}
                >Anticipo (Adelantamos dinero)</button>
              </div>
            </div>

            {/* Tipo beneficiario */}
            <div className="form-campo full-width">
              <label>Tipo de Entidad</label>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={() => setTipoBeneficiario('proveedor')}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid',
                    borderColor: tipoBeneficiario === 'proveedor' ? 'var(--secondary)' : 'var(--border)',
                    background: tipoBeneficiario === 'proveedor' ? 'var(--secondary)' : 'transparent',
                    color: tipoBeneficiario === 'proveedor' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 600, cursor: 'pointer'
                  }}
                >Proveedor</button>
                <button type="button" onClick={() => setTipoBeneficiario('personal')}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid',
                    borderColor: tipoBeneficiario === 'personal' ? 'var(--success)' : 'var(--border)',
                    background: tipoBeneficiario === 'personal' ? 'var(--success)' : 'transparent',
                    color: tipoBeneficiario === 'personal' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 600, cursor: 'pointer'
                  }}
                >Personal</button>
              </div>
            </div>

            {/* Selector de beneficiario */}
            <div className="form-campo full-width">
              <label><Users size={14} /> {tipoBeneficiario === 'proveedor' ? 'Proveedor' : 'Personal'} *</label>
              {tipoBeneficiario === 'proveedor' ? (
                <select value={proveedorId} onChange={e => setProveedorId(e.target.value)} required disabled={guardando}>
                  <option value="">— Seleccionar proveedor —</option>
                  {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              ) : (
                <select value={personalId} onChange={e => setPersonalId(e.target.value)} required disabled={guardando}>
                  <option value="">— Seleccionar personal —</option>
                  {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
                </select>
              )}
            </div>

            {/* Cuenta de pasivo / activo */}
            {naturalezaSaldo === 'deuda' ? (
              <div className="form-campo full-width">
                <label><Tag size={14} /> Cuenta de Pasivo *</label>
                <select value={cuentaPasivoId} onChange={e => setCuentaPasivoId(e.target.value)} required disabled={guardando}>
                  <option value="">— Seleccionar cuenta —</option>
                  {cuentasPasivo.map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}
                </select>
              </div>
            ) : (
              <div className="form-campo full-width">
                <label><Tag size={14} /> Cuenta de Activo (Anticipo)</label>
                <input
                  type="text"
                  value={tipoBeneficiario === 'proveedor' ? '1.1.6 — Anticipo a Proveedores' : '1.1.7 — Anticipo a Personal'}
                  disabled
                  style={{ background: 'var(--bg-glass)', opacity: 0.8 }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem' }} className="full-width">
              <div className="form-campo" style={{ flex: 1 }}>
                <label><DollarSign size={14} /> Monto del Saldo Inicial (Bs) *</label>
                <input
                  type="number" step="0.01" min="0.01"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  required disabled={guardando}
                  placeholder="0.00"
                  style={{ fontSize: '1.2rem', fontWeight: 700, color: '#FF6B35' }}
                />
              </div>

              <div className="form-campo" style={{ flex: 1 }}>
                <label>Fecha de Emisión *</label>
                <input
                  type="date"
                  value={fecha}
                  onChange={e => setFecha(e.target.value)}
                  required disabled={guardando}
                  style={{ fontSize: '1.2rem' }}
                />
              </div>
            </div>

            <div className="form-campo full-width">
              <label><AlignLeft size={14} /> Descripción / Concepto</label>
              <input
                type="text"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                disabled={guardando}
                placeholder="Ej: Saldo de deuda acumulada"
              />
            </div>
          </div>

          <div style={{ background: 'rgba(168, 85, 247, 0.08)', borderRadius: '8px', padding: '0.75rem 1rem', margin: '1rem 0', border: '1px solid rgba(168, 85, 247, 0.15)' }}>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {naturalezaSaldo === 'deuda' ? (
                <><strong style={{ color: '#A855F7' }}>Asiento automático:</strong> DEBE → 3.2.1 (Capital Social Ajustes) | HABER → Pasivo Corriente seleccionado</>
              ) : (
                <><strong style={{ color: '#00D26A' }}>Asiento automático:</strong> DEBE → Cuenta de Anticipo | HABER → 3.2.1 (Capital Social Ajustes)</>
              )}
            </p>
          </div>

          {error && (
            <div className="form-msg form-msg--error" style={{ margin: '1rem 0' }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {exito && (
            <div className="form-msg form-msg--exito" style={{ margin: '1rem 0' }}>
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
            <button type="button" className="btn-refrescar" onClick={onCerrar} disabled={guardando}>Cancelar</button>
            <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !!exito}
              style={{ padding: '0.6rem 2rem', background: '#A855F7', borderColor: '#A855F7' }}>
              {guardando ? (
                <> <RefreshCw size={16} className="spin" /> {edicionItem ? 'Actualizando...' : 'Registrando...'} </>
              ) : (
                <> <Check size={16} /> {edicionItem ? 'Guardar Cambios' : 'Registrar Saldo Inicial'} </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalSaldoInicialCxP;
