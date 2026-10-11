# Historial de versiones

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

Cada actualización posterior incrementará la versión en 0.1 y se registrará aquí. La siguiente versión será 0.4.
