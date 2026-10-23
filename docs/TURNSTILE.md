# Turnstile en el acceso de Manager

Manager usa la cuenta CTP y la clave pública `anon` del mismo entorno. El navegador mantiene el token de Turnstile en memoria y lo envía como `captchaToken` a `/api/auth/login`; el servidor lo pasa a GoTrue en `gotrue_meta_security.captcha_token`. Manager no llama a `siteverify`, no necesita la clave secreta de Turnstile y no crea una vía alternativa de autenticación.

La configuración pública `/api/auth/config` devuelve únicamente `provider` y `captcha: { required, siteKey }`, sin caché. El login principal y el de ruleta esperan esta configuración; si la verificación es obligatoria, un fallo de carga o un token ausente, caducado o utilizado impide el envío. Cada fallo de login requiere otro token. El servidor limita el token a 2048 caracteres y conserva un error seguro `captcha_failed`, separado de las credenciales incorrectas. Refresh y las comprobaciones de identidad mantienen su contrato anterior.

## Preparar PRE antes de activar CAPTCHA en CTP Auth

1. Autorizar `pre.manager.playctp.com` en el **mismo widget PRE** cuya clave secreta utiliza GoTrue PRE. Usar su clave pública; crear otro widget con otra clave secreta no sirve para este servicio compartido. El código también cubre el login de ruleta cuando se despliegue en su entorno correspondiente.
2. Publicar el paquete revisado de Manager PRE mediante el flujo habitual, con backup privado de configuración/SQLite y CAS del release actual. Preservar todas las otras variables, especialmente `CTP_AUTH_TOKEN_KEY`, para conservar las sesiones existentes. No hay migración de datos en este cambio.
3. Cambiar exclusivamente en `/etc/ctp-manager/pre.env`:

   ```dotenv
   CTP_AUTH_CAPTCHA_REQUIRED=true
   CTP_AUTH_CAPTCHA_SITE_KEY=CLAVE_PUBLICA_DEL_WIDGET_PRE
   ```

4. Comprobar que el servicio PRE está activo y `https://pre.manager.playctp.com/api/auth/config` devuelve `provider=ctp`, `captcha.required=true` y la clave pública prevista. Verificar en el navegador la carga de Cloudflare, el botón bloqueado sin completar la verificación, su caducidad/reintento y el formulario de login. No dar por probado un inicio de sesión real mediante las pruebas locales.
5. Solo entonces activar CAPTCHA en el Auth nativo PRE mediante su operador revisado. Al activar Auth sin este Manager y su configuración se rechazarían todos los nuevos inicios de sesión del Manager anterior.

El CSP de Manager conserva `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. No tenía restricciones `script-src`, `frame-src` ni `connect-src`, por lo que ya permite Cloudflare; este cambio no introduce restricciones nuevas ni modifica la integración de OBS. Las cookies siguen siendo seguras y ligadas al host en despliegues públicos.

## Pruebas y reversión

```powershell
npm.cmd test
npm.cmd run build
node scripts/package-vps.mjs --out RUTA_PRIVADA_FUERA_DEL_CHECKOUT.tar.gz
```

Las pruebas de Auth usan respuestas de proveedor sintéticas. Las pruebas HTTP arrancan el servidor real en loopback y una SQLite temporal con todo el transporte externo sustituido. Cubren configuración pública, rechazo de tokens ausentes/incorrectos, aceptación y replay sintéticos, cookie segura y preservación de una sesión previa. No prueban una cuenta real, un envío de correo ni un desafío real de Cloudflare.

Conservar el release y la configuración PRE anteriores. Si se necesita volver al Manager sin soporte CAPTCHA, revertir **primero** el enforcement del Auth PRE mediante su rollback revisado; después restaurar Manager/configuración con CAS. No poner `CTP_AUTH_CAPTCHA_REQUIRED=false` como remedio mientras GoTrue siga exigiendo CAPTCHA: ocultaría el widget y rompería los nuevos logins. No cambiar la clave de cifrado de sesiones ni restaurar SQLite antigua para revertir solo este código.
