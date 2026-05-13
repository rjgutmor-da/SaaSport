/**
 * ModalSaldoInicialCxP.tsx
 * Modal para registrar saldos iniciales de deuda a proveedores o personal.
 * Versión simplificada sin asientos contables.
 */
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, DollarSign, Users, AlignLeft, AlertCircle, Check, RefreshCw, BookOpen } from 'lucide-react';
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

  const [tipoBeneficiario, setTipoBeneficiario] = useState<'proveedor' | 'personal'>('proveedor');
  const [naturalezaSaldo, setNaturalezaSaldo] = useState<'deuda' | 'anticipo'>('deuda');
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
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
      setMonto(String(edicionItem.monto_total || ''));
      setFecha(edicionItem.fecha_emision || getHoyISO());
      setDescripcion(edicionItem.descripcion || '');
      setError(null); setExito(null);
    } else {
      setProveedorId(''); setPersonalId('');
      setMonto(''); setFecha(getHoyISO()); setDescripcion('Saldo inicial de deuda');
      setError(null); setExito(null);
    }

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const [resProv, resPers] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombre'),
        supabase.from('personal').select('id, nombres, apellidos').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombres'),
      ]);

      setProveedores(resProv.data ?? []);
      setPersonal(resPers.data ?? []);
    };
    cargar();
  }, [visible, edicionItem]);

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const beneficiarioId = tipoBeneficiario === 'proveedor' ? proveedorId : personalId;
    if (!beneficiarioId) { setError('Seleccione un beneficiario.'); return; }
    
    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) { setError('Ingrese un monto válido mayor a 0.'); return; }

    setGuardando(true);

    try {
      // Caso Edición
      if (edicionItem) {
        const { error: editErr } = await supabase
          .from('cuentas_pagar')
          .update({
            monto_total: valorMonto,
            fecha_emision: fecha,
            descripcion: descripcion.trim(),
            updated_at: new Date().toISOString()
          })
          .eq('id', edicionItem.id);
          
        if (editErr) throw editErr;
        setExito(`✅ Saldo inicial actualizado correctamente.`);
        setTimeout(() => { onCreado(); }, 1500);
        return;
      }

      // Caso Nuevo
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');
      const { data: ctx } = await supabase.from('usuarios')
        .select('id, escuela_id, sucursal_id, nombres, apellidos')
        .eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      const esAnticipo = naturalezaSaldo === 'anticipo';

      // 1. Crear registro en cuentas_pagar (sin cuenta_contable_id)
      const { data: nuevaCxp, error: errCxp } = await supabase.from('cuentas_pagar').insert({
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        tipo_gasto: tipoBeneficiario,
        proveedor_id: tipoBeneficiario === 'proveedor' ? beneficiarioId : null,
        personal_id: tipoBeneficiario === 'personal' ? beneficiarioId : null,
        cuenta_contable_id: null,
        descripcion: descripcion.trim() || (esAnticipo ? 'Saldo inicial de anticipo' : 'Saldo inicial de deuda'),
        observaciones: (esAnticipo ? 'SIA-' : 'SI-') + Date.now().toString().slice(-6),
        monto_total: valorMonto,
        fecha_emision: fecha,
        es_anticipo: esAnticipo,
        estado: 'pendiente', 
      }).select('id').single();

      if (errCxp || !nuevaCxp) throw new Error(`Error al crear CxP: ${errCxp?.message || 'desconocido'}`);

      // Crear detalle (informativo)
      await supabase.from('cxp_detalle').insert({
        escuela_id: ctx.escuela_id,
        cuenta_pagar_id: nuevaCxp.id,
        descripcion: descripcion.trim() || 'Saldo inicial',
        cantidad: 1,
        precio_unitario: valorMonto,
      });

      // 2. Si es anticipo de migración: insertar pago de CARGA (entrada del saldo a favor)
      // IMPORTANTE: es_aplicacion_anticipo = false significa "entrada/carga del anticipo"
      // Esto hace que la vista calcule: deuda_restante = entrada(10000) - aplicaciones(0) = 10000
      // Con true sería: deuda_restante = 0 - 10000 = -10000 (¡incorrecto!)
      if (esAnticipo) {
        const { error: errPago } = await supabase.from('pagos_aplicados').insert({
          escuela_id: ctx.escuela_id,
          cuenta_pagar_id: nuevaCxp.id,
          monto_aplicado: valorMonto,
          fecha: fecha + 'T12:00:00',
          caja_id: null,
          es_aplicacion_anticipo: false,  // false = CARGA del saldo, no consumo
          conciliado: true                // conciliado = no editable (es migración)
        });
        if (errPago) throw errPago;
        
        // El estado queda 'pendiente' para que sea aplicable a notas futuras
        // (NO marcar como 'pagada', ya que aún tiene saldo disponible)
      }

      // 3. Auditoría
      await supabase.from('audit_log').insert({
        escuela_id: ctx.escuela_id, usuario_id: ctx.id,
        usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
        accion: 'saldo_inicial', modulo: 'cxp', entidad_id: nuevaCxp.id,
        detalle: { monto: valorMonto, descripcion: descripcion.trim(), es_anticipo: esAnticipo },
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
                Registra una deuda inicial a un proveedor o personal (ajuste de sistema)
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
                <><strong style={{ color: '#A855F7' }}>Aviso:</strong> Este registro generará una cuenta por pagar pendiente a favor del beneficiario.</>
              ) : (
                <><strong style={{ color: '#00D26A' }}>Aviso:</strong> Este registro se cargará como un saldo a nuestro favor (anticipo) para futuras aplicaciones.</>
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
