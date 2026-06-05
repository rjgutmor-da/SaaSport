import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, Landmark, User, Building2, Save, RefreshCw, AlertCircle, Wallet } from 'lucide-react';
import type { Sucursal, CajaBanco } from '../../types/finanzas';

interface Props {
  visible: boolean;
  onCerrar: () => void;
  onCreado: () => void;
  cajaAEditar?: CajaBanco | null;
}

const ModalNuevaCaja: React.FC<Props> = ({ visible, onCerrar, onCreado, cajaAEditar }) => {
  const [nombre, setNombre] = useState('');
  const [responsable, setResponsable] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [tipo, setTipo] = useState<'caja_chica' | 'cuenta_bancaria'>('caja_chica');
  const [activo, setActivo] = useState(true);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  
  const [guardando, setGuardando] = useState(false);
  const [cargandoSucursales, setCargandoSucursales] = useState(false);
  const [tieneMovimientos, setTieneMovimientos] = useState(false);
  const [verificandoMovimientos, setVerificandoMovimientos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setError(null);
      setTieneMovimientos(false);
      
      if (cajaAEditar) {
        setNombre(cajaAEditar.nombre || '');
        setResponsable(cajaAEditar.responsable || '');
        setSucursalId(cajaAEditar.sucursal_id || '');
        setTipo(cajaAEditar.tipo || 'caja_chica');
        setActivo(cajaAEditar.activo !== false);
        verificarMovimientosCaja(cajaAEditar.id);
      } else {
        setNombre('');
        setResponsable('');
        setSucursalId('');
        setTipo('caja_chica');
        setActivo(true);
      }
      cargarSucursales();
    }
  }, [visible, cajaAEditar]);

  const verificarMovimientosCaja = async (cajaId: string) => {
    try {
      setVerificandoMovimientos(true);
      
      const { count: countCobros, error: errCobros } = await supabase
        .from('cobros_aplicados')
        .select('id', { count: 'exact', head: true })
        .eq('caja_id', cajaId);
        
      if (errCobros) throw errCobros;

      const { count: countPagos, error: errPagos } = await supabase
        .from('pagos_aplicados')
        .select('id', { count: 'exact', head: true })
        .eq('caja_id', cajaId);

      if (errPagos) throw errPagos;

      setTieneMovimientos(((countCobros || 0) + (countPagos || 0)) > 0);
    } catch (err) {
      console.error('Error al verificar movimientos de la caja:', err);
    } finally {
      setVerificandoMovimientos(false);
    }
  };

  const cargarSucursales = async () => {
    try {
      setCargandoSucursales(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: perfil } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!perfil?.escuela_id) return;

      const { data, error: err } = await supabase
        .from('sucursales')
        .select('*')
        .eq('escuela_id', perfil.escuela_id)
        .order('nombre');

      if (err) throw err;
      setSucursales(data || []);
    } catch (err: any) {
      console.error('Error al cargar sucursales:', err);
    } finally {
      setCargandoSucursales(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return setError('El nombre es obligatorio.');
    if (!tipo) return setError('El tipo es obligatorio.');

    setGuardando(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');

      const { data: perfil } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!perfil?.escuela_id) throw new Error('No se pudo determinar la escuela.');

      if (cajaAEditar) {
        // En modo edición
        const { error: err } = await supabase
          .from('cajas_bancos')
          .update({
            nombre: nombre.trim(),
            responsable: responsable.trim() || null,
            ...(tieneMovimientos ? {} : {
              sucursal_id: sucursalId || null,
              tipo: tipo
            }),
            activo: activo
          })
          .eq('id', cajaAEditar.id);

        if (err) throw err;
      } else {
        // En modo creación
        const { error: err } = await supabase.from('cajas_bancos').insert({
          escuela_id: perfil.escuela_id,
          nombre: nombre.trim(),
          responsable: responsable.trim() || null,
          sucursal_id: sucursalId || null,
          tipo: tipo,
          saldo_actual: 0,
          activo: true
        });

        if (err) throw err;
      }

      onCreado();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div className="cxc-modal cxc-modal--entidad" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: 'rgba(0, 210, 106, 0.15)',
              color: '#00D26A'
            }}>
              {tipo === 'caja_chica' ? <Wallet size={20} /> : <Landmark size={20} />}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{cajaAEditar ? 'Editar Caja o Banco' : 'Nueva Caja o Banco'}</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {cajaAEditar ? 'Modifica los datos de la cuenta seleccionada' : 'Registra una nueva cuenta para gestionar movimientos'}
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        {cajaAEditar && tieneMovimientos && (
          <div style={{
            margin: '0 1.5rem 1rem 1.5rem',
            padding: '0.75rem 1rem',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: '#f59e0b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            lineHeight: '1.4'
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>
              Esta cuenta ya registra movimientos. Los campos <strong>Sucursal</strong> y <strong>Tipo de Cuenta</strong> están bloqueados para mantener la integridad histórica.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ gap: '1.25rem' }}>
            <div className="form-campo full-width">
              <label><AlignLeft size={14} /> Nombre de la Caja o Banco *</label>
              <input 
                type="text" 
                value={nombre} 
                onChange={e => setNombre(e.target.value)} 
                placeholder="Ej: Caja Chica Central, Cuenta BNB..."
                required 
                disabled={guardando} 
              />
            </div>

            <div className="form-campo full-width">
              <label><User size={14} /> Responsable</label>
              <input 
                type="text" 
                value={responsable} 
                onChange={e => setResponsable(e.target.value)} 
                placeholder="Nombre de la persona encargada"
                disabled={guardando} 
              />
            </div>

            <div className="form-campo">
              <label><Building2 size={14} /> Sucursal</label>
              <select 
                value={sucursalId} 
                onChange={e => setSucursalId(e.target.value)} 
                disabled={guardando || cargandoSucursales || (!!cajaAEditar && tieneMovimientos) || verificandoMovimientos}
              >
                <option value="">Todas las sucursales (Global)</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>

            <div className="form-campo">
              <label><Wallet size={14} /> Tipo de Cuenta *</label>
              <select 
                value={tipo} 
                onChange={e => setTipo(e.target.value as any)} 
                required 
                disabled={guardando || (!!cajaAEditar && tieneMovimientos) || verificandoMovimientos}
              >
                <option value="caja_chica">Caja Chica (Efectivo)</option>
                <option value="cuenta_bancaria">Cuenta Bancaria / Banco</option>
              </select>
            </div>

            {cajaAEditar && (
              <div className="form-campo full-width" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <input 
                  type="checkbox" 
                  id="chk-caja-activa"
                  checked={activo} 
                  onChange={e => setActivo(e.target.checked)} 
                  disabled={guardando} 
                  style={{ width: '18px', height: '18px', cursor: 'pointer', margin: 0 }}
                />
                <label htmlFor="chk-caja-activa" style={{ cursor: 'pointer', margin: 0, userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Cuenta Activa (Disponible para registrar cobros y pagos)
                </label>
              </div>
            )}
          </div>

          {error && (
            <div className="form-msg form-msg--error" style={{ margin: '1rem 0' }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          <div className="cxc-modal-footer" style={{ 
            marginTop: '1.5rem', 
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border-light)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '1rem'
          }}>
            <button type="button" className="cxc-limpiar-busqueda" onClick={onCerrar} disabled={guardando} style={{ padding: '0.6rem 1.5rem' }}>
              Cancelar
            </button>
            <button 
              type="submit" 
              className="btn-guardar-cuenta" 
              disabled={guardando || verificandoMovimientos}
              style={{ padding: '0.6rem 2rem', background: '#00D26A', borderColor: '#00D26A', color: 'white', fontWeight: 600 }}
            >
              {guardando ? (
                <> <RefreshCw size={16} className="spin" /> Guardando... </>
              ) : (
                <> <Save size={16} /> Guardar Caja/Banco </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalNuevaCaja;

const AlignLeft = ({ size, className }: { size?: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <line x1="21" y1="6" x2="3" y2="6"></line>
    <line x1="15" y1="12" x2="3" y2="12"></line>
    <line x1="17" y1="18" x2="3" y2="18"></line>
  </svg>
);
