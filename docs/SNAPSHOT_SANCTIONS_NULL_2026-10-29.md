# Sanciones sin expediente en el snapshot

El snapshot CTP incluye sanciones oficiales emitidas directamente desde Sanciones,
sin expediente asociado. La migración CTP 240 permite `incident_id: null`; el
normalizador de Manager seguía exigiendo un identificador no vacío. Una sanción
legítima de ese tipo abortaba la instantánea completa y conservaba la proyección
anterior, aunque las consultas directas de Ranked o administración funcionaran.

El cambio acepta exclusivamente el `null` explícito al normalizar ese campo del
snapshot. Los valores no nulos conservan su validación. No omite sanciones,
inventa expedientes ni modifica la creación local, los permisos o el envío de
comandos oficiales. No requiere migración ni cambio de configuración.

Las regresiones usan una SQLite temporal propia: snapshot mixto con y sin
expediente, persistencia entre procesos, repetición sin cambios, rechazo de
identificadores inválidos, rollback ante colisión con trabajo local y lectura
del workspace y dossier respetando permisos. La creación local sigue requiriendo
un expediente; una sanción oficial recibida no puede reenviarse como borrador.

Los consumidores de Sanciones navegan por el sujeto y no construyen enlaces a
partir de `incident_id`. El dossier sólo enlaza los expedientes reales devueltos
en su colección. No se modifica la interfaz para esta corrección.

Estas pruebas acreditan el candidato DEV con datos sintéticos. La recuperación
real del snapshot, el avance de su fecha y la conservación de datos requieren
una revisión tras la publicación por CI autorizada. Este trabajo no publica,
sincroniza ni modifica PRE/PROD.

Validación local: las cinco regresiones nuevas pasan; `npm test` termina con
454 pruebas correctas y cinco omitidas, sin fallos. `npm audit --audit-level=high`
no detecta vulnerabilidades y `npm run build` pasa. También pasan los checks
Python de tráfico (19), collector (13) y broker de releases (38, con 19 omitidos
por sus requisitos de plataforma). Los casos omitidos no se acreditan en Windows.
