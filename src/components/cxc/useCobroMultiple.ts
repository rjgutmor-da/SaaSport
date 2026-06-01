import { useState } from 'react';
import type { CuentaCobrar } from '../../types/cxc';

/**
 * Hook personalizado para gestionar el estado del cobro múltiple.
 * Permite seleccionar qué notas cobrar y definir los montos específicos para cada una.
 */
export const useCobroMultiple = (cxcs: CuentaCobrar[]) => {
  // Estado para las notas seleccionadas (ID de la nota -> booleano)
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});
  // Estado para los montos personalizados a cobrar por nota (ID de la nota -> string)
  const [montos, setMontos] = useState<Record<string, string>>({});

  // Inicializa o re-inicializa el estado cuando cambian las notas de deudas (por ejemplo, al abrir el modal)
  const inicializar = () => {
    const notasPendientes = cxcs.filter(
      (c) => !c.anulada && Number(c.saldo_pendiente) > 0 && !(c as any).es_anticipo
    );

    const inicialSeleccionados: Record<string, boolean> = {};
    const inicialMontos: Record<string, string> = {};

    notasPendientes.forEach((cxc) => {
      inicialSeleccionados[cxc.id] = true;
      inicialMontos[cxc.id] = String(cxc.saldo_pendiente);
    });

    setSeleccionados(inicialSeleccionados);
    setMontos(inicialMontos);
  };

  // Alterna la selección de una nota
  const toggleSeleccion = (cxcId: string, saldo: number) => {
    setSeleccionados((prev) => {
      const nuevoEstado = !prev[cxcId];
      
      // Si se selecciona, autocompletar con el saldo pendiente, de lo contrario limpiar el monto
      setMontos((prevMontos) => ({
        ...prevMontos,
        [cxcId]: nuevoEstado ? String(saldo) : '',
      }));

      return {
        ...prev,
        [cxcId]: nuevoEstado,
      };
    });
  };

  // Actualiza el monto personalizado a cobrar por una nota, validando límites
  const cambiarMonto = (cxcId: string, valor: string, maximo: number) => {
    let valorLimpio = valor;
    
    // Validar que no sea negativo ni exceda el saldo de la nota
    const numero = parseFloat(valor);
    if (!isNaN(numero)) {
      if (numero < 0) {
        valorLimpio = '0';
      } else if (numero > maximo) {
        valorLimpio = String(maximo);
      }
    }

    setMontos((prev) => ({
      ...prev,
      [cxcId]: valorLimpio,
    }));

    // Si el usuario ingresa un monto válido mayor a 0, nos aseguramos de que esté seleccionada la nota
    if (!isNaN(numero) && numero > 0) {
      setSeleccionados((prev) => ({
        ...prev,
        [cxcId]: true,
      }));
    }
  };

  // Calcula el total acumulado de los montos seleccionados
  const obtenerTotalCobrado = (): number => {
    return Object.entries(seleccionados)
      .filter(([_, estaSeleccionado]) => estaSeleccionado)
      .reduce((suma, [id]) => {
        const montoNum = parseFloat(montos[id] || '0');
        return suma + (isNaN(montoNum) ? 0 : montoNum);
      }, 0);
  };

  // Genera el payload de cobros listo para enviar al RPC
  const generarPayloadCobros = () => {
    return Object.entries(seleccionados)
      .filter(([_, estaSeleccionado]) => estaSeleccionado)
      .map(([id]) => {
        const montoNum = parseFloat(montos[id] || '0');
        return {
          cuenta_cobrar_id: id,
          monto: parseFloat((montoNum || 0).toFixed(2)),
        };
      })
      .filter((item) => item.monto > 0);
  };

  return {
    seleccionados,
    montos,
    inicializar,
    toggleSeleccion,
    cambiarMonto,
    obtenerTotalCobrado,
    generarPayloadCobros,
  };
};
