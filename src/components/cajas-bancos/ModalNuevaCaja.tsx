import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, Landmark, User, Building2, Save, RefreshCw, AlertCircle, Wallet } from 'lucide-react';
import type { Sucursal } from '../../types/finanzas';

interface Props {
  visible: boolean;
  onCerrar: () => void;
  onCreado: () => void;
}

const ModalNuevaCaja: React.FC<Props> = ({ visible, onCerrar, onCreado }) => {
  const [nombre, setNombre] = useState('');
  const [responsable, setResponsable] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [tipo, setTipo] = useState<'caja_chica' | 'cuenta_bancaria'>('caja_chica');
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  
  const [guardando, setGuardando] = useState(false);
  const [cargandoSucursales, setCargandoSucursales] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setNombre('');
      setResponsable('');
      setSucursalId('');
      setTipo('caja_chica');
      setError(null);
      cargarSucursales();
    }
  }, [visible]);

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
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Nueva Caja o Banco</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Registra una nueva cuenta para gestionar movimientos
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

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
                disabled={guardando || cargandoSucursales}
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
                disabled={guardando}
              >
                <option value="caja_chica">Caja Chica (Efectivo)</option>
                <option value="cuenta_bancaria">Cuenta Bancaria / Banco</option>
              </select>
            </div>
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
              disabled={guardando}
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
