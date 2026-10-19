# CRM y correos

Sección `/crm` (navegación «Administración → CRM y correos»). Solo la administración CTP puede usarla (`is_admin` y, en modo `ctp`, rol CTP `admin`).

| Pestaña | Uso |
| --- | --- |
| Resumen | Personas, consentimiento, personas alcanzables, campañas y transaccionales personalizados. |
| Contactos | Todas las cuentas de CTP con correo, idioma, consentimiento, equipos y pases actuales o anteriores. Los filtros se pueden guardar como segmento. |
| Segmentos | Filtros reutilizables con su tamaño calculado bajo demanda. |
| Campañas | Borradores, contenido por idioma, editor visual o HTML con imágenes, A/B, envío de prueba, envío inmediato o programado, cancelación e informe por variante y destinatario. |
| Transaccionales | Correos de Supabase Auth y avisos de actividad, editables por idioma, con historial y restablecimiento. |

El servidor expone `POST /api/administration/crm` con `{action, data}` (`server/crm-contract.js`). Las lecturas funcionan aunque `CTP_ENABLE_WRITES` esté desactivado; las escrituras lo requieren. CTP valida cada campo y responde con códigos `crm_*`, que Manager traduce a mensajes propios sin reenviar texto remoto. Las imágenes se suben con el servicio existente al bucket `email-images`.

Los datos, el consentimiento y el envío viven en CTP. Consulta `docs/CRM_CAMPAIGNS_2026-10-19.md` en el repositorio de CTP para las garantías y los pasos de activación.
