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

Configura los valores de `.env` según el entorno:

| Variable | Uso | Valor predeterminado |
| --- | --- | --- |
| `PORT` | Puerto HTTP | `3000` |
| `HOST` | Interfaz de red donde escucha Node; producción debe usar loopback | `0.0.0.0` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `SESSION_SECRET` | Firma de cookies de sesión; obligatorio | Sin valor |
| `DB_PATH` | Archivo SQLite; puede ser una ruta absoluta o relativa al proyecto | `facturacion.db` |
| `TRUST_PROXY_HOPS` | Proxies inversos confiables delante de Node; usa `1` con un único Nginx local | `0` |
| `LOGIN_RATE_LIMIT` | Intentos fallidos permitidos por IP cada 15 minutos | `5` |
| `BACKUP_DIR` | Directorio para respaldos; puede ser absoluto o relativo al proyecto | `backups` |
| `BACKUP_OFFSITE_DIR` | Directorio montado en almacenamiento externo, separado del servidor | Vacío |
| `BACKUP_ENCRYPTION_KEY` | Clave hexadecimal de 32 bytes para cifrar copias externas | Sin valor |
| `BACKUP_RETENTION_DAYS` | Días de retención de copias generadas | `30` |
| `CORS_ORIGIN` | Orígenes externos autorizados separados por coma; déjalo vacío para mismo origen | Vacío |
| `CHROME_EXECUTABLE_PATH` | Ruta de Chrome/Chromium local para generar PDF | Detección automática |
| `DECOLECTA_API_TOKEN` | Token Bearer para consultar DNI/RUC desde el servidor | Sin valor |

No copies secretos reales a `.env.example` ni al repositorio. En producción sirve la interfaz y la API desde el mismo origen siempre que sea posible. Si la interfaz vive en otro origen, añade su origen exacto HTTPS a `CORS_ORIGIN` (por ejemplo `https://ventas.ejemplo.com`).

Cada IP puede realizar hasta cinco intentos fallidos de inicio de sesión cada 15 minutos; los accesos correctos no consumen el límite. En producción, configura `TRUST_PROXY_HOPS` con la cantidad exacta de proxies confiables y no expongas directamente el puerto de Node.

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

### Recursos web de producción

Antes de desplegar, ejecuta `npm run build`. El comando genera `dist/public` con una hoja CSS y un script JavaScript agrupados y minificados en `dist/public/assets/`, sin mapas de código fuente; no se publica el directorio `public` original ni sus hojas separadas. Con `NODE_ENV=production`, Express sirve únicamente `dist/public` y se niega a iniciar si falta la compilación. Instala las dependencias de desarrollo en la etapa de compilación para disponer de los minificadores.

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

Para probar los recursos minificados localmente sin activar las cookies seguras exclusivas de producción, usa:

```powershell
npm run build
$env:FRONTEND_ASSET_MODE = 'production'
npm start
```

En un despliegue real, sirve la aplicación por HTTPS (directamente o mediante un proxy TLS) antes de habilitar `NODE_ENV=production`.

El agrupado reduce los recursos separados que aparecen en DevTools y la minificación dificulta leer el código, pero no oculta el HTML/CSS/JavaScript que el navegador necesita ni impide modificaciones locales en DevTools. La autenticación, validación y permisos deben mantenerse en el servidor.

### Estructura del frontend

`public/index.html` contiene el shell común y carga las vistas desde `public/pages/` antes de iniciar `public/app.js`. Cada pantalla tiene un fragmento HTML propio; los modales compartidos están en `public/pages/modals.html`, los estilos comunes en `public/Style.css` y los estilos específicos en `public/styles/`.

### App móvil con Expo Go

La app nativa está en `mobile/` y consume la misma API y base de datos. Para abrirla en un iPhone o Android:

1. Inicia el backend con `npm start` y averigua la IPv4 local de la computadora con `ipconfig`.
2. Conecta el teléfono y la computadora a la misma red Wi-Fi.
3. Desde PowerShell ejecuta:

   ```powershell
   Set-Location mobile
   npm install
   npx expo start --lan
   ```

4. Escanea el QR desde Expo Go en el teléfono.
5. En el primer inicio, escribe la dirección del servidor con el formato `http://IP-DE-LA-PC:3000` y luego inicia sesión con tu usuario habitual.

No uses `localhost` como dirección del servidor en el teléfono: eso apuntaría al propio teléfono. Si la conexión no responde, permite el puerto del backend en el firewall de Windows y confirma que la IP no haya cambiado. Para acceso fuera de la red local, despliega la API con HTTPS antes de configurar esa URL.

La app móvil incluye dashboard, ventas, comprobantes, clientes, productos, compras, reportes y usuarios. Los módulos y acciones disponibles siguen dependiendo de los permisos aplicados por el backend. Los adjuntos de documentos de compra y las funciones de impresión/exportación todavía se realizan desde la versión web.

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

Las pruebas usan SQLite en memoria y no escriben en `facturacion.db`. `npm run typecheck` ejecuta el chequeo TypeScript de la app móvil Expo.

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

Para restaurar una copia externa cifrada, configura `BACKUP_ENCRYPTION_KEY` y pasa su archivo `.db.enc`:

```powershell
npm run db:restore -- /mnt/facturapro-offsite/facturacion-<fecha>.db.enc
```

El respaldo se verifica con `quick_check`. Las rutas relativas de `DB_PATH` y `BACKUP_DIR` se resuelven desde el directorio del proyecto, incluso al ejecutar un comando programado desde otra carpeta. Antes de restaurar, detén el servidor; si ya existe una base en el destino, el comando conserva una copia previa junto a ella. Las pruebas automáticas verifican respaldo, restauración e integridad usando archivos temporales.

Cuando `BACKUP_OFFSITE_DIR` está configurado, cada ejecución crea una segunda copia cifrada con AES-256-GCM y verifica que se pueda descifrar y abrir. `BACKUP_ENCRYPTION_KEY` debe ser una clave hexadecimal de 32 bytes, distinta de `SESSION_SECRET`; si se pierde, no será posible restaurar las copias externas. Guárdala en un gestor de secretos o en una copia de recuperación protegida, nunca junto con los respaldos. El directorio externo debe existir y, en Linux, estar montado en un sistema de archivos distinto; el script falla explícitamente si el montaje no está disponible. Las copias automáticas generadas se conservan durante `BACKUP_RETENTION_DAYS`; otros archivos y las copias de recuperación de una restauración no se borran. No uses solo otra carpeta del mismo disco como copia externa.

### Programar respaldos

Programa `npm run db:backup` diariamente con el usuario del sistema operativo que tenga acceso al proyecto y a `.env`. Por ejemplo, en Windows PowerShell, desde la carpeta del proyecto:

```powershell
$project = (Get-Location).Path
$action = New-ScheduledTaskAction -Execute "$env:ComSpec" -Argument "/c npm run db:backup" -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
Register-ScheduledTask -TaskName "SistemaFacturacionBackup" -Action $action -Trigger $trigger -Description "Respaldo diario de SQLite"
```

En el servidor Linux, define las rutas en `.env`, monta primero el almacenamiento externo y comprueba manualmente que `npm run db:backup` termine mostrando ambas copias verificadas. Después agrega una entrada de `cron` con la ruta absoluta al proyecto y el usuario del servicio (ajusta las rutas):

```cron
0 2 * * * cd /opt/facturapro && /usr/bin/npm run db:backup >> /var/log/facturapro-backup.log 2>&1
```

Comprueba el log de cada ejecución y configura una alerta si el comando falla. Para ensayar recuperación al menos mensualmente: detén el servidor, restaura una copia reciente con `npm run db:restore -- <archivo>`, confirma el mensaje de éxito, inicia el servidor y verifica `GET /api/health` y los datos esperados. Haz el primer ensayo en una copia aislada, no sobre la base real.

## Despliegue y operación

1. Instala Node.js y npm en un servidor con disco persistente; crea un usuario de servicio sin privilegios y clona el proyecto en una carpeta controlada.
2. Ejecuta `npm install`, crea `.env` desde `.env.example`, establece un `SESSION_SECRET` aleatorio (mínimo 32 bytes en producción) y define rutas persistentes para `DB_PATH`, `BACKUP_DIR` y el volumen montado en `BACKUP_OFFSITE_DIR`.
3. Ejecuta `npm run admin:create` una sola vez para crear el administrador inicial. No incluyas la contraseña en comandos o logs.
4. Ejecuta `npm test` y `npm run build`; configura `NODE_ENV=production`, `HOST=127.0.0.1` y `TRUST_PROXY_HOPS=1` si hay un único Nginx inverso local. Usa HTTPS en Nginx, redirige HTTP a HTTPS y limita el firewall para que el puerto de Node solo acepte conexiones locales.
5. Ejecuta Node con `systemd` u otro supervisor y restringe permisos de `.env`, la base y los respaldos al usuario del servicio.
6. Programa respaldos diarios y revisa su resultado. Antes de actualizar, crea un respaldo, detén el proceso, actualiza dependencias con `npm install`, ejecuta pruebas y vuelve a iniciar.

No publiques el puerto de Node directamente en Internet. El proxy debe reenviar `Host`, `X-Forwarded-For` y `X-Forwarded-Proto`; configura `TRUST_PROXY_HOPS` solo para los proxies bajo tu control. La aplicación activa cookies `Secure` en `NODE_ENV=production` y rechaza iniciar producción sin un secreto de sesión fuerte, una base persistente y un directorio externo configurado.

Helmet aplica una política de seguridad de contenido que limita recursos al mismo origen y evita marcos/objetos; se mantienen scripts y estilos inline porque el frontend actual todavía los utiliza. Para eliminar por completo esa excepción y endurecer CSP, primero habría que migrar esos bloques y manejadores inline a scripts externos o nonces.

Ejemplo de rutas para `.env` en Linux (ajústalas al volumen real; no copies el secreto de ejemplo):

```dotenv
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TRUST_PROXY_HOPS=1
LOGIN_RATE_LIMIT=5
DB_PATH=/var/lib/facturapro/facturacion.db
BACKUP_DIR=/var/backups/facturapro
BACKUP_OFFSITE_DIR=/mnt/facturapro-offsite
BACKUP_RETENTION_DAYS=30
```

Genera `SESSION_SECRET` con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` y una clave diferente para `BACKUP_ENCRYPTION_KEY` con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; guárdalas en `.env` y protege la clave de cifrado en otro lugar seguro. Asegúrate de que `/mnt/facturapro-offsite` ya esté montado desde almacenamiento separado antes de correr la tarea. Limita permisos, por ejemplo `chmod 600 .env`, y concede escritura de la base y los respaldos únicamente al usuario del servicio.

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

## Documentación técnica y funcional

### Alcance del sistema

FacturaPro es una aplicación web interna de gestión comercial. El frontend está construido con HTML, CSS y JavaScript sin framework; el backend es una API REST de Node.js y Express, y la persistencia se realiza en SQLite mediante `better-sqlite3`. La interfaz y la API se sirven desde el mismo origen. Los importes se manejan en soles (PEN), salvo que una compra se registre en USD y se convierta usando el tipo de cambio disponible.

El sistema cubre:

- Inicio de sesión con cuentas locales, sesiones por cookie y permisos asignados por rol.
- Clientes y búsqueda opcional de datos de DNI/RUC mediante Decolecta.
- Catálogo de productos, categorías, precios diferenciados, alertas y niveles de inventario.
- Ventas, facturas, boletas, notas de pedido, guías de remisión, cotizaciones, devoluciones y notas de crédito.
- Pagos parciales y cuentas por cobrar; compras a proveedores, abonos y cuentas por pagar.
- Almacenes, movimientos de stock y consulta del kardex.
- Dashboard, reportes de ventas/IGV/inventario/compras y exportaciones Excel.
- Impresión de comprobantes en PDF y generación/verificación de respaldos de la base SQLite.

La configuración de conexión a entornos Beta/Homologación de SUNAT está presente, pero el envío, la firma electrónica y el ciclo de respuesta CDR no están implementados. El sistema no debe considerarse un emisor electrónico de producción.

### Componentes del repositorio

| Ruta | Responsabilidad |
| --- | --- |
| `server.js` | Configuración Express, sesiones, cabeceras, rutas API, recursos estáticos y manejo de errores. |
| `database.js` | Apertura de SQLite, creación/evolución idempotente del esquema y series iniciales. |
| `routes/` | Controladores HTTP de autenticación, clientes, productos, ventas/documentos, inventario, compras, proveedores, reportes, PDF y tipo de cambio. |
| `services/` | Reglas de dominio para emitir/actualizar comprobantes, consultar DNI/RUC y configurar los modos de prueba SUNAT. |
| `middleware/permisos.js` | Roles, catálogo de permisos y middleware de autorización en el servidor. |
| `public/index.html` | Shell de la interfaz; carga los fragmentos HTML y estilos antes de iniciar la aplicación. |
| `public/pages/` | Vistas Dashboard, Ventas, Comprobantes, Clientes, Productos, Compras, Reportes, Usuarios y modales. |
| `public/app.js`, `public/Script.js`, `public/Style.css`, `public/styles/` | Lógica de interfaz, utilidades y estilos comunes/específicos. |
| `scripts/` | Creación de administrador, importación de productos, compilación de recursos y operaciones de respaldo/restauración. |
| `services/`, `test/` | Lógica compartida y pruebas automatizadas con Node Test Runner. |
| `uploads/compras/` | Archivos adjuntos de facturas y guías de compras. |
| `dist/public/` | Recursos agrupados/minificados generados por `npm run build`; no editar manualmente. |

### Módulos de la interfaz

| Módulo | Uso principal |
| --- | --- |
| Dashboard | Indicadores generales, ventas, productos/clientes y alertas de stock. |
| Ventas | Crear comprobantes a partir del catálogo y cliente, definir pago/condiciones y registrar los documentos relacionados. |
| Comprobantes | Buscar/listar comprobantes, consultar su detalle, registrar cobros permitidos y gestionar transiciones de estado autorizadas. |
| Clientes | Crear, consultar, buscar, editar y eliminar clientes; la consulta de documento es opcional. |
| Productos | Mantener catálogo, datos de identificación, precios, stock, categoría y estado activo. |
| Compras | Mantener proveedores, registrar documentos y adjuntos de recepción, incluir líneas de productos y pagos. |
| Reportes | Consultar estadísticas, cuentas por cobrar/pagar y descargar reportes disponibles en Excel. |
| Usuarios | Alta/listado/eliminación de usuarios y asignación de permisos; acceso administrativo. |

### Configuración de entorno

Las variables se cargan desde `.env` con `dotenv`. La plantilla completa está en `.env.example`; conserva los secretos solo en el entorno local o en el gestor de secretos del despliegue.

| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto HTTP; predeterminado `3000`. |
| `HOST` | Interfaz de escucha; en producción solo loopback (`127.0.0.1` o `::1`). |
| `NODE_ENV` | Entorno de ejecución. Con `production`, se sirven recursos compilados y se marcan las cookies como seguras. |
| `FRONTEND_ASSET_MODE` | Si vale `production`, sirve `dist/public` aunque `NODE_ENV` no sea producción. |
| `SESSION_SECRET` | Obligatorio; secreto aleatorio de firma de sesiones (mínimo 32 bytes en producción). |
| `DB_PATH` | Ruta de SQLite, absoluta o relativa al proyecto; predeterminada `facturacion.db`. `:memory:` se usa en pruebas. |
| `TRUST_PROXY_HOPS` | Cantidad exacta de proxies inversos confiables; `1` para un Nginx local, `0` si no hay proxy. |
| `LOGIN_RATE_LIMIT` | Intentos fallidos por IP cada 15 minutos; predeterminado `5`. |
| `BACKUP_DIR` | Directorio de respaldos, absoluto o relativo al proyecto; predeterminado `backups`. |
| `BACKUP_OFFSITE_DIR` | Directorio separado y montado para la segunda copia cifrada; obligatorio en producción. |
| `BACKUP_ENCRYPTION_KEY` | Clave hex de 32 bytes para AES-256-GCM; obligatoria en producción y para restaurar `.db.enc`. |
| `BACKUP_RETENTION_DAYS` | Días de retención de respaldos automáticos; predeterminado `30`. |
| `CORS_ORIGIN` | Lista separada por comas de orígenes permitidos cuando frontend y API están separados; vacío para mismo origen. |
| `CHROME_EXECUTABLE_PATH` | Ruta opcional al ejecutable local de Chrome/Chromium para PDFs. |
| `DECOLECTA_API_TOKEN` | Token de servidor para la consulta externa de DNI/RUC; opcional. |
| `SUNAT_MODE` | `disabled` (predeterminado), `beta` u `homologation`. No existe modo de producción. |
| `SUNAT_RUC` | RUC de 11 dígitos requerido si se habilita un entorno de prueba SUNAT. |
| `SUNAT_SOL_USER`, `SUNAT_SOL_PASSWORD` | Usuario secundario y contraseña SOL requeridos solo para `homologation`; nunca para Beta. |

### API REST

Todas las rutas tienen el prefijo `/api`. Salvo `/api/health` y las rutas de autenticación indicadas, requieren una sesión iniciada. Las rutas de negocio verifican además permisos en el backend. Las solicitudes JSON deben enviarse con `Content-Type: application/json`; las compras con adjuntos usan `multipart/form-data`. La mayoría de respuestas usa `{ "ok": true, "data": ... }`; algunas operaciones devuelven `id`, `mensaje`, `total`, `periodo` o `resumen` al mismo nivel. Los errores usan `{ "ok": false, "error": "..." }` (algunas respuestas de inventario usan `message`).

#### Disponibilidad y sesión — `/api`

| Método y ruta | Acceso | Descripción |
| --- | --- | --- |
| `GET /health` | Público | Comprueba la conexión SQLite; responde `503` si no está disponible. |
| `POST /auth/login` | Público | Recibe `email` y `password`; inicia sesión si las credenciales coinciden. Limitado por IP/ventana de 15 minutos. |
| `POST /auth/logout` | Sesión | Destruye la sesión y limpia la cookie. |
| `GET /auth/me` | Sesión | Devuelve el usuario y permisos de la sesión actual. |
| `PUT /auth/perfil` | Sesión | Actualiza nombre/correo y, opcionalmente, contraseña/avatar del usuario actual. |
| `PUT /auth/cambiar-password` | Sesión | Recibe `password_actual` y `password_nuevo`. |
| `GET /auth/usuarios` | Administrador | Lista usuarios sin exponer hashes de contraseñas. |
| `GET /auth/usuarios/permisos` | Administrador | Devuelve los grupos de permisos y permisos iniciales del vendedor. |
| `POST /auth/usuarios` | Administrador | Crea usuario; recibe `nombre`, `email`, `password`, `rol` y permisos opcionales. |
| `DELETE /auth/usuarios/:id` | Administrador | Elimina un usuario; no permite eliminarse a sí mismo ni al último administrador. |

#### Clientes, catálogo y tipo de cambio

| Método y ruta | Permiso | Descripción / parámetros |
| --- | --- | --- |
| `GET /clientes` | `clientes:ver` | Lista clientes. |
| `GET /clientes/:id` | `clientes:ver` | Obtiene un cliente. |
| `GET /clientes/buscar/:texto` | `clientes:ver` | Busca por nombre, documento o correo. |
| `GET /clientes/consultar-documento/:numero` | `clientes:ver` | Consulta DNI (8 dígitos) o RUC (11) con proveedor externo; 30 solicitudes por IP cada 15 minutos. |
| `POST /clientes` | `clientes:crear` | Crea cliente. `tipo_documento`: `DNI`, `RUC` o `CE` (predeterminado `DNI`). |
| `PUT /clientes/:id` | `clientes:editar` | Actualiza datos de cliente. |
| `DELETE /clientes/:id` | `clientes:eliminar` | Elimina cliente si no hay una restricción referencial que lo impida. |
| `GET /productos` | `productos:ver` | Lista con filtros opcionales `search`, `categoria`, `activo`, `limit` (máx. 200), `offset`, `sort` y `order`. |
| `GET /productos/:id` | `productos:ver` | Obtiene producto por ID. |
| `GET /productos/buscar/:texto` | `productos:ver` | Búsqueda del catálogo. |
| `GET /productos/alertas/stock-bajo` | `productos:ver` | Lista productos bajo su mínimo o el umbral predeterminado. |
| `GET /productos/categorias/lista` | `productos:ver` | Lista categorías disponibles. |
| `POST /productos` | `productos:crear` | Crea producto; datos de catálogo, códigos, precios, costo, stock y umbrales. |
| `PUT /productos/:id` | `productos:editar` | Reemplaza/actualiza los datos de catálogo del producto. |
| `PATCH /productos/:id/stock` | `productos:ajustar_stock` | Ajusta stock mediante la operación habilitada por el servidor. |
| `DELETE /productos/:id` | `productos:eliminar` | Elimina producto cuando sus relaciones lo permiten. |
| `GET /tipo-cambio` | `compras:ver` | Obtiene el cambio diario de compra/venta; `?actualizar=1` solicita renovación. Si falla el proveedor externo, intenta devolver el último valor guardado. |

Los campos de producto incluyen nombre, descripción, códigos interno/SKU/barras, marca, categoría, unidad, precios de venta Unidad/Rebaja/Pase, costo, stock mínimo/máximo, imagen, activo, IGV, ubicación y proveedor principal. Los nombres concretos de campos de escritura se validan en el backend; para los detalles vigentes, revisar `routes/productos.js`.

#### Comprobantes y PDF

| Método y ruta | Permiso | Descripción / parámetros |
| --- | --- | --- |
| `GET /comprobantes` | `comprobantes:ver` | Lista; filtros `tipo`, `fecha_desde`, `fecha_hasta`. Incluye cobrado y saldo pendiente. |
| `GET /comprobantes/meta/tipos` | `comprobantes:ver` | Tipos, series, numeración actual y metadatos de IGV/stock. |
| `GET /comprobantes/:id` | `comprobantes:ver` | Detalle, cliente, referencias, cobros y saldo. |
| `POST /comprobantes` | Permiso según tipo | Emite comprobante. Tipos: `factura`, `boleta`, `nota_pedido`, `guia_remision`, `cotizacion`, `nota_devolucion`, `nota_credito_f`, `nota_credito_b`. |
| `POST /comprobantes/:id/pagos` | `comprobantes:pagar` | Registra un cobro parcial de factura/boleta a crédito (`monto`, `fecha_pago`, `metodo_pago`, `referencia`). |
| `PATCH /comprobantes/:id/estado` | Según transición | Recibe `estado`; la autorización y estados destino dependen del tipo. |
| `GET /pdf/:id` | `comprobantes:ver` | Descarga PDF del comprobante; `formato=a4`, `80mm` o `58mm` (predeterminado A4). |

Una solicitud de comprobante contiene `tipo`, `cliente_id`, `items` y, cuando corresponda, `condicion_pago` (`no_afecta`, `contado`, `credito`), `fecha_vencimiento`, descuento general, referencia/motivo de ajuste y campos de transporte de guía. Cada línea usa `producto_id`, cantidad, unidad, `tipo_precio` (`unidad`, `rebaja` o `pase`) y descuento. Las guías permiten descripción libre. El backend deriva el precio del catálogo y calcula totales/IGV; los precios recibidos desde el cliente no sustituyen los precios del catálogo.

| Tipo | Serie inicial | Comportamiento principal |
| --- | --- | --- |
| `factura`, `boleta` | `F001`, `B001` | Venta con IGV y reducción de stock; puede ser contado o crédito. |
| `nota_pedido` | `NP01` | Documento operativo; no calcula IGV ni mueve stock. |
| `guia_remision` | `GR01` | Traslado/documento logístico; permite descripción libre y no mueve stock. |
| `cotizacion` | `COT1` | Oferta con estados borrador/enviado/aprobado/rechazado; no mueve stock. |
| `nota_devolucion` | `ND01` | Ajuste vinculado a venta del mismo cliente; devuelve stock conforme a lo permitido. |
| `nota_credito_f`, `nota_credito_b` | `NCF1`, `NCB1` | Ajuste vinculado a factura/boleta; no mueve stock. |

Las series se almacenan en la tabla `series` y se inicializan al abrir la base si aún no existen. Los importes se calculan con redondeo a centavos; la emisión, la reserva del número, los cambios de stock y las transiciones protegidas se procesan con transacciones SQLite.

#### Compras, proveedores e inventario

| Método y ruta | Permiso | Descripción / parámetros |
| --- | --- | --- |
| `GET /compras` | `compras:ver` | Historial con filtros `buscar`, `condicion_pago`, `estado`, `desde`, `hasta`; incluye productos, archivos, pagos e importes estimados. |
| `POST /compras` | `compras:crear` | Registra documento de proveedor; acepta líneas `items` y opcionalmente `archivo_factura`/`archivo_guia` como PDF/JPEG/PNG (máx. 10 MiB por archivo). |
| `PATCH /compras/:id/pago` | `compras:crear` | Registra el pago completo de una compra a crédito. |
| `POST /compras/:id/pagos` | `compras:crear` | Registra abono de compra a crédito. |
| `GET /compras/:id/archivo` | `compras:ver` | Descarga un archivo asociado a la compra. |
| `GET /proveedores` | `compras:ver` | Lista/busca; `buscar` filtra razón social/documento y `incluir_inactivos=true` incluye inactivos. |
| `POST /proveedores` | `compras:crear` | Crea proveedor (documento único y razón social obligatorios). |
| `PUT /proveedores/:id` | `compras:crear` | Actualiza datos del proveedor. |
| `PATCH /proveedores/:id/estado` | `compras:crear` | Cambia `activo` (booleano). |
| `GET /inventario/almacenes` | `inventario:ver` | Lista almacenes activos. |
| `POST /inventario/almacenes` | `inventario:gestionar` | Crea almacén con `nombre`, `codigo` y tipo opcional. |
| `GET /inventario/kardex` | `inventario:ver` | Lista movimientos; admite `producto_id`, `almacen_id`, `tipo`, `desde`, `hasta`. |
| `GET /inventario/resumen` | `inventario:ver` | Devuelve stock/valor agregado, alertas y totales por almacén. |
| `POST /inventario/movimientos` | `inventario:gestionar` | Registra entrada/salida/ajuste/transferencia según los campos validados por la ruta. |

Los tipos kardex documentados son `ENTRADA`, `SALIDA`, `VENTA`, `COMPRA`, `DEVOLUCION`, `AJUSTE` y `TRANSFERENCIA`. Las fechas de filtro son inclusivas y deben tener formato `YYYY-MM-DD`. Una recepción de compra puede afectar existencias y costos dentro de la misma transacción; las compras sin recepción de stock también están contempladas.

#### Reportes

Todas las rutas de `/reportes` requieren `reportes:ver`.

| Método y ruta | Descripción |
| --- | --- |
| `GET /reportes/resumen` | Resumen de clientes, productos, ventas, alertas y crédito por cobrar. |
| `GET /reportes/alertas-stock` | Productos bajo el stock mínimo (o cinco unidades por defecto). |
| `GET /reportes/ventas-por-dia` | Ventas agrupadas por día de los últimos 30 días. |
| `GET /reportes/ventas-por-mes` | Ventas agrupadas por mes de los últimos 12 meses. |
| `GET /reportes/productos-mas-vendidos` | Diez productos con más unidades vendidas e ingresos. |
| `GET /reportes/mejores-clientes` | Diez clientes con mayor importe de ventas. |
| `GET /reportes/ventas-por-categoria` | Unidades e ingresos agrupados por categoría. |
| `GET /reportes/facturas-por-estado` | Cantidad e importe de facturas/boletas por estado. |
| `GET /reportes/igv-mes` | Base imponible, IGV y total del mes en curso. |
| `GET /reportes/comprobantes-por-tipo` | Cantidad e importe por tipo de comprobante no anulado. |
| `GET /reportes/creditos-pendientes` | Créditos de venta pendientes/parciales, saldos y vencimiento. |
| `GET /reportes/cuentas-por-cobrar?desde=...&hasta=...` | Detalle, totales y agrupación por cliente del rango inclusivo obligatorio. |
| `GET /reportes/cuentas-por-cobrar/exportar?desde=...&hasta=...` | Excel con cuentas por cobrar y resumen por cliente. |
| `GET /reportes/compras?desde=...&hasta=...` | Resumen de compras agrupado por proveedor y producto; rango obligatorio. |
| `GET /reportes/compras/exportar?desde=...&hasta=...` | Excel con hojas Recepciones y Cuentas por pagar. |
| `GET /reportes/cuentas-por-pagar?desde=...&hasta=...` | Compras a crédito, pagos y saldo estimado del periodo. |
| `GET /reportes/rango` | Reporte agregado para el rango indicado por los parámetros de fecha validados por la ruta. |

Los reportes consideran las ventas reales (facturas/boletas) y excluyen comprobantes anulados en los agregados de ventas. Las notas de crédito y devoluciones son tipos de reversa en el dominio; el tratamiento específico de cada agregado depende de su consulta.

### Autenticación, permisos y sesiones

El login normaliza el correo y verifica la contraseña con bcrypt. Express Session mantiene la identidad en una cookie `connect.sid` con `httpOnly`, `sameSite=lax` y duración de ocho horas. En `NODE_ENV=production`, la cookie `secure` exige HTTPS. El login regenera el identificador de sesión para evitar reutilización; la API exige sesión para todo el negocio y responde `401` sin ella, o `403` si el usuario no tiene permiso.

El rol `admin` conserva acceso total (`*`). El rol `vendedor` recibe permisos iniciales configurables por administrador; estos permisos se verifican siempre en el backend, no solo ocultando controles en la interfaz. Los permisos cubren clientes, productos, comprobantes, compras/inventario y reportes. Las funciones de usuario administrativo solo están disponibles a administradores. La creación y cambio de contraseña requiere al menos 12 caracteres.

### Modelo de datos

SQLite crea el esquema al iniciar y aplica migraciones incrementales condicionales para columnas nuevas, sin borrar las tablas existentes.

| Tabla | Contenido / relación principal |
| --- | --- |
| `usuarios` | Cuenta, correo único, hash bcrypt, rol, permisos serializados y avatar. |
| `clientes` | Identidad/documento y datos de contacto de clientes. |
| `productos` | Catálogo, precios, costo, stock y atributos de inventario. |
| `series` | Tipo de comprobante, serie vigente y último correlativo. |
| `comprobantes` | Cabecera unificada, cliente, tipo/serie/número, pago, IGV, estado y referencia a documento previo. |
| `detalle_comprobante` | Líneas y precios/descuentos asociados a un comprobante y producto (o descripción libre). |
| `pagos_comprobante` | Abonos/cobros de comprobantes, fecha, método, referencia y usuario registrador. |
| `almacenes` | Ubicaciones/códigos de almacén con estado activo. |
| `kardex_movimientos` | Movimiento, cantidad, costo, stock anterior/posterior, documento y usuario. |
| `proveedores` | Catálogo de proveedor; documento único, contactos y estado. |
| `documentos_compra` | Cabeceras de compras, snapshot de datos del proveedor, moneda, pago y metadatos de adjuntos. |
| `detalle_documento_compra` | Productos, cantidades, costos y almacén por documento de compra. |
| `pagos_documento_compra` | Pagos/abonos relacionados a compras. |
| `tipo_cambio_diario` | Tasas de compra/venta por fecha y fuente del valor. |

Los registros de compra conservan el nombre/documento/dirección del proveedor como snapshot para no alterar el historial al editar el catálogo de proveedores. Los archivos se guardan en disco y la base conserva sus metadatos/rutas. No se deben borrar o mover manualmente esos archivos mientras existan compras que los referencien.

### Integraciones y límites funcionales

- **Decolecta:** la consulta de identidad se ejecuta desde el backend, usa el token `DECOLECTA_API_TOKEN`, tiene timeout de 8 segundos y un límite propio de 30 solicitudes por IP cada 15 minutos. Si el proveedor no está configurado o no responde, la creación manual de clientes sigue disponible.
- **Tipo de cambio:** consulta el servicio externo de tipo de cambio SUNAT y almacena la tasa del día; si la consulta falla, puede reutilizar la última tasa guardada. No reemplaza una tasa contable aprobada por el negocio.
- **SUNAT:** solo configuración para pruebas `beta` y `homologation`. No implementar uso real antes de incorporar XML, firma con certificado, envío, respuesta CDR, pruebas integrales y definición de un PSE autorizado.
- **PDF:** Puppeteer genera A4 o ticket térmico de 80/58 mm. Windows usa Chrome local (configurable con `CHROME_EXECUTABLE_PATH`); Linux puede usar Chromium de Sparticuz.
- **Excel:** los reportes disponibles se generan con la biblioteca `xlsx`.
- **Almacenamiento de sesiones:** las sesiones se guardan en la misma base SQLite persistente, expiran a las ocho horas y se eliminan al cerrar sesión. Mantén una sola instancia de Node mientras SQLite sea la base de datos; SQLite en disco local no está pensado para varias instancias distribuidas.

### Comandos para desarrollo y mantenimiento

| Comando | Uso |
| --- | --- |
| `npm start` | Inicia `server.js`. |
| `npm run admin:create` | Crea el primer administrador o permite restablecer una cuenta administradora existente mediante preguntas en consola. |
| `npm run build` | Agrupa y minifica frontend en `dist/public`. |
| `npm test` | Ejecuta todas las pruebas con `node --test`. |
| `npm run typecheck` | Comprueba los tipos de la app móvil sin emitir archivos. |
| `npm run db:backup` | Crea y verifica respaldo en `BACKUP_DIR`. |
| `npm run db:restore -- <archivo>` | Verifica e instala un respaldo; conserva una copia previa si ya existe base destino. |
| `node scripts/import-productos.js <archivo.xls>` | Importa catálogo desde XLS según las columnas descritas en esta guía. |

### Consideraciones operativas y de seguridad

- Mantén `SESSION_SECRET`, credenciales SOL y token Decolecta fuera del repositorio y de los logs; usa HTTPS en producción.
- No compartas la base SQLite entre instancias concurrentes ni la pongas en un filesystem de red sin validar sus garantías de bloqueo. Usa un único proceso de escritura; evalúa PostgreSQL solo si concurrencia/disponibilidad medida lo requiere.
- Protege la carpeta `uploads/compras/` y los respaldos como datos comerciales; limita el acceso del sistema operativo y conserva copias fuera del equipo de producción.
- El límite de adjuntos es 10 MiB por archivo y el MIME admitido se restringe a PDF, JPEG y PNG. Valida políticas adicionales de retención/escaneo según el entorno donde se despliegue.
- La aplicación no configura por sí misma proxy TLS, firewall, supervisor de procesos, retención de logs ni estrategia de alta disponibilidad: deben ser parte del despliegue.
- Valida restauraciones y consistencia sobre una copia de datos antes de reemplazar una base activa. No edites directamente la SQLite con el servidor en funcionamiento.