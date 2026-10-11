# Aprobar el inventario inicial

La versión 0.4 incorpora una herramienta administrativa de revisión y aprobación. El navegador sigue sin poder aprobar inventario. La aprobación registra el corte real, responsable, cuenta administrativa, declaración de evidencia y una copia de los saldos revisados. No cambia las cantidades ni crea entradas o salidas.

## Alcance operativo

Este flujo admite una apertura cuya totalidad haya sido confirmada como mercancía utilizable. Conserva la unidad PAC o CAR de cada material; no introduce conversiones entre presentaciones. Las entradas posteriores deben corresponder al mismo alcance utilizable. Si se necesita manejar calidad o bloqueado, hay que ampliar el modelo antes de incluir esas existencias.

La fuente se sigue leyendo por sus valores guardados. El responsable valida esos valores, las unidades y el corte; la herramienta no acredita por sí misma un conteo físico ni actualiza SAP. `numericNormalizations` conserva los residuos de precisión y sus enteros importados para revisión.

## 1. Revisar sin escribir

Desde una terminal de confianza con Application Default Credentials y el proyecto de destino confirmado:

```sh
npm run inventory:approval -- --project ID_PROYECTO
```

Sin `--apply` la herramienta solo lee. Comprueba que la fuente, las unidades, los saldos y todos los materiales coincidan con el archivo, que el marcador permanezca en borrador y que no haya movimientos ni revisiones. Muestra totales separados por unidad, normalizaciones y `inventorySha256`.

La huella incluye el marcador y los documentos completos del inventario, ordenados de forma estable. Una modificación posterior obliga a repetir la revisión. No se aprueba un origen distinto, una apertura ya activa ni un borrador con diferencias. La herramienta no corrige ni reemplaza datos: las diferencias requieren una conciliación administrativa documentada.

## 2. Registrar la declaración privada

Guardar un archivo JSON fuera de `public/`, por ejemplo en `Information/`, que está excluido de Git. Esta plantilla está incompleta deliberadamente:

```json
{
  "sourceAsOf": "",
  "approvedBy": "",
  "evidence": "",
  "stockScope": "all-usable",
  "quantitiesAndUnitsConfirmed": false,
  "numericNormalizationsReviewed": false,
  "noUnrecordedMovementsConfirmed": false
}
```

- `sourceAsOf`: fecha y hora reales con zona explícita, en formato ISO, por ejemplo `2026-01-01T15:00:00-06:00`. No usar la fórmula `TODAY()`, la importación ni la consulta como sustitutos del corte.
- `approvedBy`: nombre del responsable que validó la apertura.
- `evidence`: declaración y referencia verificable de esa validación, hasta 1,000 caracteres. No incluir credenciales ni enlaces públicos a evidencia privada.
- Las confirmaciones se cambian a `true` una vez revisadas las cantidades/unidades, las normalizaciones y la ausencia de movimientos pendientes entre el corte y la apertura. Si hubo movimientos, conciliar antes de aprobar.

Puede comprobarse la declaración sin escribir agregando `--review RUTA_PRIVADA.json` a la vista previa.

## 3. Aplicar la apertura autorizada

Antes de aprobar producción, entregar al usuario la vista previa y obtener su autorización de activación. Desplegar primero las reglas revisadas y publicar el cliente 0.4. Así, la aplicación y las reglas usan el mismo contrato. Hasta que exista la aprobación completa, los movimientos siguen bloqueados.

```sh
npm run inventory:approval -- --project ID_PROYECTO --review RUTA_PRIVADA.json --expect HUELLA_REVISADA --apply
```

La cuenta administrativa asociada debe existir en la política privada local y tener Google verificado, estar habilitada y tener `admin: true` en Firebase. Con varias cuentas, indicar `--email`. El nombre del responsable operativo y la cuenta administrativa se conservan por separado.

La transacción vuelve a leer y comprobar la apertura y su huella. Crea `inventoryApprovals/{approvalId}` con la declaración, marcador previo y materiales, y cambia `settings/inventory` a `active`, `approved` y `all-usable` juntos. Registra la hora de aprobación con un timestamp de servidor. Repetir una aprobación rechaza la apertura ya activa; nunca restablece cantidades.

Las reglas exigen metadatos completos, fecha coherente, coincidencia con el origen y una evidencia de auditoría idéntica. Desde clientes, tanto el marcador como la auditoría permanecen inmutables. El Admin SDK usa permisos IAM y puede omitir las reglas: su uso queda restringido al entorno administrativo de confianza.

## 4. Verificar el arranque

Confirmar por lectura el marcador y la auditoría; comprobar que los saldos y revisiones no cambiaron. Abrir el cliente publicado y comprobar fecha, responsable y formulario habilitado. Para probar transacciones, concurrencia y pérdida de conexión se usa el emulador, sin movimientos ficticios de producción. La comprobación final de actualización entre equipos se realiza durante una operación real autorizada.

Pruebas locales: `npm test`, `npm run test:firestore` y `npm run test:browser` con el servidor local activo. Incluyen el rechazo de aprobación incompleta, de cambios después de revisar, de autoaprobación desde cliente y de modificación de auditoría; conservan las pruebas de negativos, idempotencia y concurrencia.

Referencias: [transacciones de Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions), [reglas y acceso del servidor](https://firebase.google.com/docs/firestore/security/rules-conditions).
