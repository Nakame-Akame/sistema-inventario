const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GRUPOS_PERMISOS,
  PERMISOS_DISPONIBLES,
} = require('../middleware/permisos');

test('user-management permission is included in the valid permission catalog', () => {
  const tienePermisoUsuario = GRUPOS_PERMISOS.some(grupo =>
    grupo.permisos.some(permiso => permiso.id === 'usuarios:administrar')
  );

  assert.equal(tienePermisoUsuario, true);
  assert.equal(PERMISOS_DISPONIBLES.has('usuarios:administrar'), true);
});
