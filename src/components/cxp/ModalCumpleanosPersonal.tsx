/**
 * ModalCumpleanosPersonal.tsx
 * Modal de alertas de cumpleaños del personal (empleados) en Cuentas por Pagar.
 * Muestra exclusivamente las secciones: Hoy, Ayer y Mañana, con acceso directo a WhatsApp.
 */
import React from 'react';
import {
  X, Cake, Gift, Clock, Calendar, Briefcase,
  Phone, MessageCircle, UserCog
} from 'lucide-react';
import {
  construirUrlWhatsAppCumpleanos,
  formatearDiaMesLargo,
  obtenerInicialesNombre,
  type EmpleadoCumpleanos,
} from './cumpleanosPersonalUtils';

interface Props {
  visible: boolean;
  onCerrar: () => void;
  hoy: EmpleadoCumpleanos[];
  ayer: EmpleadoCumpleanos[];
  manana: EmpleadoCumpleanos[];
  totalPersonalConFecha: number;
  onIrAAdministrarPersonal?: () => void;
  onSeleccionarEmpleado?: (id: string) => void;
}

interface TarjetaProps {
  empleado: EmpleadoCumpleanos;
  variante: 'hoy' | 'ayer' | 'manana';
  onSeleccionarEmpleado?: (id: string) => void;
}

const TarjetaCumpleanosEmpleado: React.FC<TarjetaProps> = ({
  empleado,
  variante,
  onSeleccionarEmpleado,
}) => {
  const urlWhatsApp = construirUrlWhatsAppCumpleanos(empleado.nombre, empleado.telefono);
  const fechaTexto = formatearDiaMesLargo(empleado.fecha_nacimiento);
  const iniciales = obtenerInicialesNombre(empleado.nombre);
  const esHoy = variante === 'hoy';
  const esAyer = variante === 'ayer';

  const abrirWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!urlWhatsApp) return;
    window.open(urlWhatsApp, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      onClick={() => onSeleccionarEmpleado?.(empleado.id)}
      role={onSeleccionarEmpleado ? 'button' : undefined}
      tabIndex={onSeleccionarEmpleado ? 0 : undefined}
      onKeyDown={(e) => {
        if (onSeleccionarEmpleado && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSeleccionarEmpleado(empleado.id);
        }
      }}
      title={onSeleccionarEmpleado ? 'Clic para ver ficha del empleado en Cuentas por Pagar' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.9rem',
        padding: '0.9rem 1rem',
        borderRadius: '10px',
        background: esHoy ? 'rgba(255, 107, 53, 0.10)' : 'var(--bg-card)',
        border: esHoy
          ? '1px solid rgba(255, 107, 53, 0.45)'
          : '1px solid var(--border)',
        boxShadow: esHoy ? '0 0 16px rgba(255, 107, 53, 0.14)' : 'var(--shadow-sm)',
        opacity: esAyer ? 0.85 : 1,
        cursor: onSeleccionarEmpleado ? 'pointer' : 'default',
        transition: 'var(--transition)',
      }}
    >
      {/* Avatar con iniciales e ícono festivo */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '10px',
            border: `1.5px solid ${esHoy ? 'var(--primary)' : 'var(--border)'}`,
            background: esHoy ? 'rgba(255, 107, 53, 0.15)' : 'var(--bg-glass)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.15rem',
            color: esHoy ? 'var(--primary)' : 'var(--text-primary)',
          }}
        >
          {iniciales}
        </div>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '-6px',
            right: '-6px',
            fontSize: '0.95rem',
            lineHeight: 1,
          }}
        >
          🎂
        </span>
      </div>

      {/* Información del empleado */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <h4
            style={{
              margin: 0,
              fontSize: '0.95rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {empleado.nombre}
          </h4>
          {esHoy && (
            <span
              style={{
                flexShrink: 0,
                padding: '0.15rem 0.5rem',
                borderRadius: '999px',
                background: 'rgba(255, 107, 53, 0.2)',
                border: '1px solid rgba(255, 107, 53, 0.4)',
                color: 'var(--primary)',
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              🎉 ¡Hoy!
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            fontSize: '0.76rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <Briefcase size={12} style={{ color: 'var(--primary)' }} />
            {empleado.cargo || 'Personal interno'}
          </span>
          {fechaTexto && (
            <span>• {fechaTexto}</span>
          )}
          {empleado.edadCumplida !== null && (
            <span style={{ color: esHoy ? 'var(--primary)' : 'var(--text-primary)', fontWeight: 700 }}>
              • {esAyer ? `Cumplió ${empleado.edadCumplida} años` : `Cumple ${empleado.edadCumplida} años`}
            </span>
          )}
        </div>

        {/* Teléfono y botón de WhatsApp */}
        <div
          style={{
            marginTop: '0.35rem',
            padding: '0.35rem 0.55rem',
            borderRadius: '6px',
            background: 'var(--bg-glass)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: empleado.telefono ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            <Phone size={12} style={{ color: empleado.telefono ? 'var(--primary)' : 'var(--text-tertiary)' }} />
            {empleado.telefono || 'Sin teléfono'}
          </span>

          {urlWhatsApp && (
            <button
              type="button"
              onClick={abrirWhatsApp}
              title={`Enviar felicitación por WhatsApp a ${empleado.nombre}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.3rem 0.65rem',
                borderRadius: '999px',
                border: 'none',
                background: '#10b981',
                color: '#ffffff',
                fontSize: '0.72rem',
                fontWeight: 800,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <MessageCircle size={13} fill="currentColor" />
              <span>Felicitar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ModalCumpleanosPersonal: React.FC<Props> = ({
  visible,
  onCerrar,
  hoy,
  ayer,
  manana,
  totalPersonalConFecha,
  onIrAAdministrarPersonal,
  onSeleccionarEmpleado,
}) => {
  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div
        className="cxc-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '820px' }}
      >
        {/* Encabezado */}
        <div className="cxc-modal-header" style={{ padding: '1.25rem 1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              className="cxc-header-icon-circle"
              style={{
                background: 'rgba(255, 107, 53, 0.15)',
                color: 'var(--primary)',
              }}
            >
              <Cake size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                Cumpleaños de Empleados
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Alertas de cumpleaños de ayer, hoy y mañana
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {onIrAAdministrarPersonal && (
              <button
                type="button"
                onClick={onIrAAdministrarPersonal}
                title="Registrar o editar fechas de nacimiento del personal"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-glass)',
                  color: 'var(--text-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <UserCog size={14} />
                <span>Configurar fechas</span>
              </button>
            )}
            <button type="button" onClick={onCerrar} aria-label="Cerrar ventana de cumpleaños">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Contenido */}
        <div style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {totalPersonalConFecha === 0 && (
            <div
              style={{
                padding: '1rem 1.15rem',
                borderRadius: '10px',
                background: 'rgba(255, 107, 53, 0.08)',
                border: '1px solid rgba(255, 107, 53, 0.28)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                <Cake size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <span>
                  Aún no hay empleados con fecha de nacimiento registrada. Agrégala en la ficha de cada miembro del personal para activar las alertas.
                </span>
              </div>
              {onIrAAdministrarPersonal && (
                <button
                  type="button"
                  onClick={onIrAAdministrarPersonal}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#ffffff',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Registrar fechas de nacimiento en Personal
                </button>
              )}
            </div>
          )}

          {/* SECCIÓN 1: HOY (Destacada) */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <span
                style={{
                  width: '6px',
                  height: '24px',
                  borderRadius: '999px',
                  background: 'var(--primary)',
                }}
              />
              <h3
                style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--text-primary)',
                }}
              >
                Hoy
              </h3>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  color: 'var(--primary)',
                  background: 'rgba(255, 107, 53, 0.12)',
                  border: '1px solid rgba(255, 107, 53, 0.3)',
                  padding: '0.1rem 0.55rem',
                  borderRadius: '999px',
                }}
              >
                {hoy.length}
              </span>
            </div>

            {hoy.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                {hoy.map((empleado) => (
                  <TarjetaCumpleanosEmpleado
                    key={empleado.id}
                    empleado={empleado}
                    variante="hoy"
                    onSeleccionarEmpleado={onSeleccionarEmpleado}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '1.35rem',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                }}
              >
                <Gift size={28} style={{ opacity: 0.45, marginBottom: '0.35rem' }} />
                <p style={{ margin: 0, fontSize: '0.88rem' }}>
                  No hay empleados que cumplan años hoy.
                </p>
              </div>
            )}
          </section>

          {/* SECCIÓN 2: AYER (Atenuada) */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Clock size={17} style={{ color: 'var(--text-secondary)' }} />
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Ayer
              </h3>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border)',
                  padding: '0.05rem 0.5rem',
                  borderRadius: '999px',
                }}
              >
                {ayer.length}
              </span>
            </div>

            {ayer.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                {ayer.map((empleado) => (
                  <TarjetaCumpleanosEmpleado
                    key={empleado.id}
                    empleado={empleado}
                    variante="ayer"
                    onSeleccionarEmpleado={onSeleccionarEmpleado}
                  />
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                Ningún empleado cumplió años ayer.
              </p>
            )}
          </section>

          {/* SECCIÓN 3: MAÑANA (Normal) */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Calendar size={17} style={{ color: 'var(--text-primary)' }} />
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Mañana
              </h3>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border)',
                  padding: '0.05rem 0.5rem',
                  borderRadius: '999px',
                }}
              >
                {manana.length}
              </span>
            </div>

            {manana.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                {manana.map((empleado) => (
                  <TarjetaCumpleanosEmpleado
                    key={empleado.id}
                    empleado={empleado}
                    variante="manana"
                    onSeleccionarEmpleado={onSeleccionarEmpleado}
                  />
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                Ningún empleado cumple años mañana.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ModalCumpleanosPersonal;
