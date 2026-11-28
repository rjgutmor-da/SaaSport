/** Alerta visual para advertir coincidencias de alumno duplicado o archivado. */
import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { AdvertenciaDuplicado } from '../../types/alumnos';

interface AdvertenciaAlumnoDuplicadoProps {
  advertencia: AdvertenciaDuplicado | null;
  error?: string;
  verificando?: boolean;
}

const AdvertenciaAlumnoDuplicado: React.FC<AdvertenciaAlumnoDuplicadoProps> = ({
  advertencia,
  error = '',
  verificando = false,
}) => {
  if (!advertencia && !error && !verificando) return null;

  if (verificando && !advertencia && !error) {
    return (
      <div className="alumno-duplicado-verificando" aria-live="polite">
        <Loader2 size={15} className="spin" />
        <span>Verificando si el alumno ya existe...</span>
      </div>
    );
  }

  const esArchivado = Boolean(advertencia?.archivado);
  const titulo = error
    ? 'No pudimos verificar al alumno'
    : esArchivado
      ? 'Este alumno tiene un registro archivado'
      : 'Este alumno ya está registrado';

  const descripcion = error
    || (esArchivado
      ? 'Puedes cambiar el filtro superior a "Archivados" y restaurar su ficha para conservar su historial financiero.'
      : 'Existe un registro con el mismo nombre completo o carnet en esta escuela. Revisa el padrón antes de duplicarlo.');

  return (
    <div className="alumno-duplicado-alerta" role="alert" aria-live="assertive">
      <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
      <div>
        <p className="alumno-duplicado-titulo">{titulo}</p>
        <p className="alumno-duplicado-desc">{descripcion}</p>
      </div>
    </div>
  );
};

export default AdvertenciaAlumnoDuplicado;
