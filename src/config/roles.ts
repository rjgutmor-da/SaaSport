/** Fuente unica de verdad para roles y permisos del ecosistema. */
export const ROLE_MATRIX = {
  SuperAdministrador: { label: 'SuperAdministrador', dataScope: 'school', permissions: {
    'asisport.access': true, 'asisport.viewStatistics': true, 'asisport.viewActivityLog': true,
    'asisport.manageAttendanceForOthers': true, 'asisport.editStudents': true,
    'saasport.access': true, 'school.manage': true, 'users.manage': true,
    'finance.delete': true, 'finance.reconcile': true, 'finance.manageAccounts': true,
    'finance.cxc.view': true, 'finance.cxc.create': true, 'finance.cxc.edit': true, 'finance.cxc.void': true,
    'finance.cxp.view': true, 'finance.boxes.view': true, 'finance.statistics.view': true,
    'attendancePhotos.view': true, 'medica.view': true, 'medica.manage': false,
  }},
  Administrador: { label: 'Administrador', dataScope: 'branch', permissions: {
    'asisport.access': true, 'asisport.viewStatistics': true, 'asisport.viewActivityLog': true,
    'asisport.manageAttendanceForOthers': true, 'asisport.editStudents': true,
    'saasport.access': true, 'school.manage': false, 'users.manage': false,
    'finance.delete': false, 'finance.reconcile': true, 'finance.manageAccounts': false,
    'finance.cxc.view': true, 'finance.cxc.create': true, 'finance.cxc.edit': true, 'finance.cxc.void': true,
    'finance.cxp.view': true, 'finance.boxes.view': true, 'finance.statistics.view': true,
    'attendancePhotos.view': true, 'medica.view': true, 'medica.manage': false,
  }},
  Asistente: { label: 'Asistente', dataScope: 'branch', permissions: {
    'asisport.access': true, 'asisport.viewStatistics': true, 'asisport.viewActivityLog': true,
    'asisport.manageAttendanceForOthers': true, 'asisport.editStudents': true,
    'saasport.access': true, 'school.manage': false, 'users.manage': false,
    'finance.delete': false, 'finance.reconcile': false, 'finance.manageAccounts': false,
    'finance.cxc.view': true, 'finance.cxc.create': true, 'finance.cxc.edit': false, 'finance.cxc.void': false,
    'finance.cxp.view': false, 'finance.boxes.view': true, 'finance.statistics.view': true,
    'attendancePhotos.view': true, 'medica.view': true, 'medica.manage': false,
  }},
  Entrenador: { label: 'Entrenador', dataScope: 'assigned_students', permissions: {
    'asisport.access': true, 'asisport.viewStatistics': false, 'asisport.viewActivityLog': false,
    'asisport.manageAttendanceForOthers': false, 'asisport.editStudents': false,
    'saasport.access': false, 'school.manage': false, 'users.manage': false,
    'finance.delete': false, 'finance.reconcile': false, 'finance.manageAccounts': false,
    'finance.cxc.view': false, 'finance.cxc.create': false, 'finance.cxc.edit': false, 'finance.cxc.void': false,
    'finance.cxp.view': false, 'finance.boxes.view': false, 'finance.statistics.view': false,
    'attendancePhotos.view': false, 'medica.view': true, 'medica.manage': false,
  }},
  Entrenarqueros: { label: 'Entrenador de Arqueros', dataScope: 'goalkeepers', permissions: {
    'asisport.access': true, 'asisport.viewStatistics': false, 'asisport.viewActivityLog': false,
    'asisport.manageAttendanceForOthers': false, 'asisport.editStudents': false,
    'saasport.access': false, 'school.manage': false, 'users.manage': false,
    'finance.delete': false, 'finance.reconcile': false, 'finance.manageAccounts': false,
    'finance.cxc.view': false, 'finance.cxc.create': false, 'finance.cxc.edit': false, 'finance.cxc.void': false,
    'finance.cxp.view': false, 'finance.boxes.view': false, 'finance.statistics.view': false,
    'attendancePhotos.view': false, 'medica.view': true, 'medica.manage': false,
  }},
  Medico: { label: 'Médico', dataScope: 'school', permissions: {
    'asisport.access': true, 'asisport.viewStatistics': false, 'asisport.viewActivityLog': false,
    'asisport.manageAttendanceForOthers': false, 'asisport.editStudents': false,
    'saasport.access': false, 'school.manage': false, 'users.manage': false,
    'finance.delete': false, 'finance.reconcile': false, 'finance.manageAccounts': false,
    'finance.cxc.view': false, 'finance.cxc.create': false, 'finance.cxc.edit': false, 'finance.cxc.void': false,
    'finance.cxp.view': false, 'finance.boxes.view': false, 'finance.statistics.view': false,
    'attendancePhotos.view': false, 'medica.view': true, 'medica.manage': true,
  }},
} as const;

export type Role = keyof typeof ROLE_MATRIX;
export type Permission = keyof (typeof ROLE_MATRIX)[Role]['permissions'];
export type DataScope = (typeof ROLE_MATRIX)[Role]['dataScope'];
export const ROLES = Object.keys(ROLE_MATRIX) as Role[];
export const isRole = (role: unknown): role is Role => typeof role === 'string' && Object.prototype.hasOwnProperty.call(ROLE_MATRIX, role);
export const can = (role: unknown, permission: Permission): boolean => isRole(role) && ROLE_MATRIX[role].permissions[permission] === true;
export const rolesWithPermission = (permission: Permission): Role[] => ROLES.filter(role => can(role, permission));
export const getDataScope = (role: unknown): DataScope | null => isRole(role) ? ROLE_MATRIX[role].dataScope : null;
export const getRoleOptions = () => ROLES.map(value => ({ value, label: ROLE_MATRIX[value].label }));
