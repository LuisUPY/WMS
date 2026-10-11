# Integración de inventario WMS 0.3

Esta guía cubre la activación del acceso y del inventario compartido. El usuario eligió mantener el saldo de apertura pendiente de validación; ese estado permite la consulta y bloquea los movimientos. El estado de preparación local se consulta con `npm run auth:status`.

## Abrir WMS para ver el avance

En la terminal de este equipo:

```sh
cd /Users/jerry/WMS
npm run dev
```

Mantener esa terminal abierta y entrar en [http://localhost:4173](http://localhost:4173) desde el navegador. Si el servidor ya está funcionando, basta con abrir esa dirección.

Abrir `public/index.html` con doble clic utiliza `file://`, que no permite el funcionamiento previsto de los módulos y del acceso Google. Se debe usar la dirección del servidor.

Iniciar sesión con la cuenta autorizada. Después de importar el inventario, el estado «Saldo inicial pendiente de validación» permite consultar, buscar e imprimir los materiales; mantiene bloqueadas las entradas y salidas hasta una aprobación posterior.

## Fuente y unidad de control

`DB/DataBase.xlsx` es la fuente de la carga inicial. El lector toma los valores guardados de `FISICO - A101`, sin abrir Excel, seguir vínculos ni recalcular fórmulas externas. Conserva el libro original.

- C: SKU como identificador de texto. D: descripción. E: almacén. F: saldo inicial. J: unidad de control.
- B: código alterno opcional. G, H e I: desglose guardado de apertura, solo como referencia histórica.
- Clave de inventario: `almacén__SKU`. Se rechazan claves repetidas, celdas con errores, valores ausentes, negativos, unidades fuera de PAC/CAR y cantidades fraccionarias reales.
- Los residuos numéricos de Excel de hasta `0.00000001` respecto de un entero se normalizan. Cada cambio conserva celda, valor guardado y entero importado en `numericNormalizations` para revisión. No se redondean fracciones mayores.
- La fecha de `I1` usa `TODAY()` y no acredita el corte. `sourceAsOf` se conserva como `null` hasta validación.
- Se guarda la huella SHA-256 del archivo y la fila de origen. No se importan macros, enlaces externos ni fórmulas como instrucciones ejecutables.

El libro no incluye factores de conversión independientes ni separa stock libre, calidad y bloqueado. En borrador se muestra **stock total sin clasificación aprobada**, con sumas separadas por unidad. Si el responsable confirma que todo el saldo es utilizable, la apertura 0.4 registra ese alcance y la pantalla lo muestra después de aprobar. No ofrece salidas en otras presentaciones ni recalcula CS/CAR/CXT a partir del saldo vigente.

Firestore será la base central de trabajo. La importación del Excel es un arranque único: los cambios posteriores del archivo no actualizan la web y los movimientos web no reescriben el Excel. Tampoco hay conexión automática con SAP.

## Preparación del proyecto Firebase

1. Crear o seleccionar el proyecto en [Firebase Console](https://console.firebase.google.com/). Registrar una aplicación web y copiar su configuración pública a `public/config.js`. Para obtener el bloque, seguir [la guía oficial de registro web](https://firebase.google.com/docs/web/setup).
2. Habilitar Google en Authentication, configurar los dominios autorizados y asignar `admin: true` a la cuenta aprobada según [LOGIN_SETUP.md](LOGIN_SETUP.md).
3. Crear Cloud Firestore **Standard**, base predeterminada `(default)`, en modo producción. Elegir y confirmar la ubicación con el responsable antes de crearla. No usar reglas abiertas de modo prueba. [Guía oficial de creación](https://firebase.google.com/docs/firestore/quickstart).
4. Desde una terminal de confianza con Firebase CLI autenticado, entrar primero en la carpeta del proyecto, donde están `firebase.json` y `firestore.rules`, y desplegar las reglas al proyecto exacto. En este equipo:

   ```sh
   cd /Users/jerry/WMS
   npx firebase deploy --only firestore:rules --project ID_PROYECTO
   ```

   Sustituir `ID_PROYECTO` por el ID real de Firebase. Si aparece `Not in a Firebase app directory (could not locate firebase.json)`, el comando se está ejecutando fuera de la carpeta WMS; entrar en ella antes de repetirlo. Mantener esa carpeta como directorio de trabajo para los pasos 5 y 6. En otra computadora o Cloud Shell, usar la ruta de la copia local de este repositorio que contenga ambos archivos.

5. Validar el archivo local y revisar su origen y normalizaciones:

   ```sh
   npm run inventory:check
   ```

6. En un entorno con Application Default Credentials del responsable, importar al proyecto confirmado:

   ```sh
   npm run inventory:import -- --project ID_PROYECTO
   ```

La importación crea los materiales y el marcador de origen en una sola transacción. Repetir el mismo archivo no hace cambios. Se rechaza sustituir una fuente existente por otro archivo y se rechazan datos previos sin marcador. Las credenciales administrativas permanecen fuera del navegador, del repositorio y de `public/`.

El importador usa `python3` por defecto. Se puede indicar el ejecutable con `WMS_PYTHON`. La carga inicial admite hasta 400 materiales para mantenerse en una única transacción; una ampliación del alcance necesita revisar esta estrategia.

## Saldo pendiente de validación

La importación fija `settings/inventory.status = "draft"`, `approvalStatus = "pending"` y `sourceAsOf = null`. Se puede consultar e imprimir desde una cuenta autorizada, pero el cliente y las reglas impiden movimientos. La aprobación se realiza exclusivamente con la herramienta administrativa 0.4, según [OPENING_APPROVAL.md](OPENING_APPROVAL.md).

El responsable debe validar corte real, saldos, unidades, normalizaciones y que toda la apertura sea utilizable, además de conciliar cualquier movimiento posterior al corte. Cambiar solo `status` a `active` ya no basta: cliente y reglas exigen el contrato completo y las reglas comprueban la auditoría. La herramienta compara el inventario contra la fuente y contra la huella revisada antes de aprobar en una transacción.

## Estructura de Firestore

- `settings/inventory`: archivo, hoja, huella, fecha de origen, estado, normalizaciones, número de materiales, sumas por unidad y fecha de importación. Escritura exclusiva del entorno administrativo.
- `inventory/{almacén__SKU}`: identidad, unidad, saldo inicial, saldo actual, desglose de apertura, fila de origen, revisión, último movimiento y fecha de cambio.
- `movements/{UUID}`: entrada/salida, material, unidad, cantidad, referencia, saldo antes/después, UID del responsable y fecha del servidor. Inmutable desde los clientes.
- `inventoryApprovals/{huella}`: declaración de aprobación, marcador anterior y copia de los materiales revisados. Solo lectura desde clientes autorizados; creación exclusiva del entorno administrativo.
- `inventoryDetails/{materialId}`: UMR y ubicación visibles, revisión, último cambio y fecha de servidor. Referencias independientes de la unidad y el almacén que controlan el saldo.
- `inventoryDetailChanges/{UUID}`: referencia cambiada, valor anterior/posterior, revisiones, responsable y fecha de servidor. Inmutable desde clientes; su creación exige guardar el cambio de referencia en la misma transacción.

El permiso vigente es únicamente administrador. No se han habilitado roles de encargado o consulta. Se rechazan todos los recursos fuera de las rutas definidas.

## Cambios compartidos y conexión

El cliente usa [suscripciones `onSnapshot`](https://firebase.google.com/docs/firestore/query-data/listen) para inventario, origen, referencias visibles e historial. La misma base entrega los cambios confirmados a las sesiones autorizadas. La pantalla solo marca conexión confirmada cuando todas las consultas proceden del servidor y no tienen escrituras pendientes.

Authentication y la caché de Firestore usan memoria. No se almacenan saldos, sesiones ni formularios en LocalStorage, SessionStorage o IndexedDB. Se deshabilitan movimientos e impresión mientras no hay conexión confirmada; los datos ya mostrados pueden seguir visibles con su estado de conexión. [Metadatos de servidor y caché](https://firebase.google.com/docs/firestore/manage-data/enable-offline).

Las [transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions) leen el saldo actual y guardan saldo e historial juntos. Las reglas verifican el par mediante `getAfter()`. Impiden saldo negativo, cambios de unidad o SKU, edición/borrado de movimientos, alteración del origen y escrituras con saldo inicial sin aprobar.

Cada envío conserva un UUID en memoria. Un reintento usa ese mismo folio y no descuenta ni suma de nuevo. Si la respuesta es incierta, se conserva y bloquea el formulario para reintentar con los mismos datos. Recargar, cerrar sesión o cerrar la pestaña elimina ese folio local; antes de volver a capturar, comprobarlo en el historial. La vista muestra los últimos 30 registros y conserva el resto en Firestore; aún no hay navegación del historial completo ni reversión/ajustes en la interfaz.

Cerrar sesión cancela las suscripciones y limpia la vista y el formulario. La aprobación de cuentas y la retirada de roles conservan las limitaciones de caducidad del token descritas en la guía de acceso.

## Verificación y publicación

```sh
npm test
npm run test:firestore
npm run dev
npm run test:browser
```

El emulador usa exclusivamente `demo-wms-inventory`, con datos de prueba y, si está presente localmente, una prueba de importación del libro privado. Las pruebas de navegador interceptan los proveedores y usan materiales ficticios; no son acceso Google real ni una base online activa. Playwright y Chromium deben estar disponibles en el entorno de pruebas. El emulador requiere Java 21 o superior.

Después de conectar el proyecto real, comprobar dos sesiones autorizadas, actualización entre equipos, rechazo de otra cuenta, pérdida de conexión, impresión y limpieza al salir. El saldo inicial seguirá pendiente hasta su validación posterior.

El workflow de GitHub Pages publica solo `public/`. Las reglas se despliegan por separado. No publicar Excel, políticas de acceso, credenciales ni datos de pruebas en esa carpeta. No se ha ejecutado commit, push ni despliegue de esta actualización.
