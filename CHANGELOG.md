# Historial de versiones

## 0.6 — 2026-10-11

- CS CARTONES, CAR PAQUETES y CXT editables mediante diálogos numéricos: enteros desde cero, con guardado confirmado y auditoría inmutable.
- Correcciones compartidas en tiempo real, conservando las referencias UMR/Ubicación existentes y el desglose original de apertura. Reintentos con el mismo folio.
- La tabla y el detalle del material muestran el desglose corregido; los diálogos aclaran que estas correcciones no cambian el saldo total ni se recalculan con entradas/salidas.
- Reglas y pruebas ampliadas para impedir valores negativos, fracciones, cambios sin auditoría o alteración simultánea de otras columnas.

## 0.5 — 2026-10-11

- Tabla ordenada alfabéticamente por descripción, con desempate por SKU.
- Columnas CS CARTONES, CAR PAQUETES y CXT con el desglose histórico de apertura identificado como tal.
- UMR y S. Loc. Ubicación editables mediante diálogos de texto. Son referencias visibles: no convierten cantidades ni reasignan el saldo a otro almacén.
- Cambios de referencias compartidos en tiempo real, con auditoría inmutable, transacciones e identificador de reintento. La unidad y el almacén del inventario original se conservan.
- Tabla ampliada e impresión horizontal; saldo mostrado junto a su unidad de control.
- Archivos web identificados por versión para evitar mezclas con recursos anteriores en caché.
- Incluye el proceso de aprobación 0.4 para activar el saldo validado con trazabilidad.

## 0.4 — 2026-10-11

- Revisión y aprobación administrativa del saldo inicial, con corte real, responsable, cuenta administrativa, evidencia y confirmación de mercancía utilizable.
- Vista previa de solo lectura; comprobación de todos los saldos contra la fuente y huella del inventario revisado. Rechazo de datos cambiados, movimientos previos o aperturas ya activas.
- Aprobación y auditoría atómicas sin reescribir cantidades ni historial. Copia del marcador anterior y materiales revisados, inmutable desde clientes.
- Interfaz, transacciones y reglas exigen una aprobación completa; cambiar únicamente `status` a `active` no habilita movimientos.
- Fecha de corte en hora de Mérida y alcance utilizable visibles después de aprobar. Unidades independientes y sesión/caché en memoria conservadas.
- Pruebas de aprobación incompleta, cambios durante revisión, evidencia de auditoría y movimientos posteriores en emulador. Preparación local; publicación y activación de producción pendientes de autorización.

## 0.3 — 2026-10-11

- Integración preparada de la fuente local `DB/DataBase.xlsx` con Cloud Firestore; archivo original conservado.
- Validación de encabezados, claves únicas, cantidades y unidades. Valores guardados de fórmulas externas, procedencia y huella SHA-256; la fecha `HOY()` no se usa como fecha del corte.
- Importación inicial atómica e idempotente que no puede reemplazar saldos existentes. Estado pendiente de validación por solicitud del usuario.
- Consulta de inventario con búsqueda, saldos separados por unidad, impresión y últimas operaciones.
- Suscripciones en tiempo real con caché en memoria. Sin persistencia operativa en el navegador ni operación offline.
- Entradas y salidas preparadas mediante transacciones, identificador de reintento e historial inmutable. Reglas que impiden negativos, cambios sin movimiento y operaciones con saldo inicial sin aprobar.
- Pruebas con emulador de Firestore y navegador. Configuración del proyecto, acceso Google real, carga en la nube y publicación siguen pendientes.

## 0.2 — 2026-10-11

- Primera cuenta aprobada en la política administrativa local, excluida de Git y del sitio público.
- La herramienta de asignación de permisos solo admite cuentas aprobadas y verifica su identidad Google.
- Comprobación del estado de preparación mediante `npm run auth:status`.
- Mensaje de ayuda al intentar iniciar sesión desde un archivo abierto directamente.
- Pruebas de concesión y retirada del permiso de administrador.
- Activación real pendiente de conectar el proyecto Firebase y asignar el permiso en ese proyecto.

## 0.1 — 2026-10-11

- Versión inicial del acceso con Google y permiso de administrador.
- Logo WMS y diseño adaptable a computadora y móvil.
- Sesión temporal en memoria y cierre de sesión.
- Simplificación del login: eliminación del icono de candado, la etiqueta «Administrador» y los tres textos introductorios señalados.
- Indicador «Versión 0.1» en el pie de página.

Cada actualización posterior incrementará la versión en 0.1 y se registrará aquí. La siguiente versión será 0.7.
