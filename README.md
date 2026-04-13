# SaaSport — Módulo de Finanzas y CxC

Bienvenido al sistema de gestión financiera de **SaaSport**. Este proyecto es una extensión de la plataforma **AsiSport**, enfocada en la administración de cuentas por cobrar, cuentas por pagar, inventarios y contabilidad general.

## 🚀 Tecnologías
- **Frontend:** React + TypeScript + Vite
- **Iconos:** Lucide React
- **Estilos:** Vanilla CSS (Diseño Premium & Responsive)
- **Backend:** Supabase (PostgreSQL 17)
- **Integridad:** Funciones RPC atómicas para transacciones financieras.

## 📂 Estructura del Proyecto
- `/src/pages/cxc`: Módulo de Cuentas por Cobrar.
- `/src/pages/finanzas`: Libro Diario, Plan de Cuentas y Registro de Actividad.
- `/src/pages/config`: Configuraciones generales.
- `/src/components/cxc`: Componentes especializados para gestión de deudas y pagos.

## 🛠️ Cómo Probar (Verificación Manual)
Para ejecutar el proyecto localmente:

1. Asegúrate de tener las variables de entorno en el archivo `.env`:
   ```env
   VITE_SUPABASE_URL=tu_url
   VITE_SUPABASE_ANON_KEY=tu_anon_key
   ```
2. Instala dependencias: `npm install`
3. Inicia el servidor: `npm run dev`
4. Accede a `http://localhost:5174/`

### Tareas de Verificación Sugeridas:
1. **Crear Nota:** Usa el modal de "Nueva Nota" en CxC.
2. **Registrar Cobro:** Haz un pago parcial/total desde el detalle del alumno.
3. **Validar Contabilidad:** Revisa que el **Libro Diario** refleje los movimientos.
4. **Resguardo de Auditoría:** Verifica que cada acción financiera genere un log en el módulo de auditoría.

## 🛡️ Seguridad
El sistema utiliza RLS (Row Level Security) y validación de roles (`SuperAdministrador`, `Dueño`, `Administrador`) para proteger las operaciones críticas como la anulación de facturas o edición de registros.

---
Generado por **Antigravity**.
