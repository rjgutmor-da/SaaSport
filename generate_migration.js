import fs from 'fs';

const csvPath = 'C:\\Users\\Public\\Documents\\SaaSport\\PlanCuentasEscuelasFutbol.csv';
const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter(Boolean);

const sqlCommands = [];
sqlCommands.push(`-- Migración para el nuevo Plan de Cuentas de Escuelas de Fútbol`);
sqlCommands.push(`-- Eliminar el plan de cuentas genérico actual para escuelas (NULL)`);
sqlCommands.push(`DELETE FROM public.plan_cuentas WHERE escuela_id IS NULL;`);
sqlCommands.push(``);
sqlCommands.push(`INSERT INTO public.plan_cuentas (codigo, nombre, tipo, es_transaccional) VALUES `);

const values = [];

function determineType(codigo) {
    if (codigo.startsWith('1')) return 'activo';
    if (codigo.startsWith('2')) return 'pasivo';
    if (codigo.startsWith('3')) return 'patrimonio';
    if (codigo.startsWith('4')) return 'ingreso';
    if (codigo.startsWith('5')) return 'gasto';
    return 'activo';
}

for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    // Some lines are descriptions instead of accounts, ignore them
    const match = line.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
    if (match) {
        let codigo = match[1];
        let nombre = match[2];
        let tipo = determineType(codigo);
        let transaccional = codigo.split('.').length >= 3; // level 3 or more is transaccional usually
        
        // exceptions for top levels being transaccional or not?
        if (codigo === '1' || codigo === '2' || codigo === '3' || codigo === '4' || codigo === '5') {
            transaccional = false;
        }
        
        // Exclude 1.1.1 and 1.1.2 from transaccional because they will be parents
        if (codigo === '1.1.1' || codigo === '1.1.2') {
            transaccional = false;
        }

        // Clean quotes if any
        nombre = nombre.replace(/'/g, "''");
        values.push(`('${codigo}', '${nombre}', '${tipo}', ${transaccional})`);
    }
}

// Add the 3 Cajas y Bancos accounts explicitly!
values.push(`('1.1.1.01', 'Caja General', 'activo', true)`);
values.push(`('1.1.2.01', 'Banco Unión', 'activo', true)`);
values.push(`('1.1.2.02', 'Banco Mercantil', 'activo', true)`);

sqlCommands.push(values.join(',\n') + ';');

fs.writeFileSync('C:\\Users\\Public\\Documents\\SaaSport\\supabase\\migrations\\20260408_02_plan_cuentas_futbol.sql', sqlCommands.join('\n'));
console.log('Migration generated successfully.');
