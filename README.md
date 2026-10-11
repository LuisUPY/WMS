# -WMS
Warehouse Management System by Gerardo Escalante

## Inventario online — versión 0.7

Acceso Google con permiso de administrador e inventario compartido mediante Cloud Firestore. Consulta y búsqueda, impresión, entradas y salidas en la unidad de cada material e historial de los últimos 30 movimientos. Los saldos y el movimiento completo se confirman en una transacción. Sesión y caché en memoria, sin datos operativos persistentes en el navegador.

La tabla se ordena por descripción. Registrar movimiento permite incluir de uno a cinco productos distintos, con una referencia común y una operación por producto: Entrada, Salida o Cambiar desglose. CS CARTONES, CAR PAQUETES y CXT se corrigen desde ese formulario; estas correcciones no alteran el saldo total. UMR y S. Loc. Ubicación conservan sus diálogos de referencia visible. Todo el movimiento se confirma junto, con un folio y un historial desplegable; si falla una línea, no se guarda ninguna. Los cambios confirmados se comparten entre sesiones.

`DB/DataBase.xlsx` es la fuente de la carga inicial. La base central de trabajo será Firestore: editar el Excel después de cargarlo no actualiza automáticamente el sistema, y los movimientos web no reescriben ese archivo.

**Apertura operativa:** la carga inicial queda en `draft` y los movimientos se habilitan con una aprobación administrativa completa. La versión 0.4 añade revisión de cantidades y origen, corte real, responsable, evidencia y auditoría. El estado real de cada instalación se comprueba por lectura; la presencia del código no acredita su activación. No existe acceso de demostración en la aplicación.

Instalar dependencias con `pnpm install --frozen-lockfile` (o `npm install`). Se necesita Node.js 20 o superior, Python 3 para leer el archivo y Java 21 o superior para el emulador. La lectura usa únicamente la biblioteca estándar de Python.

- `npm run dev`: vista local en `http://localhost:4173`.
- `npm test`: pruebas de acceso, cantidades, búsqueda, importación y lector del Excel.
- `npm run inventory:check`: validación local del Excel; no modifica archivos ni la nube.
- `npm run inventory:import -- --project ID_PROYECTO`: carga inicial desde un entorno administrativo con credenciales del responsable. No ejecutarla hasta configurar y verificar el proyecto de destino.
- `npm run inventory:approval -- --project ID_PROYECTO`: vista previa de solo lectura de la apertura; [procedimiento de aprobación](docs/OPENING_APPROVAL.md).
- `npm run test:firestore`: pruebas locales de permisos, transacciones y concurrencia. Usa un proyecto `demo-`, sin datos de producción.
- `npm run test:browser`: pruebas de interfaz con Playwright y Chromium disponibles, mientras se ejecuta el servidor local.
- [Activación de Firebase y publicación](docs/LOGIN_SETUP.md).
- [Integración del inventario, estructura y pasos de activación](docs/INVENTORY_SETUP.md).

La primera cuenta administradora está definida en `config/access-policy.json`, una configuración local excluida de Git y de la publicación. `npm run auth:status` muestra la preparación local, sin acreditar permisos remotos. El workflow de Pages publica únicamente `public/`.

## Versiones

La versión inicial visible es **0.1**. Cada actualización del sistema incrementa la versión en **0.1**: 0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6 → 0.7. La versión cambia una vez por actualización entregada, junto con su entrada en [CHANGELOG.md](CHANGELOG.md).

Mantener sincronizados el pie de `public/index.html`, `package.json` y las referencias de recursos web `?v=0.7`. La versión visible 0.7 corresponde a 0.7.0 en el paquete. La próxima actualización será 0.8.
