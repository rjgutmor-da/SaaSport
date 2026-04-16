/**
 * ModalSaldoInicialCxC.tsx
 * Modal para registrar saldos iniciales de deuda de clientes (alumnos).
 * Genera un registro en cuentas_cobrar y un asiento contable:
 *   DEBE: 1.1.3 (CxC Alumnos)
 *   HABER: 3.2.1 (Capital Social Ajustes)
 */
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, DollarSign, Users, AlignLeft, AlertCircle, Check, RefreshCw, BookOpen } from 'lucide-react';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  visible: boolean;
  onCerrar: () => void;
  onCreado: () => void;
}

const ModalSaldoInicialCxC: React.FC<Props> = ({ visible, onCerrar, onCreado }) => {
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [alumnoId, setAlumnoId] = useState('');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('Saldo inicial de deuda');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAlumnoId(''); setMonto(''); setDescripcion('Saldo inicial de deuda');
    setError(null); setExito(null);

    const cargar = async () => {
      const { data } = await supabase.from('alumnos')
        .select('id, nombres, apellidos')
        .eq('archivado', false)
        .order('nombres');
      setAlumnos(data ?? []);
    };
    cargar();
  }, [visible]);

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!alumnoId) { setError('Seleccione un alumno.'); return; }
    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) { setError('Ingrese un monto válido mayor a 0.'); return; }

    setGuardando(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');
      const { data: ctx } = await supabase.from('usuarios')
        .select('id, escuela_id, sucursal_id, nombres, apellidos')
        .eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      // Buscar cuentas necesarias
      const { data: ctaCxc } = await supabase.from('plan_cuentas').select('id').eq('codigo', '1.1.3').single();
      const { data: ctaCapital } = await supabase.from('plan_cuentas').select('id').eq('codigo', '3.2.1').single();
      
      if (!ctaCxc) throw new Error('No se encontró la cuenta 1.1.3 (Cuentas por Cobrar).');
      if (!ctaCapital) throw new Error('No se encontró la cuenta 3.2.1 (Capital Social Ajustes).');

      // 1. Crear registro en cuentas_cobrar
      const { data: nuevaCxc, error: errCxc } = await supabase.from('cuentas_cobrar').insert({
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        alumno_id: alumnoId,
        cuenta_contable_id: ctaCxc.id,
        monto_total: valorMonto,
        descripcion: descripcion.trim() || 'Saldo inicial de deuda',
        observaciones: 'Saldo inicial - ajuste contable',
        estado: 'pendiente',
      }).select('id').single();

      if (errCxc || !nuevaCxc) throw new Error(`Error al crear CxC: ${errCxc?.message || 'desconocido'}`);

      // 2. Crear asiento contable: DEBE CxC, HABER Capital
      const { error: rpcErr } = await supabase.rpc('rpc_procesar_transaccion_financiera', {
        p_payload: {
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          usuario_id: ctx.id,
          descripcion: `Saldo Inicial CxC: ${descripcion.trim()}`,
          metodo_pago: 'efectivo',
          nro_transaccion: null,
          movimientos: [
            { cuenta_contable_id: ctaCxc.id, debe: valorMonto, haber: 0 },
            { cuenta_contable_id: ctaCapital.id, debe: 0, haber: valorMonto },
          ],
        }
      });

      if (rpcErr) throw new Error(`Error en asiento contable: ${rpcErr.message}`);

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
    <div className="cxc-modal-overlay" onClick={onCerrar}>
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
                Registra una deuda inicial de un alumno (ajuste contable)
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ padding: '0.5rem 0' }}>
            <div className="form-campo full-width">
              <label><Users size={14} /> Alumno / Cliente *</label>
              <select value={alumnoId} onChange={e => setAlumnoId(e.target.value)} required disabled={guardando}>
                <option value="">— Seleccionar alumno —</option>
                {alumnos.map(a => <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>)}
              </select>
            </div>

            <div className="form-campo full-width">
              <label><DollarSign size={14} /> Monto de la Deuda Inicial (Bs) *</label>
              <input
                type="number" step="0.01" min="0.01"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                required disabled={guardando}
                placeholder="0.00"
                style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--warning)' }}
              />
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
              <strong style={{ color: '#f59e0b' }}>Asiento automático:</strong> DEBE → 1.1.3 (CxC) | HABER → 3.2.1 (Capital Social Ajustes)
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
                <> <RefreshCw size={16} className="spin" /> Registrando... </>
              ) : (
                <> <Check size={16} /> Registrar Saldo Inicial </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalSaldoInicialCxC;
