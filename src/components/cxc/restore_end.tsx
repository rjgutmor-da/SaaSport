                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Modal de edición de Nota */}
        <NotaServicios
          visible={!!cxcParaEditar}
          onCerrar={() => setCxcParaEditar(null)}
          onCreada={() => {
            onActualizar();
            supabase.from('v_cuentas_cobrar').select('*')
              .eq('alumno_id', alumno.alumno_id)
              .order('created_at', { ascending: false })
              .then(({ data }) => {
                setCxcs((data as unknown as CuentaCobrar[]) ?? []);
                setDetalles({}); 
              });
          }}
          cxcEditar={cxcParaEditar}
        />

        <ModalSaldoInicialCxC
          visible={!!siParaEditar}
          onCerrar={() => setSiParaEditar(null)}
          onCreado={() => {
            setSiParaEditar(null);
            onActualizar();
            supabase.from('v_cuentas_cobrar').select('*')
              .eq('alumno_id', alumno.alumno_id)
              .order('created_at', { ascending: false })
              .then(({ data }) => setCxcs((data as unknown as CuentaCobrar[]) ?? []));
          }}
          edicionItem={siParaEditar}
        />

        <ModalEditarMovimiento
          visible={!!movEditar}
          movimiento={movEditar}
          cajas={cuentasCobro}
          onCerrar={() => setMovEditar(null)}
          onGuardado={() => {
            setMovEditar(null);
            onActualizar();
            if (expandida) {
              cargarDetalle(expandida);
              setExpandida(expandida); 
            }
          }}
        />

        <NotaServicios
          visible={mostrarNotaAnticipo}
          onCerrar={() => setMostrarNotaAnticipo(false)}
          onCreada={() => {
            setMostrarNotaAnticipo(false);
            onActualizar();
            supabase.from('v_cuentas_cobrar').select('*')
              .eq('alumno_id', alumno.alumno_id)
              .order('created_at', { ascending: false })
              .then(({ data }) => setCxcs((data as unknown as CuentaCobrar[]) ?? []));
          }}
          alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }}
          esAnticipo={true}
        />
      </>
    );
  };

  export default DetalleAlumnoCxc;
