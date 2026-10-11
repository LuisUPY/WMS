# Activación del acceso Google de WMS

## Alcance de esta entrega

Interfaz responsive con el logo original, acceso mediante Google, comprobación del permiso de administrador, sesión en memoria, cierre de sesión y caducidad de la sesión de la aplicación a los 30 minutos. La versión 0.3 incorporó inventario con Cloud Firestore y la versión 0.4 añade su [aprobación administrativa](OPENING_APPROVAL.md). El estado remoto de cada instalación debe comprobarse por lectura. SDK web de Firebase fijado en 13.0.0.

El acceso requiere la configuración pública de un proyecto Firebase y un permiso de administrador en ese proyecto: nunca se muestra un acceso exitoso simulado. La primera cuenta aprobada está definida localmente en `config/access-policy.json`, excluido de Git y de la publicación.

## 1. Crear o seleccionar el proyecto

En [Firebase Console](https://console.firebase.google.com/), crear el proyecto WMS. Analytics y Storage no son necesarios para esta etapa. La configuración del inventario requiere además Cloud Firestore: seguir [INVENTORY_SETUP.md](INVENTORY_SETUP.md). Verificar las cuotas del plan elegido antes del uso operativo; esta implementación no garantiza coste cero ilimitado.

Registrar una aplicación web. En Authentication > Sign-in method, habilitar Google y seleccionar un correo de soporte. Revisar también el nombre visible y la pantalla de consentimiento de Google; si el proyecto OAuth permanece en modo de prueba, añadir la cuenta del administrador como usuario de prueba.

Copiar la configuración web pública a `public/config.js`, sustituyendo `null` por el objeto `firebaseConfig` de la consola. Los campos utilizados son `apiKey`, `authDomain`, `projectId` y `appId`; pueden conservarse los demás campos públicos de Firebase. Esto no es una clave privada ni concede permisos administrativos.

No incluir contraseñas, tokens OAuth, credenciales de cuenta de servicio ni claves privadas en ese archivo.

## 2. Autorizar los dominios

En Authentication > Settings > Authorized domains, añadir `localhost` para pruebas. Los proyectos nuevos pueden no incluirlo de forma predeterminada.

Para el repositorio actual, la dirección de Pages es `https://luisupy.github.io/WMS/`. El dominio autorizado es `luisupy.github.io`, sin la ruta `/WMS/`. La versión publicada y el acceso OAuth se comprueban por separado de la preparación local.

En la aplicación se utiliza la ventana emergente de Google y el dominio de autenticación proporcionado por Firebase. La contraseña se introduce en Google; WMS no la recibe.

## 3. Asignar el permiso al correo elegido

Abrir WMS mediante su servidor local antes de registrar la primera identidad:

```sh
cd /Users/jerry/WMS
npm run dev
```

Mantener la terminal abierta, entrar en [http://localhost:4173](http://localhost:4173) y pulsar «Continuar con Google» con la cuenta del administrador. Abrir `index.html` con doble clic no sirve para este paso. Firebase creará su identidad, pero WMS denegará el acceso mientras no tenga el permiso. Esto es intencional: tener una cuenta Google no concede el rol.

El propietario del proyecto asigna una custom claim `admin: true` desde un entorno de confianza mediante `scripts/admin-role.mjs`. La herramienta conserva las demás claims y rechaza conceder el rol a cuentas que no hayan verificado su identidad con Google.

El correo se toma de la política administrativa local cuando contiene una sola cuenta. Esa aprobación local no otorga privilegios en Firebase. Para agregar cuentas futuras, el responsable debe aprobarlas expresamente en la política antes de asignar el permiso. No se publica la lista en el navegador.

Puede ejecutarse en Google Cloud Shell o en una terminal de confianza con Application Default Credentials del propietario, habilitadas para administrar Firebase Authentication. Instalar allí `firebase-admin` y ejecutar:

```sh
npm install --no-save firebase-admin
node scripts/admin-role.mjs grant --project ID_PROYECTO
```

El ID es el del proyecto real. Con varias cuentas aprobadas, añadir `--email CORREO_AUTORIZADO`. No se necesita colocar credenciales administrativas en el navegador. Si se utilizan credenciales de cuenta de servicio, deben permanecer fuera del repositorio y de `public/`; nunca compartir su JSON por el chat.

Tras asignar el rol, cerrar sesión e iniciar de nuevo con Google. El token renovado incluirá el permiso.

Para retirar el rol:

```sh
node scripts/admin-role.mjs revoke --email CORREO_AUTORIZADO --project ID_PROYECTO
```

La retirada no hace desaparecer inmediatamente todos los tokens ya emitidos. Esta interfaz vuelve a comprobar la claim en cada acceso y limita su sesión a 30 minutos. Las reglas de Firestore verifican la identidad Google, el correo verificado y `admin: true` del token. Un token ya emitido puede conservar el permiso hasta vencer; esta versión no incorpora una lista de revocación instantánea en Firestore.

## 4. Ejecutar y comprobar

Con Node.js 20 o superior, `npm run dev` sirve únicamente la carpeta `public/` en `http://localhost:4173`.

Abrir la dirección web, no `public/index.html` mediante `file://`: los módulos y la autenticación Google necesitan el origen web. La página ofrece ahora un mensaje explicativo si se intenta acceder desde el archivo.

`npm run auth:status` comprueba si la política local y la configuración pública de Firebase están preparadas; no verifica una sesión real ni cambia permisos. Si falta Firebase, termina indicando que la activación está pendiente.

`npm test` comprueba el acceso, los cambios de estado y la validación de inventario. `npm run test:firestore` comprueba las reglas de datos con el emulador. `npm run test:browser` requiere Playwright y Chromium disponibles, además del servidor local; comprueba la interfaz usando un proveedor de prueba interceptado exclusivamente dentro del test. No hay modo demo ni atajo de acceso en la aplicación publicada.

Prueba real necesaria: acceso con el administrador, rechazo de otra cuenta Google, cierre de sesión, pérdida de sesión al recargar y comprobación desde el dominio publicado. Las pruebas automatizadas no sustituyen la prueba OAuth real.

## 5. GitHub Pages

El workflow `.github/workflows/pages.yml` publica exclusivamente `public/`. En el repositorio seleccionar Settings > Pages > Source: GitHub Actions. Publicar los cambios autorizados y ejecutar el workflow, o dejar que se ejecute al actualizar `main`.

Los archivos de `DB/`, `Information/`, `config/`, `scripts/` y `tests/` no forman parte del artefacto. Los datos operativos y la política administrativa real están además excluidos del seguimiento nuevo mediante `.gitignore`. No se ha realizado push, commit ni publicación como parte de esta entrega local.

GitHub Pages sirve una interfaz pública: los archivos de la pantalla no se vuelven privados con el login. Los datos operativos se consultan en Firestore bajo sus reglas; no se incluyen en `public/`. Revisar las condiciones de Pages antes de utilizarlo como alojamiento operativo definitivo.

## Referencias oficiales

- [Acceso Google](https://firebase.google.com/docs/auth/web/google-signin).
- [Sesión en memoria](https://firebase.google.com/docs/auth/web/auth-state-persistence).
- [Claims de administrador, emitidas en un entorno de confianza](https://firebase.google.com/docs/auth/admin/custom-claims).
- [Credenciales administrativas](https://firebase.google.com/docs/admin/setup).
- [Límites de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
