# Sistema de comprobantes

## Requisitos

- Node.js 24 o una versión LTS compatible.
- npm.

## Instalación

```powershell
npm install
Copy-Item .env.example .env
```

Si npm 11 informa que el script de instalación de `better-sqlite3` está pendiente de aprobación, revisa y autoriza ese paquete con `npm approve-scripts better-sqlite3` y ejecuta `npm rebuild better-sqlite3`. Es el binding nativo que necesita SQLite; no apruebes scripts de otros paquetes sin revisarlos.

Genera un secreto de sesión y colócalo en `SESSION_SECRET` dentro de `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

El servidor se niega a iniciar si `SESSION_SECRET` está vacío.

## Migrar datos SQLite a Supabase

La migración conserva el archivo SQLite original. Copia la cadena PostgreSQL del proyecto desde Supabase (Database > Connect) a `SUPABASE_DB_URL` en `.env`. Esta variable debe contener la cadena de conexión de la base de datos, no una clave `anon` o `service_role`, y debe mantenerse privada.

Aplica `supabase/schema.sql` en el SQL Editor de Supabase. Luego revisa cuántos registros se importarían, sin escribir en Supabase:

```powershell
npm run db:migrate:supabase
```

Cuando la vista previa sea correcta y el destino esté vacío, ejecuta la importación transaccional:

```powershell
npm run db:migrate:supabase -- --apply
```

El importador se niega a combinar datos si encuentra registros en cualquiera de las tablas de destino. La aplicación aún usa la capa SQLite; la importación por sí sola no cambia la conexión del servidor. La conversión de rutas y transacciones a PostgreSQL debe completarse antes de apuntar la aplicación a Supabase.

Configura los valores de `.env` según el entorno:

| Variable | Uso | Valor predeterminado |
| --- | --- | --- |
| `PORT` | Puerto HTTP | `3000` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `SESSION_SECRET` | Firma de cookies de sesión; obligatorio | Sin valor |
| `DB_PATH` | Archivo SQLite; puede ser una ruta absoluta o relativa al proyecto | `facturacion.db` |
| `SUPABASE_DB_URL` | Conexión PostgreSQL de Supabase; solo la usa el importador | Sin valor |
| `LOGIN_RATE_LIMIT` | Intentos de login por ventana | `5` |
| `BACKUP_DIR` | Directorio para respaldos; puede ser absoluto o relativo al proyecto | `backups` |
| `CORS_ORIGIN` | Orígenes externos autorizados separados por coma; déjalo vacío para mismo origen | Vacío |
| `CHROME_EXECUTABLE_PATH` | Ruta de Chrome/Chromium local para generar PDF | Detección automática |
| `DECOLECTA_API_TOKEN` | Token Bearer para consultar DNI/RUC desde el servidor | Sin valor |

No copies secretos reales a `.env.example` ni al repositorio. En producción sirve la interfaz y la API desde el mismo origen siempre que sea posible. Si la interfaz vive en otro origen, añade su origen exacto a `CORS_ORIGIN` (por ejemplo `https://ventas.ejemplo.com`).

## Generación de PDF

En Windows se detecta Chrome en las rutas habituales. Si está instalado en otra ubicación, configura `CHROME_EXECUTABLE_PATH` en `.env`. En Linux se usa Chromium de Sparticuz.

## Primer administrador

```powershell
npm run admin:create
```

El comando solicita nombre, correo y contraseña (mínimo 12 caracteres), y almacena la contraseña con bcrypt. Si ese correo ya corresponde a un administrador, permite restablecer la cuenta desde la consola. El servidor no crea usuarios ni contraseñas automáticamente.

## Iniciar

```powershell
npm start
```

El servidor queda disponible en `http://localhost:3000` (o en el puerto definido por `PORT`). La ruta `GET /api/health` comprueba también que SQLite responde. El frontend usa una ruta relativa `/api`, así que no requiere cambiar código al desplegarlo detrás de otro host o puerto.

### Estructura del frontend

`public/index.html` contiene el shell común y carga las vistas desde `public/pages/` antes de iniciar `public/app.js`. Cada pantalla tiene un fragmento HTML propio; los modales compartidos están en `public/pages/modals.html` y los estilos globales en `public/Style.css`.

### Importar productos desde XLS

Para cargar un catálogo con las columnas `Producto`, `Precio Unidad`, `Precio Mayor`, `Precio Especial`, `Precio Compra Promedio`, `Stock Real` y `Familia`:

```powershell
node scripts/import-productos.js .\productos.xls
```

La importación usa `Precio Unidad` como Unidad, `Precio Mayor` como Rebaja, `Precio Especial` como Pase y `Precio Compra Promedio` como costo de compra. Todos estos importes se consideran con IGV incluido. Actualiza productos existentes por nombre, evita duplicados, convierte stock negativo a cero y omite filas sin precio de venta válido.

## Pruebas

```powershell
npm test
npm run typecheck
```

Las pruebas usan SQLite en memoria y no escriben en `facturacion.db`. El chequeo TypeScript está habilitado gradualmente para `services/comprobantes.js`; el servidor y las rutas continúan ejecutándose como CommonJS/JavaScript.

## Reglas de comprobantes

- La cantidad debe ser positiva y admite hasta 6 decimales. Cada solicitud acepta hasta 100 ítems.
- Para líneas de producto, el precio siempre sale del catálogo; cualquier precio enviado por el navegador se ignora. Las guías pueden llevar una descripción libre sin precio.
- Importes y descuentos se normalizan a centavos con redondeo decimal. El descuento por línea no puede exceder su precio y el descuento general no puede exceder el subtotal.
- Devoluciones y notas de crédito requieren un comprobante de venta del mismo cliente y no pueden ajustar más unidades que las aún disponibles.
- Emisión, reserva de serie, movimientos de stock, anulación y devolución usan transacciones SQLite. No se permite stock negativo; las anulaciones repetidas o transiciones de estado no autorizadas se rechazan.

## Inventario y kardex

`GET /api/inventario/kardex` lista movimientos y acepta filtros opcionales `producto_id`, `almacen_id`, `tipo`, `desde` y `hasta`. Las fechas usan el formato `YYYY-MM-DD`; el rango incluye ambos días. Tipos admitidos: `ENTRADA`, `SALIDA`, `VENTA`, `COMPRA`, `DEVOLUCION`, `AJUSTE` y `TRANSFERENCIA`. `GET /api/inventario/resumen` muestra existencias, valor estimado, alertas y totales por almacén; `GET /api/reportes/alertas-stock` ofrece el listado de productos bajo el umbral configurado (o cinco unidades si no se definió).

## Proveedores y compras

La sección Compras mantiene el catálogo de proveedores con documento único, razón social y datos de contacto. Permite buscar, editar y desactivar o reactivar proveedores; al registrar una compra, se puede seleccionar uno para completar sus datos. Los documentos guardan los datos del proveedor como historial propio, por lo que cambios posteriores al catálogo no modifican compras anteriores. La captura admite hasta 100 productos por documento, cada uno con cantidad y costo unitario, en un almacén común. Al elegir USD, cada costo se convierte a PEN con el tipo de cambio mostrado. El documento, el stock, el costo del producto, sus detalles y los movimientos kardex se guardan en una sola transacción; si una línea no es válida, se revierte toda la recepción. También se pueden guardar documentos sin ingresar stock. La API está protegida por los permisos de compras.

El historial incluye los productos, cantidades, costos y almacenes registrados en cada recepción. `GET /api/reportes/compras?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` devuelve resumen de documentos, líneas y unidades, agrupado por proveedor y por producto; las fechas del periodo son inclusivas y obligatorias.

El historial de compras se puede filtrar por proveedor/RUC/serie, condición de pago, estado y rango inclusivo de fechas. `GET /api/reportes/compras/exportar?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` descarga un Excel con las hojas `Recepciones` (detalle de productos) y `Cuentas por pagar` (créditos pendientes y saldo neto después de abonos).

En documentos a crédito, `PATCH /api/compras/:id/pago` registra el saldo completo y `POST /api/compras/:id/pagos` admite abonos con monto, fecha y método (`efectivo`, `transferencia`, `tarjeta` u `otro`). No admite documentos al contado, fechas inválidas ni pagos por encima del saldo. El historial incluye cada pago, lo abonado y el saldo restante. El reporte `GET /api/reportes/cuentas-por-pagar?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` lista créditos no pagados y agrupa importe, abonado y saldo **estimado** en PEN a partir de las líneas de recepción registradas. No calcula vencimientos y los documentos sin líneas tienen saldo estimado cero.

Las facturas y boletas a crédito aceptan cobros parciales con `POST /api/comprobantes/:id/pagos`; el sistema guarda monto, fecha, método y referencia y cambia el estado automáticamente entre `emitido`, `parcial` y `pagado`. `GET /api/reportes/cuentas-por-cobrar?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` muestra cobrado, saldo neto, vencimientos y días de mora. Las ventas con cobros registrados no se pueden anular directamente.

El detalle de cada comprobante incluye los cobros registrados y su saldo. `GET /api/reportes/cuentas-por-cobrar/exportar?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` descarga un Excel con las hojas `Cuentas por cobrar` y `Resumen por cliente`, calculadas para el mismo rango inclusivo del reporte.

## Roles

| Acción | Administrador | Vendedor |
| --- | --- | --- |
| Consultar clientes, productos, comprobantes, reportes y PDF | Sí | Sí |
| Crear clientes | Sí | Sí |
| Editar o eliminar clientes | Sí | No |
| Crear, editar, eliminar productos o ajustar stock | Sí | No |
| Crear factura, boleta, pedido, guía o cotización | Sí | Sí |
| Marcar comprobantes como pagados | Sí | Sí |
| Anular, devolver, crear notas de crédito o administrar usuarios | Sí | No |

Los permisos se verifican en el servidor. La matriz de vendedor es una política inicial y debe confirmarse con el negocio antes de habilitar más acciones.

El administrador puede crear cuentas desde la sección Usuarios y asignar los roles `admin` o `vendedor`. Al crear un vendedor puede seleccionar permisos por módulo; el servidor valida y aplica cada selección en todas las rutas protegidas. Los administradores siempre conservan acceso total. Las contraseñas deben tener al menos 12 caracteres y se almacenan con bcrypt. El sistema no permite autoeliminarse ni eliminar al último administrador; los vendedores no pueden listar ni administrar cuentas.

## Respaldar y restaurar

```powershell
npm run db:backup
npm run db:restore -- .\backups\facturacion-<fecha>.db
```

El respaldo se verifica con `quick_check`. Las rutas relativas de `DB_PATH` y `BACKUP_DIR` se resuelven desde el directorio del proyecto, incluso al ejecutar un comando programado desde otra carpeta. Antes de restaurar, detén el servidor; si ya existe una base en el destino, el comando conserva una copia previa junto a ella. Las pruebas automáticas verifican respaldo, restauración e integridad usando archivos temporales.

### Programar respaldos

Programa `npm run db:backup` diariamente con el usuario del sistema operativo que tenga acceso al proyecto y a `.env`. Por ejemplo, en Windows PowerShell, desde la carpeta del proyecto:

```powershell
$project = (Get-Location).Path
$action = New-ScheduledTaskAction -Execute "$env:ComSpec" -Argument "/c npm run db:backup" -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
Register-ScheduledTask -TaskName "SistemaFacturacionBackup" -Action $action -Trigger $trigger -Description "Respaldo diario de SQLite"
```

En Linux/macOS, agrega una entrada de `cron` con la ruta absoluta al proyecto (ajusta usuario y directorio):

```cron
0 2 * * * cd /ruta/al/proyecto && /usr/bin/npm run db:backup >> /var/log/sistema-facturacion-backup.log 2>&1
```

Comprueba periódicamente el historial/resultado de la tarea y conserva copias fuera del equipo de producción. Para ensayar recuperación: detén el servidor, restaura una copia reciente con `npm run db:restore -- <archivo>`, confirma el mensaje de éxito, inicia el servidor y verifica `GET /api/health` y los datos esperados. Haz el primer ensayo en una copia aislada, no sobre la base real.

## Despliegue y operación

1. Instala Node.js y npm; clona o extrae el proyecto en una carpeta persistente.
2. Ejecuta `npm install`, crea `.env` desde `.env.example`, establece `SESSION_SECRET` y define `DB_PATH`/`BACKUP_DIR` si no usarás las rutas locales predeterminadas.
3. Ejecuta `npm run admin:create` una sola vez para crear el administrador inicial. No incluyas la contraseña en comandos o logs.
4. Ejecuta `npm test` y luego `npm start`. En despliegues permanentes, ejecuta Node con un supervisor de procesos del sistema operativo y configura proxy HTTPS; no expongas la app directamente a Internet sin TLS.
5. Programa y verifica los respaldos. Antes de actualizar, crea un respaldo, detén el proceso, actualiza dependencias con `npm install`, ejecuta pruebas y vuelve a iniciar.

Los errores no controlados de API producen JSON uniforme para el cliente y una línea JSON con nivel, fecha, método, ruta, estado y tipo de error en el log del proceso. No se registran cuerpos de solicitudes ni mensajes que puedan incluir datos sensibles. `GET /api/health` devuelve `503` si SQLite no responde.

### Consulta de DNI y RUC

El selector de clientes puede consultar DNI en RENIEC y RUC en SUNAT por medio de Decolecta. Genera un token en <https://decolecta.com/profile> y guárdalo como `DECOLECTA_API_TOKEN` únicamente en `.env`; las consultas salen desde el backend. El proveedor documenta 100 consultas gratuitas al mes, sujeto a cambios. La consulta está limitada a 30 solicitudes por IP cada 15 minutos. Al confirmar un resultado que aún no existe, el sistema registra el cliente y lo selecciona para el comprobante.

### Pruebas temporales de SUNAT

La conexión real de producción no está habilitada. SUNAT documenta dos entornos de prueba. Beta usa el endpoint beta y credenciales de prueba (`RUC+MODDATOS` / `MODDATOS`), sin requerir certificado digital registrado. Homologación SQA usa el endpoint `https://ww1.sunat.gob.pe/ol-ti-itcpgem-sqa/billService` y credenciales SOL secundarias autorizadas para el perfil de envío. La contraseña SOL no debe usarse en Beta ni compartirse por chat. La configuración solo acepta `SUNAT_MODE=disabled`, `beta` u `homologation`, fija los endpoints HTTPS y rechaza ambos modos si `NODE_ENV=production`.

Para Beta configura `SUNAT_MODE=beta` y `SUNAT_RUC`. Para homologación configura `SUNAT_MODE=homologation`, `SUNAT_RUC`, `SUNAT_SOL_USER` y `SUNAT_SOL_PASSWORD` solo en `.env` local, y verifica con SUNAT el usuario secundario/perfil habilitado. No coloques credenciales en comandos, logs ni el repositorio. La Clave SOL autentica la llamada SOAP; la firma XMLDSig requiere aparte el certificado digital registrado del emisor. La configuración no envía comprobantes todavía; el XML, firma, envío y ciclo CDR deben completarse y probarse antes de considerar terminada la fase 4. La arquitectura final elegida sigue siendo un PSE autorizado, cuya API y credenciales sandbox deben definirse antes del despliegue.

### Criterios para evaluar PostgreSQL

No se migra la base de datos en esta fase. Reevalúa SQLite cuando se observen bloqueos de escritura frecuentes bajo concurrencia real, varios procesos/instancias escribiendo a la vez, crecimiento de usuarios simultáneos que afecte latencia o requisitos de alta disponibilidad/operación centralizada. Antes de aprobar una migración: medir esos indicadores, diseñar mapeo de esquema y tipos, ensayar exportación/importación en una copia, comparar conteos e importes, preparar periodo de solo lectura/corte, plan de reversión y respaldo restaurable. No ejecutar la migración hasta aprobar el plan y validar una prueba integral.

## Datos sensibles en Git

Las bases SQLite, respaldos y archivos `.env` están excluidos por `.gitignore`; `.env.example` no contiene secretos. Ignorar un archivo no lo elimina de commits anteriores. Si una base real o un secreto ya se publicó, rota las credenciales y coordina con quien administra el repositorio cualquier limpieza de historial; esta fase no reescribe el historial.