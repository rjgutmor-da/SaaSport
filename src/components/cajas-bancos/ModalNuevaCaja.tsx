import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, Landmark, User, Building2, Save, RefreshCw, AlertCircle, Wallet, AlignLeft, Hash } from 'lucide-react';
import type { Sucursal, CajaBanco } from '../../types/finanzas';
import './ModalNuevaCaja.css';

interface Props {
  visible: boolean;
  onCerrar: () => void;
  onCreado: () => void;
  cajaAEditar?: CajaBanco | null;
}

const ModalNuevaCaja: React.FC<Props> = ({ visible, onCerrar, onCreado, cajaAEditar }) => {
  const [nombre, setNombre] = useState('');
  const [responsable, setResponsable] = useState('');
  const [numeroCuenta, setNumeroCuenta] = useState('');
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
        setNumeroCuenta(cajaAEditar.numero_cuenta || '');
        setSucursalId(cajaAEditar.sucursal_id || '');
        setTipo(cajaAEditar.tipo || 'caja_chica');
        setActivo(cajaAEditar.activo !== false);
        verificarMovimientosCaja(cajaAEditar.id);
      } else {
        setNombre('');
        setResponsable('');
        setNumeroCuenta('');
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
    } catch (err) {
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
            numero_cuenta: numeroCuenta.trim() || null,
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
          numero_cuenta: numeroCuenta.trim() || null,
          sucursal_id: sucursalId || null,
          tipo: tipo,
          saldo_actual: 0,
          activo: true
        });

        if (err) throw err;
      }

      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : (
        typeof err === 'object' && err !== null && 'message' in err
          ? String(err.message)
          : 'No se pudo guardar la cuenta.'
      ));
    } finally {
      setGuardando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay" onClick={() => !guardando && onCerrar()}>
      <div
        className="cxc-modal caja-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="caja-modal-titulo"
        onClick={e => e.stopPropagation()}
      >
        <div className="cxc-modal-header caja-modal__header">
          <div className="caja-modal__heading">
            <div className="caja-modal__icon" aria-hidden="true">
              {tipo === 'caja_chica' ? <Wallet size={24} /> : <Landmark size={24} />}
            </div>
            <div>
              <h2 id="caja-modal-titulo">{cajaAEditar ? 'Editar caja o banco' : 'Nueva caja o banco'}</h2>
              <p>{cajaAEditar ? 'Actualiza la información de tu cuenta.' : 'Organiza tus cobros y pagos desde una sola cuenta.'}</p>
            </div>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar formulario" disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="cxc-modal-form caja-modal__form" aria-busy={guardando}>
          <div className="caja-modal__body">
            {cajaAEditar && tieneMovimientos && (
              <div className="caja-modal__notice" role="status">
                <AlertCircle size={18} aria-hidden="true" />
                <span>
                  Esta cuenta ya registra movimientos. La sucursal y el tipo de cuenta no se pueden modificar.
                </span>
              </div>
            )}

            <div className="caja-modal__section-heading">
              <h3>Datos de la cuenta</h3>
              <span>* Campos obligatorios</span>
            </div>

            <div className="caja-modal__grid">
              <div className="caja-modal__field caja-modal__field--full">
                <label htmlFor="caja-nombre"><AlignLeft size={15} aria-hidden="true" /> Nombre de la caja o banco <span>*</span></label>
                <input
                  id="caja-nombre"
                  type="text"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej.: Caja central o Banco BNB"
                  maxLength={100}
                  required
                  autoFocus
                  disabled={guardando}
                />
              </div>

              <div className="caja-modal__field">
                <label htmlFor="caja-tipo"><Wallet size={15} aria-hidden="true" /> Tipo de cuenta <span>*</span></label>
                <select
                  id="caja-tipo"
                  value={tipo}
                  onChange={e => setTipo(e.target.value as CajaBanco['tipo'])}
                  required
                  disabled={guardando || (!!cajaAEditar && tieneMovimientos) || verificandoMovimientos}
                >
                  <option value="caja_chica">Caja chica (efectivo)</option>
                  <option value="cuenta_bancaria">Cuenta bancaria / Banco</option>
                </select>
              </div>

              <div className="caja-modal__field">
                <label htmlFor="caja-sucursal"><Building2 size={15} aria-hidden="true" /> Sucursal</label>
                <select
                  id="caja-sucursal"
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

              <div className="caja-modal__field caja-modal__field--full caja-modal__account">
                <label htmlFor="caja-numero-cuenta">
                  <Hash size={15} aria-hidden="true" /> Número de cuenta
                  <span className="caja-modal__optional">Opcional</span>
                </label>
                <input
                  id="caja-numero-cuenta"
                  type="text"
                  value={numeroCuenta}
                  onChange={e => setNumeroCuenta(e.target.value)}
                  placeholder="Ej.: 001-23456789"
                  aria-describedby="caja-numero-ayuda"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={guardando}
                />
                <small id="caja-numero-ayuda">Puedes dejarlo vacío si no corresponde.</small>
              </div>

              <div className="caja-modal__field caja-modal__field--full">
                <label htmlFor="caja-responsable"><User size={15} aria-hidden="true" /> Responsable</label>
                <input
                  id="caja-responsable"
                  type="text"
                  value={responsable}
                  onChange={e => setResponsable(e.target.value)}
                  placeholder="Nombre de la persona encargada"
                  disabled={guardando}
                />
              </div>

              {cajaAEditar && (
                <div className="caja-modal__active caja-modal__field--full">
                  <input
                    type="checkbox"
                    id="chk-caja-activa"
                    checked={activo}
                    onChange={e => setActivo(e.target.checked)}
                    disabled={guardando}
                  />
                  <label htmlFor="chk-caja-activa">
                    <strong>Cuenta activa</strong>
                    <span>Disponible para registrar cobros y pagos.</span>
                  </label>
                </div>
              )}
            </div>

            {error && (
              <div className="form-msg form-msg--error caja-modal__error" role="alert">
                <AlertCircle size={18} aria-hidden="true" /> {error}
              </div>
            )}
          </div>

          <div className="caja-modal__footer">
            <button type="button" className="caja-modal__cancel" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </button>
            <button type="submit" className="caja-modal__save" disabled={guardando || verificandoMovimientos}>
              {guardando ? (
                <><RefreshCw size={17} className="spin" aria-hidden="true" /> Guardando...</>
              ) : (
                <><Save size={17} aria-hidden="true" /> {cajaAEditar ? 'Guardar cambios' : 'Guardar caja o banco'}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalNuevaCaja;
