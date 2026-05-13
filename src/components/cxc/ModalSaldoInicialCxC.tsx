/**
 * ModalSaldoInicialCxC.tsx
 * Modal para registrar saldos iniciales de deuda de clientes (alumnos).
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

const ModalSaldoInicialCxC: React.FC<Props> = ({ visible, onCerrar, onCreado, edicionItem }) => {
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [naturalezaSaldo, setNaturalezaSaldo] = useState<'deuda' | 'anticipo'>('deuda');
  const [alumnoId, setAlumnoId] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(getHoyISO());
  const [descripcion, setDescripcion] = useState('Saldo inicial de deuda');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    if (edicionItem) {
      setAlumnoId(edicionItem.alumno_id || '');
      setMonto(String(edicionItem.monto_total || ''));
      setFecha(edicionItem.fecha_emision || getHoyISO());
      setDescripcion(edicionItem.descripcion || '');
      setNaturalezaSaldo((edicionItem.observaciones || '').includes('SIA-') ? 'anticipo' : 'deuda');
      setError(null); setExito(null);
    } else {
      setAlumnoId(''); setMonto(''); setFecha(getHoyISO()); setDescripcion('Saldo inicial de deuda');
      setError(null); setExito(null);
    }

    const cargar = async () => {
      const { data } = await supabase.from('alumnos')
        .select('id, nombres, apellidos')
        .eq('archivado', false)
        .order('nombres');
      setAlumnos(data ?? []);
    };
    cargar();
  }, [visible, edicionItem]);

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!alumnoId) { setError('Seleccione un alumno.'); return; }
    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) { setError('Ingrese un monto válido mayor a 0.'); return; }

    setGuardando(true);

    try {
      // Caso Edición (Simplificado: solo actualiza el monto/descripcion de la CxC)
      if (edicionItem) {
        const { error: editErr } = await supabase
          .from('cuentas_cobrar')
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

      // 1. Crear registro en cuentas_cobrar (sin cuenta_contable_id)
      const { data: nuevaCxc, error: errCxc } = await supabase.from('cuentas_cobrar').insert({
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        alumno_id: alumnoId,
        monto_total: valorMonto,
        fecha_emision: fecha,
        descripcion: descripcion.trim() || (esAnticipo ? 'Saldo inicial de anticipo' : 'Saldo inicial de deuda'),
        observaciones: (esAnticipo ? 'SIA-' : 'Saldo inicial - ajuste administrativo'),
        es_anticipo: esAnticipo,
        estado: 'pendiente',
      }).select('id').single();

      if (errCxc || !nuevaCxc) throw new Error(`Error al crear CxC: ${errCxc?.message || 'desconocido'}`);

      // 2. Si es anticipo de migración: insertar cobro de CARGA (entrada del saldo a favor)
      // IMPORTANTE: es_aplicacion_anticipo = false significa "entrada/carga del anticipo"
      // La vista calcula: saldo_pendiente = entrada(false) - consumos(true) = monto - 0 = monto disponible
      // Con true la vista calculaba: saldo_pendiente = 0 - monto = -monto (nunca aparecía disponible)
      if (esAnticipo) {
        const { error: errCobro } = await supabase.from('cobros_aplicados').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: nuevaCxc.id,
          monto_aplicado: valorMonto,
          fecha: fecha + 'T12:00:00', // Hora ficticia para el día de migración
          caja_id: null,              // No afecta cajas reales (es una carga de saldo)
          es_aplicacion_anticipo: false, // false = CARGA/ENTRADA del anticipo (ya nos pagaron)
          conciliado: true
        });
        if (errCobro) throw errCobro;
        // Estado permanece 'pendiente' para que sea aplicable a notas futuras
      }

      // 3. Auditoría
      const alumObj = alumnos.find(a => a.id === alumnoId);
      await supabase.from('audit_log').insert({
        escuela_id: ctx.escuela_id, usuario_id: ctx.id,
        usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
        accion: 'saldo_inicial', modulo: 'cxc', entidad_id: nuevaCxc.id,
        detalle: {
          alumno: alumObj ? `${alumObj.nombres} ${alumObj.apellidos}` : alumnoId,
          monto: valorMonto,
          descripcion: descripcion.trim(),
          es_anticipo: esAnticipo
        },
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
      <div className="cxc-modal cxc-modal--entidad" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#f59e0b'
            }}>
              <BookOpen size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Saldo Inicial — CxC</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Registra una deuda inicial de un alumno (ajuste de sistema)
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
                    borderColor: naturalezaSaldo === 'deuda' ? 'var(--warning)' : 'var(--border)',
                    background: naturalezaSaldo === 'deuda' ? 'var(--warning)' : 'transparent',
                    color: naturalezaSaldo === 'deuda' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 600, cursor: 'pointer'
                  }}
                >Deuda (El alumno nos debe)</button>
                <button type="button" onClick={() => setNaturalezaSaldo('anticipo')}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid',
                    borderColor: naturalezaSaldo === 'anticipo' ? 'var(--success)' : 'var(--border)',
                    background: naturalezaSaldo === 'anticipo' ? 'var(--success)' : 'transparent',
                    color: naturalezaSaldo === 'anticipo' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 600, cursor: 'pointer'
                  }}
                >Anticipo (Nos pagó adelantado)</button>
              </div>
            </div>

            <div className="form-campo full-width">
              <label><Users size={14} /> Alumno / Cliente *</label>
              <select value={alumnoId} onChange={e => setAlumnoId(e.target.value)} required disabled={guardando}>
                <option value="">— Seleccionar alumno —</option>
                {alumnos.map(a => <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>)}
              </select>
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
                  style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--warning)' }}
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
                placeholder="Ej: Saldo inicial de deuda acumulada"
              />
            </div>
          </div>

          <div style={{ background: 'rgba(245, 158, 11, 0.08)', borderRadius: '8px', padding: '0.75rem 1rem', margin: '1rem 0', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {naturalezaSaldo === 'deuda' ? (
                <><strong style={{ color: '#f59e0b' }}>Aviso:</strong> Este registro generará una cuenta por cobrar pendiente en el estado de cuenta del alumno.</>
              ) : (
                <><strong style={{ color: '#00D26A' }}>Aviso:</strong> Este registro se cargará como un saldo a favor (anticipo) para futuras aplicaciones.</>
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
              style={{ padding: '0.6rem 2rem', background: '#f59e0b', borderColor: '#f59e0b' }}>
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

export default ModalSaldoInicialCxC;
