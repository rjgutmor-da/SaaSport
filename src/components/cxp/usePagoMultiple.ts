import { useState } from 'react';
import type { NotaResumenCxP } from '../../types/cxp';

/**
 * Hook personalizado para gestionar el estado del pago múltiple en CxP.
 * Permite seleccionar qué notas pagar y definir los montos específicos para cada una.
 */
export const usePagoMultiple = (notas: NotaResumenCxP[]) => {
  // Estado para las notas seleccionadas (ID de la nota -> booleano)
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});
  // Estado para los montos personalizados a pagar por nota (ID de la nota -> string)
  const [montos, setMontos] = useState<Record<string, string>>({});

  // Inicializa o re-inicializa el estado cuando cambian las notas de deudas (por ejemplo, al hacer clic en Pagar)
  const inicializar = () => {
    const notasPendientes = notas.filter(
      (n) => !(n as any).anulada && Number(n.deuda_restante) > 0 && !n.es_anticipo
    );

    const inicialSeleccionados: Record<string, boolean> = {};
    const inicialMontos: Record<string, string> = {};

    notasPendientes.forEach((nota) => {
      inicialSeleccionados[nota.id] = true;
      inicialMontos[nota.id] = String(nota.deuda_restante);
    });

    setSeleccionados(inicialSeleccionados);
    setMontos(inicialMontos);
  };

  // Alterna la selección de una nota
  const toggleSeleccion = (notaId: string, saldo: number) => {
    setSeleccionados((prev) => {
      const nuevoEstado = !prev[notaId];
      
      // Si se selecciona, autocompletar con el saldo pendiente, de lo contrario limpiar el monto
      setMontos((prevMontos) => ({
        ...prevMontos,
        [notaId]: nuevoEstado ? String(saldo) : '',
      }));

      return {
        ...prev,
        [notaId]: nuevoEstado,
      };
    });
  };

  // Actualiza el monto personalizado a pagar por una nota, validando límites
  const cambiarMonto = (notaId: string, valor: string, maximo: number) => {
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
      [notaId]: valorLimpio,
    }));

    // Si el usuario ingresa un monto válido mayor a 0, nos aseguramos de que esté seleccionada la nota
    if (!isNaN(numero) && numero > 0) {
      setSeleccionados((prev) => ({
        ...prev,
        [notaId]: true,
      }));
    }
  };

  // Calcula el total acumulado de los montos seleccionados
  const obtenerTotalPagado = (): number => {
    return Object.entries(seleccionados)
      .filter(([_, estaSeleccionado]) => estaSeleccionado)
      .reduce((suma, [id]) => {
        const montoNum = parseFloat(montos[id] || '0');
        return suma + (isNaN(montoNum) ? 0 : montoNum);
      }, 0);
  };

  // Genera el payload de pagos listo para enviar al RPC
  const generarPayloadPagos = () => {
    return Object.entries(seleccionados)
      .filter(([_, estaSeleccionado]) => estaSeleccionado)
      .map(([id]) => {
        const montoNum = parseFloat(montos[id] || '0');
        return {
          cuenta_pagar_id: id,
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
    obtenerTotalPagado,
    generarPayloadPagos,
  };
};
