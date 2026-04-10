/**
 * ModalEntidadCxP.tsx
 * Modal premium para el registro y edición de Proveedores y Personal (Trabajadores).
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { 
  X, Save, AlertCircle, Check, Truck, Users, 
  MapPin, Phone, User as UserIcon, Briefcase, 
  CreditCard, Hash, Info
} from 'lucide-react';

interface Props {
  visible: boolean;
  tipo: 'proveedor' | 'personal';
  itemAEditar: any | null; // Puede ser Proveedor o Personal
  escuelaId: string | null;
  onCerrar: () => void;
  onGuardado: () => void;
}

const CATEGORIAS_PROVEEDOR = [
  { value: 'uniforme',          label: 'Proveedor de Uniformes' },
  { value: 'trabajador',        label: 'Trabajadores' },
  { value: 'servicios_basicos', label: 'Servicios Básicos' },
  { value: 'alquiler',          label: 'Alquileres' },
  { value: 'otro',              label: 'Otros' },
];

const ModalEntidadCxP: React.FC<Props> = ({ 
  visible, tipo, itemAEditar, escuelaId, onCerrar, onGuardado 
}) => {
  const [formProv, setFormProv] = useState<any>({
    nombre: '', categoria: 'otro', nit_ci: '', telefono: '', direccion: '', contacto: '', activo: true
  });
  const [formPers, setFormPers] = useState<any>({
    nombres: '', apellidos: '', cargo: '', telefono: '', direccion: '', contacto_emergencia: '', salario_base: '', activo: true
  });

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<boolean>(false);

  useEffect(() => {
    if (visible) {
      setError(null);
      setExito(false);
      if (itemAEditar) {
        if (tipo === 'proveedor') setFormProv({ ...itemAEditar });
        else setFormPers({ ...itemAEditar });
      } else {
        // Reset
        setFormProv({ nombre: '', categoria: 'otro', nit_ci: '', telefono: '', direccion: '', contacto: '', activo: true });
        setFormPers({ nombres: '', apellidos: '', cargo: '', telefono: '', direccion: '', contacto_emergencia: '', salario_base: '', activo: true });
      }
    }
  }, [visible, itemAEditar, tipo]);

  if (!visible) return null;

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId) return;
    setGuardando(true);
    setError(null);

    try {
      if (tipo === 'proveedor') {
        if (!formProv.nombre?.trim()) throw new Error('El nombre es obligatorio.');
        const payload = { ...formProv, escuela_id: escuelaId };
        const { error: err } = itemAEditar 
          ? await supabase.from('proveedores').update(payload).eq('id', itemAEditar.id)
          : await supabase.from('proveedores').insert(payload);
        if (err) throw err;
      } else {
        if (!formPers.nombres?.trim() || !formPers.apellidos?.trim()) throw new Error('Nombres y apellidos son obligatorios.');
        const payload = { ...formPers, escuela_id: escuelaId };
        const { error: err } = itemAEditar
          ? await supabase.from('personal').update(payload).eq('id', itemAEditar.id)
          : await supabase.from('personal').insert(payload);
        if (err) throw err;
      }

      setExito(true);
      setTimeout(() => {
        onGuardado();
        onCerrar();
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div className="cxc-modal cxc-modal--entidad" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: tipo === 'proveedor' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: tipo === 'proveedor' ? '#3b82f6' : '#10b981'
            }}>
              {tipo === 'proveedor' ? <Truck size={20} /> : <Users size={20} />}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                {itemAEditar ? 'Editar' : 'Nuevo'} {tipo === 'proveedor' ? 'Proveedor' : 'Trabajador'}
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Completa la información detallada de la entidad
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal"><X size={20} /></button>
        </div>

        <form onSubmit={handleGuardar} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '1.25rem',
            padding: '0.5rem 0'
          }}>
            {tipo === 'proveedor' ? (
              <>
                <div className="form-campo full-width" style={{ gridColumn: '1 / -1' }}>
                  <label><UserIcon size={14} /> Nombre del Proveedor *</label>
                  <input 
                    type="text" 
                    value={formProv.nombre} 
                    onChange={e => setFormProv({...formProv, nombre: e.target.value})}
                    placeholder="Ej: Insumos Deportivos S.R.L."
                    required
                  />
                </div>
                <div className="form-campo">
                  <label><Briefcase size={14} /> Categoría</label>
                  <select 
                    value={formProv.categoria} 
                    onChange={e => setFormProv({...formProv, categoria: e.target.value})}
                  >
                    {CATEGORIAS_PROVEEDOR.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-campo">
                  <label><Hash size={14} /> NIT / CI</label>
                  <input 
                    type="text" 
                    value={formProv.nit_ci || ''} 
                    onChange={e => setFormProv({...formProv, nit_ci: e.target.value})}
                    placeholder="Identificación tributaria"
                  />
                </div>
                <div className="form-campo">
                  <label><Phone size={14} /> Teléfono</label>
                  <input 
                    type="text" 
                    value={formProv.telefono || ''} 
                    onChange={e => setFormProv({...formProv, telefono: e.target.value})}
                    placeholder="Número de contacto"
                  />
                </div>
                <div className="form-campo">
                  <label><UserIcon size={14} /> Persona de Contacto</label>
                  <input 
                    type="text" 
                    value={formProv.contacto || ''} 
                    onChange={e => setFormProv({...formProv, contacto: e.target.value})}
                    placeholder="Nombre del encargado"
                  />
                </div>
                <div className="form-campo full-width" style={{ gridColumn: '1 / -1' }}>
                  <label><MapPin size={14} /> Dirección</label>
                  <input 
                    type="text" 
                    value={formProv.direccion || ''} 
                    onChange={e => setFormProv({...formProv, direccion: e.target.value})}
                    placeholder="Ubicación física"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="form-campo">
                  <label><UserIcon size={14} /> Nombres *</label>
                  <input 
                    type="text" 
                    value={formPers.nombres} 
                    onChange={e => setFormPers({...formPers, nombres: e.target.value})}
                    placeholder="Nombres del trabajador"
                    required
                  />
                </div>
                <div className="form-campo">
                  <label><UserIcon size={14} /> Apellidos *</label>
                  <input 
                    type="text" 
                    value={formPers.apellidos} 
                    onChange={e => setFormPers({...formPers, apellidos: e.target.value})}
                    placeholder="Apellidos del trabajador"
                    required
                  />
                </div>
                <div className="form-campo">
                  <label><Briefcase size={14} /> Cargo / Función</label>
                  <input 
                    type="text" 
                    value={formPers.cargo || ''} 
                    onChange={e => setFormPers({...formPers, cargo: e.target.value})}
                    placeholder="Ej: Entrenador Sub-15"
                  />
                </div>
                <div className="form-campo">
                  <label><Phone size={14} /> Teléfono</label>
                  <input 
                    type="text" 
                    value={formPers.telefono || ''} 
                    onChange={e => setFormPers({...formPers, telefono: e.target.value})}
                    placeholder="Celular personal"
                  />
                </div>
                <div className="form-campo">
                   <label><CreditCard size={14} /> Salario Base (Bs)</label>
                   <input 
                     type="number" step="0.01"
                     value={formPers.salario_base || ''} 
                     onChange={e => setFormPers({...formPers, salario_base: e.target.value})}
                     placeholder="Monto mensual"
                   />
                </div>
                <div className="form-campo">
                  <label><Info size={14} /> Contacto Emergencia</label>
                  <input 
                    type="text" 
                    value={formPers.contacto_emergencia || ''} 
                    onChange={e => setFormPers({...formPers, contacto_emergencia: e.target.value})}
                    placeholder="Nombre y teléfono de referencia"
                  />
                </div>
                <div className="form-campo full-width" style={{ gridColumn: '1 / -1' }}>
                  <label><MapPin size={14} /> Dirección Domiciliaria</label>
                  <input 
                    type="text" 
                    value={formPers.direccion || ''} 
                    onChange={e => setFormPers({...formPers, direccion: e.target.value})}
                    placeholder="Dirección completa"
                  />
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="form-msg form-msg--error" style={{ margin: '1rem 0' }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {exito && (
            <div className="form-msg form-msg--exito" style={{ margin: '1rem 0' }}>
              <Check size={18} /> ¡Registro guardado con éxito!
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
            <button 
              type="button" 
              className="btn-refrescar" 
              onClick={onCerrar}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              className="btn-guardar-cuenta" 
              disabled={guardando || exito}
              style={{ padding: '0.6rem 2rem' }}
            >
              {guardando ? (
                <> <RefreshCw size={16} className="spin" /> Guardando... </>
              ) : (
                <> <Save size={16} /> Guardar Registro </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalEntidadCxP;
