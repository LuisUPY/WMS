# -WMS
Warehouse Management System by Gerardo Escalante

## Inventario online — versión 0.3

Acceso Google con permiso de administrador e inventario compartido mediante Cloud Firestore. Consulta y búsqueda, impresión, entradas y salidas en la unidad de cada material e historial de los últimos 30 movimientos. El saldo y su movimiento se confirman en una transacción. Sesión y caché en memoria, sin datos operativos persistentes en el navegador.

`DB/DataBase.xlsx` es la fuente de la carga inicial. La base central de trabajo será Firestore: editar el Excel después de cargarlo no actualiza automáticamente el sistema, y los movimientos web no reescriben ese archivo.

**Activación pendiente:** aún no hay proyecto Firebase configurado ni datos importados en la nube. El usuario solicitó dejar el saldo inicial pendiente de validación; se importa en estado `draft` y las reglas impiden movimientos hasta su aprobación posterior. No existe acceso de demostración en la aplicación.

Instalar dependencias con `pnpm install --frozen-lockfile` (o `npm install`). Se necesita Node.js 20 o superior, Python 3 para leer el archivo y Java 21 o superior para el emulador. La lectura usa únicamente la biblioteca estándar de Python.

- `npm run dev`: vista local en `http://localhost:4173`.
- `npm test`: pruebas de acceso, cantidades, búsqueda, importación y lector del Excel.
- `npm run inventory:check`: validación local del Excel; no modifica archivos ni la nube.
- `npm run inventory:import -- --project ID_PROYECTO`: carga inicial desde un entorno administrativo con credenciales del responsable. No ejecutarla hasta configurar y verificar el proyecto de destino.
- `npm run test:firestore`: pruebas locales de permisos, transacciones y concurrencia. Usa un proyecto `demo-`, sin datos de producción.
- `npm run test:browser`: pruebas de interfaz con Playwright y Chromium disponibles, mientras se ejecuta el servidor local.
- [Activación de Firebase y publicación](docs/LOGIN_SETUP.md).
- [Integración del inventario, estructura y pasos de activación](docs/INVENTORY_SETUP.md).

La primera cuenta administradora está definida en `config/access-policy.json`, una configuración local excluida de Git y de la publicación. La conexión del proyecto Firebase y la asignación del permiso en ese proyecto siguen pendientes. `npm run auth:status` muestra el estado de preparación. El workflow de Pages publica únicamente `public/`.

## Versiones

La versión inicial visible es **0.1**. Cada actualización del sistema incrementa la versión en **0.1**: 0.1 → 0.2 → 0.3. La versión cambia una vez por actualización entregada, junto con su entrada en [CHANGELOG.md](CHANGELOG.md).

Mantener sincronizados el pie de `public/index.html` y `package.json`: la versión visible 0.3 corresponde a 0.3.0 en el paquete. La versión actual es 0.3, y la próxima actualización será 0.4.
