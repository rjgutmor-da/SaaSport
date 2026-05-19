/**
 * MobileHeader.tsx
 * Encabezado fijo para la versión móvil de SaaSport.
 * Muestra el logo de la marca y el ícono de la app.
 */

export function MobileHeader() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1rem',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        borderRadius: '0 0 12px 12px',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      {/* Logo de la marca */}
      <span
        style={{
          fontSize: '1.5rem',
          fontWeight: 900,
          color: 'var(--primary)',
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        SaaSport
      </span>

      {/* Ícono de la app */}
      <img
        src="/saasport-app-icon-v3.png"
        alt="SaaSport"
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '8px',
          objectFit: 'contain',
        }}
        onError={(e) => {
          // Si no existe el ícono, ocultar la imagen
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </header>
  );
}
