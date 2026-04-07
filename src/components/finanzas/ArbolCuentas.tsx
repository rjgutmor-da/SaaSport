/**
 * ArbolCuentas.tsx
 * Componente recursivo que renderiza el Plan de Cuentas como un árbol jerárquico
 * expandible/colapsable. Cada nodo muestra código, nombre, tipo y si es transaccional.
 */
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-react';
import type { NodoCuenta } from '../../types/finanzas';
import { COLORES_TIPO, ETIQUETAS_TIPO } from '../../types/finanzas';

interface ArbolCuentasProps {
  nodos: NodoCuenta[];
  busqueda: string;
}

/** Verifica si un nodo o alguno de sus hijos coincide con la búsqueda */
const coincideConBusqueda = (nodo: NodoCuenta, termino: string): boolean => {
  const terminoLower = termino.toLowerCase();
  if (
    nodo.codigo.toLowerCase().includes(terminoLower) ||
    nodo.nombre.toLowerCase().includes(terminoLower)
  ) return true;
  return nodo.hijos.some(h => coincideConBusqueda(h, termino));
};

/** Nodo individual del árbol (renderizado recursivo) */
const NodoArbol: React.FC<{ nodo: NodoCuenta; busqueda: string }> = ({ nodo, busqueda }) => {
  const [expandido, setExpandido] = useState(nodo.nivel < 2 || busqueda.length > 0);
  const tieneHijos = nodo.hijos.length > 0;
  const colores = COLORES_TIPO[nodo.tipo];

  // Si hay búsqueda activa y este nodo no coincide, no renderizar
  if (busqueda && !coincideConBusqueda(nodo, busqueda)) return null;

  // Forzar expansión automática cuando hay búsqueda
  const estaExpandido = busqueda.length > 0 ? true : expandido;

  return (
    <div className="arbol-nodo">
      {/* Fila del nodo */}
      <div
        className={`arbol-fila ${tieneHijos ? 'arbol-fila--grupo' : 'arbol-fila--hoja'}`}
        style={{
          paddingLeft: `${nodo.nivel * 24 + 12}px`,
          borderLeft: `3px solid ${colores.borde}`,
        }}
        onClick={() => tieneHijos && setExpandido(!estaExpandido)}
        role={tieneHijos ? 'button' : undefined}
        tabIndex={tieneHijos ? 0 : undefined}
        onKeyDown={(e) => {
          if (tieneHijos && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpandido(!estaExpandido);
          }
        }}
      >
        {/* Icono de expansión / hoja */}
        <span className="arbol-icono">
          {tieneHijos ? (
            estaExpandido ? <ChevronDown size={18} /> : <ChevronRight size={18} />
          ) : (
            <span style={{ width: 18 }} />
          )}
        </span>

        {/* Icono de carpeta / documento */}
        <span className="arbol-tipo-icono" style={{ color: colores.texto }}>
          {tieneHijos ? <Folder size={18} /> : <FileText size={16} />}
        </span>

        {/* Código */}
        <span className="arbol-codigo">{nodo.codigo}</span>

        {/* Nombre */}
        <span className={`arbol-nombre ${!nodo.es_transaccional ? 'arbol-nombre--grupo' : ''}`}>
          {nodo.nombre}
        </span>

        {/* Badge de tipo */}
        <span
          className="arbol-badge"
          style={{ backgroundColor: colores.bg, color: colores.texto, borderColor: colores.borde }}
        >
          {ETIQUETAS_TIPO[nodo.tipo]}
        </span>

        {/* Indicador transaccional */}
        {nodo.es_transaccional && (
          <span className="arbol-transaccional" title="Cuenta transaccional (acepta movimientos)">
            ✓ Transaccional
          </span>
        )}
      </div>

      {/* Hijos (recursivo) */}
      {tieneHijos && estaExpandido && (
        <div className="arbol-hijos">
          {nodo.hijos.map(hijo => (
            <NodoArbol key={hijo.id} nodo={hijo} busqueda={busqueda} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Componente principal del árbol */
const ArbolCuentas: React.FC<ArbolCuentasProps> = ({ nodos, busqueda }) => {
  if (nodos.length === 0) {
    return (
      <div className="arbol-vacio">
        <p>No se encontraron cuentas contables.</p>
      </div>
    );
  }

  return (
    <div className="arbol-contenedor">
      {nodos.map(nodo => (
        <NodoArbol key={nodo.id} nodo={nodo} busqueda={busqueda} />
      ))}
    </div>
  );
};

export default ArbolCuentas;
